import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSources, toInventory } from "../src/core/discovery.js";
import { sweep, verifyReceipt } from "../src/core/grep.js";
import { Redactor } from "../src/core/redact/index.js";

function fakeHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "mirror-test-"));
  const proj = path.join(home, ".claude", "projects", "-home-user-app");
  mkdirSync(proj, { recursive: true });
  const session = [
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-01T09:00:00Z",
      message: { role: "user", content: "no, that's not what I asked. do the retry again" },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-01T09:00:10Z",
      message: { role: "assistant", content: [{ type: "text", text: "Retrying with backoff." }] },
    }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-05-01T09:05:00Z",
      message: { role: "user", content: "set API_KEY=verysecretvalue99 in the env" },
    }),
  ].join("\n");
  writeFileSync(path.join(proj, "session-1.jsonl"), session);

  const codex = path.join(home, ".codex", "sessions", "2026", "05", "02");
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    path.join(codex, "rollout-1.jsonl"),
    JSON.stringify({
      timestamp: "2026-05-02T14:00:00Z",
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "wire up the webhook again" }] },
    }),
  );
  return home;
}

describe("discovery", () => {
  it("finds sources and builds an inventory", async () => {
    const home = fakeHome();
    const sources = await discoverSources(home);
    expect(sources.map((s) => s.kind).sort()).toEqual(["claude-code", "codex"]);

    const inv = toInventory(sources);
    const claude = inv.find((r) => r.kind === "claude-code")!;
    expect(claude.fileCount).toBe(1);
    expect(claude.totalSizeBytes).toBeGreaterThan(0);
    expect(claude.oldestMs).not.toBeNull();
  });

  it("returns nothing for a home with no archives", async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "mirror-empty-"));
    expect(await discoverSources(empty)).toEqual([]);
  });
});

describe("sweep + receipts over discovered sources", () => {
  it("finds correction-pattern hits with redaction applied", async () => {
    const home = fakeHome();
    const sources = await discoverSources(home);
    const redactor = new Redactor();
    const result = await sweep(sources, /no,? (that's|thats) not/i, redactor);
    expect(result.totalHits).toBe(1);
    expect(result.hits[0].line).toContain("not what I asked");
    expect(result.hits[0].date).toBe("2026-05-01T09:00:00Z");
  });

  it("never returns secret values from swept lines", async () => {
    const home = fakeHome();
    const sources = await discoverSources(home);
    const redactor = new Redactor();
    const result = await sweep(sources, /API_KEY/i, redactor);
    expect(result.totalHits).toBe(1);
    expect(result.hits[0].line).not.toContain("verysecretvalue99");
    expect(result.hits[0].line).toContain("[REDACTED:assigned-secret]");
  });

  it("verifies real receipts and rejects fabricated ones", async () => {
    const home = fakeHome();
    const sources = await discoverSources(home);
    const redactor = new Redactor();
    const claude = sources.find((s) => s.kind === "claude-code")!;
    const file = claude.files[0].path;

    expect(await verifyReceipt(claude, file, "do the retry again", redactor)).toBe(true);
    expect(await verifyReceipt(claude, file, "I promised to ship this by Friday", redactor)).toBe(false);
    expect(await verifyReceipt(claude, "/nonexistent.jsonl", "anything", redactor)).toBe(false);
  });
});
