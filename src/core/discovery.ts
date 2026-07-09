import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InventoryRow, Source, SessionFile, SourceKind } from "./types.js";

/**
 * Where each supported tool keeps its session archives, relative to $HOME.
 * Discovery reads these in place — nothing is copied or uploaded.
 */
const SOURCE_ROOTS: Array<{ kind: SourceKind; tool: string; rel: string }> = [
  { kind: "claude-code", tool: "Claude Code", rel: ".claude/projects" },
  { kind: "codex", tool: "Codex CLI", rel: ".codex/sessions" },
  { kind: "opencode", tool: "opencode", rel: ".local/share/opencode" },
  { kind: "opencode", tool: "opencode", rel: ".config/opencode" },
];

async function collectJsonlFiles(root: string): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip, never fail discovery
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        try {
          const stat = await fs.stat(full);
          out.push({ path: full, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // race with deletion — skip
        }
      }
    }
  }
  await walk(root);
  return out;
}

/** Scan known archive locations under homeDir. Returns only sources that exist. */
export async function discoverSources(homeDir: string = os.homedir()): Promise<Source[]> {
  const sources: Source[] = [];
  const seenRoots = new Set<string>();
  for (const { kind, tool, rel } of SOURCE_ROOTS) {
    const root = path.join(homeDir, rel);
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const files = await collectJsonlFiles(root);
    if (files.length > 0) sources.push({ kind, tool, path: root, files });
  }
  return sources;
}

export function toInventory(sources: Source[]): InventoryRow[] {
  return sources.map((s) => {
    const mtimes = s.files.map((f) => f.mtimeMs);
    return {
      kind: s.kind,
      tool: s.tool,
      path: s.path,
      fileCount: s.files.length,
      totalSizeBytes: s.files.reduce((sum, f) => sum + f.sizeBytes, 0),
      oldestMs: mtimes.length ? Math.min(...mtimes) : null,
      newestMs: mtimes.length ? Math.max(...mtimes) : null,
    };
  });
}
