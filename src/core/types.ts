/** A supported agent-CLI whose local session archives we can read. */
export type SourceKind = "claude-code" | "codex" | "opencode";

/** One discovered archive location on disk. */
export interface Source {
  kind: SourceKind;
  /** Human name shown in the inventory table. */
  tool: string;
  /** Root directory (or file) that was discovered. */
  path: string;
  /** Session files found under the root. */
  files: SessionFile[];
}

export interface SessionFile {
  path: string;
  sizeBytes: number;
  /** File mtime, ms since epoch. Proxy for "when this session last ran". */
  mtimeMs: number;
}

/** Inventory row rendered on the consent screen (Phase 1 output). */
export interface InventoryRow {
  kind: SourceKind;
  tool: string;
  path: string;
  fileCount: number;
  totalSizeBytes: number;
  oldestMs: number | null;
  newestMs: number | null;
}

/** A single message extracted from a session file, tool-format-agnostic. */
export interface NormalizedMessage {
  role: "user" | "assistant";
  text: string;
  /** ISO timestamp when the source format provides one. */
  timestamp?: string;
}

export interface NormalizedSession {
  sourceKind: SourceKind;
  filePath: string;
  mtimeMs: number;
  messages: NormalizedMessage[];
}

/** A grep-sweep hit, already redacted, with enough context to be a receipt. */
export interface SweepHit {
  sourceKind: SourceKind;
  filePath: string;
  /** ISO date (or mtime-derived date) the hit occurred. */
  date: string;
  role: "user" | "assistant";
  /** The redacted matching line, trimmed. */
  line: string;
}
