import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeDiff, ProposalStore, validateTarget, type Proposal } from "../src/core/proposals.js";

function tempHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "mirror-prop-"));
}

describe("validateTarget", () => {
  const home = tempHome();

  it("allows CLAUDE.md and AGENTS.md anywhere under home", () => {
    expect(validateTarget(home, path.join(home, "CLAUDE.md"))).toBeNull();
    expect(validateTarget(home, path.join(home, "projects", "x", "AGENTS.md"))).toBeNull();
  });

  it("allows skills and commands under ~/.claude", () => {
    expect(validateTarget(home, path.join(home, ".claude", "skills", "kill-repetition", "SKILL.md"))).toBeNull();
    expect(validateTarget(home, path.join(home, ".claude", "commands", "deploy.md"))).toBeNull();
  });

  it("rejects everything else", () => {
    expect(validateTarget(home, "/etc/passwd")).toContain("home directory");
    expect(validateTarget(home, path.join(home, ".bashrc"))).toContain("can be changed");
    expect(validateTarget(home, path.join(home, ".ssh", "config"))).toContain("can be changed");
  });
});

describe("computeDiff", () => {
  it("produces hunks with context and +/- lines", () => {
    const oldText = ["line one", "line two", "line three", "line four", "line five"].join("\n");
    const newText = ["line one", "line two", "line three CHANGED", "line four", "line five"].join("\n");
    const diff = computeDiff(oldText, newText);
    expect(diff).toContain("--- current");
    expect(diff).toContain("@@");
    expect(diff).toContain("-line three");
    expect(diff).toContain("+line three CHANGED");
    expect(diff).toContain(" line two");
  });

  it("reports no changes for identical content", () => {
    expect(computeDiff("same\ntext", "same\ntext")).toContain("(no changes)");
  });

  it("handles creation from empty", () => {
    const diff = computeDiff("", "brand new\ncontent");
    expect(diff).toContain("+brand new");
    expect(diff).toContain("+content");
  });
});

describe("ProposalStore", () => {
  it("proposes, applies with backup, and rejects", async () => {
    const home = tempHome();
    const backups = path.join(home, ".mirror-backups");
    const target = path.join(home, "CLAUDE.md");
    writeFileSync(target, "old instructions\n");

    const store = new ProposalStore(home, backups);
    const p1 = (await store.propose("Update instructions", target, "new instructions\n")) as Proposal;
    expect(p1.kind).toBe("modify");
    expect(p1.diff).toContain("-old instructions");
    expect(p1.status).toBe("pending");

    const applied = await store.approve(p1.id);
    expect(applied.status).toBe("applied");
    expect(readFileSync(target, "utf8")).toBe("new instructions\n");
    expect(applied.backupPath && readFileSync(applied.backupPath, "utf8")).toBe("old instructions\n");

    const p2 = (await store.propose("Add a skill", path.join(home, ".claude", "skills", "s", "SKILL.md"), "skill body")) as Proposal;
    expect(p2.kind).toBe("create");
    const rejected = store.reject(p2.id);
    expect(rejected.status).toBe("rejected");
    expect(existsSync(p2.target)).toBe(false);
  });

  it("returns an error string for disallowed targets", async () => {
    const home = tempHome();
    const store = new ProposalStore(home, path.join(home, "b"));
    const result = await store.propose("Sneaky", path.join(home, ".ssh", "authorized_keys"), "x");
    expect(typeof result).toBe("string");
  });

  it("flags proposals whose current file had redacted content", async () => {
    const home = tempHome();
    const target = path.join(home, "CLAUDE.md");
    writeFileSync(target, "notes\napi_key=supersecret12345\n");
    const store = new ProposalStore(home, path.join(home, "b"));
    const p = (await store.propose("Rewrite", target, "notes only\n")) as Proposal;
    expect(p.redactionWarning).toBe(true);
  });

  it("creating a new file needs no backup and applies cleanly", async () => {
    const home = tempHome();
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    const store = new ProposalStore(home, path.join(home, "b"));
    const target = path.join(home, ".claude", "commands", "ship.md");
    const p = (await store.propose("New command", target, "# ship\n")) as Proposal;
    const applied = await store.approve(p.id);
    expect(applied.status).toBe("applied");
    expect(applied.backupPath).toBeUndefined();
    expect(readFileSync(target, "utf8")).toBe("# ship\n");
  });
});
