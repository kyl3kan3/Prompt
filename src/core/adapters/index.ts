import { promises as fs } from "node:fs";
import type { NormalizedMessage, NormalizedSession, SessionFile, SourceKind } from "../types.js";
import { parseClaudeCodeLine } from "./claudeCode.js";
import { parseCodexLine } from "./codex.js";

type LineParser = (line: string) => NormalizedMessage | null;

const PARSERS: Record<SourceKind, LineParser> = {
  "claude-code": parseClaudeCodeLine,
  codex: parseCodexLine,
  // opencode stores JSONL message files too; the flat-message shape is close
  // enough to Codex's that the lenient parser handles both for v1.
  opencode: parseCodexLine,
};

/**
 * Read a session file and extract normalized messages.
 * maxMessages caps how much of a file we ever parse — part of the mining
 * budget, enforced in code rather than by model discipline.
 */
export async function readSession(
  kind: SourceKind,
  file: SessionFile,
  maxMessages = 500,
): Promise<NormalizedSession> {
  const parse = PARSERS[kind];
  const messages: NormalizedMessage[] = [];
  let raw: string;
  try {
    raw = await fs.readFile(file.path, "utf8");
  } catch {
    return { sourceKind: kind, filePath: file.path, mtimeMs: file.mtimeMs, messages };
  }
  for (const line of raw.split("\n")) {
    if (messages.length >= maxMessages) break;
    if (!line.trim()) continue;
    const msg = parse(line);
    if (msg) messages.push(msg);
  }
  return { sourceKind: kind, filePath: file.path, mtimeMs: file.mtimeMs, messages };
}
