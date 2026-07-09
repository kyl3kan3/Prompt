import { readSession } from "./adapters/index.js";
import type { Redactor } from "./redact/index.js";
import type { Source, SweepHit } from "./types.js";

/**
 * Named pattern sweeps from the prompt's Distill phase. The model asks for
 * sweeps by name or supplies its own regex; either way the scan runs locally
 * and only redacted matching lines are returned.
 */
export const NAMED_SWEEPS: Record<string, RegExp> = {
  correction: /\b(no,? (that's|thats) not|no,? i meant|that's not what i|not what i asked|wrong|again\b|stop\b|undo that)\b/i,
  frustration: /\b(ugh|ffs|wtf|why (won't|wont|is this)|come on|seriously|frustrat|annoying|hate (this|when))\b/i,
  "just-do-it": /\b(just do it|just fix it|go ahead|don't ask|dont ask|stop asking)\b/i,
  "automation-candidate": /\b(every time|each time|once again|as usual|like (before|last time)|same as (before|last))\b/i,
};

export interface SweepResult {
  pattern: string;
  totalHits: number;
  /** Redacted sample of hits (bounded), each usable as a dated receipt. */
  hits: SweepHit[];
  filesScanned: number;
}

/**
 * Scan every session in the given sources for a pattern. Reads happen locally
 * with a per-file parse cap; only redacted matches (bounded by maxHits) are
 * returned to the caller — this is what makes "sweep everything" affordable
 * and safe at the same time.
 */
export async function sweep(
  sources: Source[],
  pattern: RegExp,
  redactor: Redactor,
  maxHits = 60,
): Promise<SweepResult> {
  const hits: SweepHit[] = [];
  let totalHits = 0;
  let filesScanned = 0;

  for (const source of sources) {
    for (const file of source.files) {
      filesScanned++;
      const session = await readSession(source.kind, file);
      for (const msg of session.messages) {
        for (const rawLine of msg.text.split("\n")) {
          if (!pattern.test(rawLine)) continue;
          totalHits++;
          if (hits.length < maxHits) {
            hits.push({
              sourceKind: source.kind,
              filePath: file.path,
              date: msg.timestamp ?? new Date(file.mtimeMs).toISOString(),
              role: msg.role,
              line: redactor.clean(rawLine.trim()).slice(0, 300),
            });
          }
        }
      }
    }
  }
  return { pattern: String(pattern), totalHits, hits, filesScanned };
}

/**
 * Mechanical receipt verification: does this quoted line actually exist in
 * that session file? Comparison happens on redacted text (what the model saw).
 * One hallucinated receipt poisons a mirror; this is the guard.
 */
export async function verifyReceipt(
  source: Source,
  filePath: string,
  quote: string,
  redactor: Redactor,
): Promise<boolean> {
  const file = source.files.find((f) => f.path === filePath);
  if (!file) return false;
  const needle = quote.trim().toLowerCase();
  if (!needle) return false;
  const session = await readSession(source.kind, file);
  for (const msg of session.messages) {
    if (redactor.clean(msg.text).toLowerCase().includes(needle)) return true;
  }
  return false;
}
