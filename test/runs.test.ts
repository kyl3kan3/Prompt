import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findPreviousRun, readRunArtifacts } from "../src/core/runs.js";

function base(): string {
  return mkdtempSync(path.join(os.tmpdir(), "mirror-runs-"));
}

function makeRun(baseDir: string, stamp: string, withEvidence: boolean): string {
  const dir = path.join(baseDir, "runs", stamp);
  mkdirSync(dir, { recursive: true });
  if (withEvidence) writeFileSync(path.join(dir, "evidence.md"), `# evidence from ${stamp}\n`);
  return dir;
}

describe("findPreviousRun", () => {
  it("returns null when there are no runs", async () => {
    expect(await findPreviousRun(base())).toBeNull();
  });

  it("returns the latest run with evidence, excluding the current one", async () => {
    const b = base();
    makeRun(b, "2026-05-01T10-00-00Z", true);
    const second = makeRun(b, "2026-06-01T10-00-00Z", true);
    makeRun(b, "2026-06-15T10-00-00Z", false); // aborted before Distill
    const current = makeRun(b, "2026-07-10T10-00-00Z", true);

    expect(await findPreviousRun(b, current)).toBe(second);
  });

  it("skips runs that never produced evidence", async () => {
    const b = base();
    makeRun(b, "2026-06-15T10-00-00Z", false);
    expect(await findPreviousRun(b)).toBeNull();
  });
});

describe("readRunArtifacts", () => {
  it("reads whichever artifacts exist", async () => {
    const b = base();
    const dir = makeRun(b, "2026-06-01T10-00-00Z", true);
    writeFileSync(path.join(dir, "mirror.md"), "the portrait\n");

    const artifacts = await readRunArtifacts(dir);
    expect(Object.keys(artifacts).sort()).toEqual(["evidence.md", "mirror.md"]);
    expect(artifacts["mirror.md"]).toBe("the portrait\n");
  });
});
