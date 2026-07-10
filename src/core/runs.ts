import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Run history utilities. Runs live under <baseDir>/runs/<ISO-ish timestamp>/,
 * so lexicographic order is chronological order.
 */

const READABLE_ARTIFACTS = ["evidence.md", "mirror.md", "roadmap.md"];

/** Most recent prior run that produced evidence, or null on a first run. */
export async function findPreviousRun(baseDir: string, excludeDir?: string): Promise<string | null> {
  const runsDir = path.join(baseDir, "runs");
  let entries: string[];
  try {
    entries = await fs.readdir(runsDir);
  } catch {
    return null;
  }
  const exclude = excludeDir ? path.basename(excludeDir) : null;
  for (const name of entries.sort().reverse()) {
    if (name === exclude) continue;
    const dir = path.join(runsDir, name);
    try {
      await fs.access(path.join(dir, "evidence.md"));
      return dir;
    } catch {
      // run never reached Distill — not useful for drift
    }
  }
  return null;
}

export async function readRunArtifacts(runDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of READABLE_ARTIFACTS) {
    try {
      out[name] = await fs.readFile(path.join(runDir, name), "utf8");
    } catch {
      // artifact not written in that run
    }
  }
  return out;
}
