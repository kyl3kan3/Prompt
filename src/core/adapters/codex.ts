import type { NormalizedMessage } from "../types.js";

/**
 * Parse one line of a Codex CLI rollout JSONL file
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
 *
 * Codex has shifted formats across releases, so this parser is deliberately
 * lenient. Shapes seen in the wild:
 *   { timestamp, type: "response_item", payload: { type: "message", role, content: [{type: "input_text"|"output_text", text}] } }
 *   { record_type: "response", ... }               — older, skipped unless it carries a message
 *   { type: "message", role, content: [...] }      — flat variant
 */
export function parseCodexLine(line: string): NormalizedMessage | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj) return null;

  const candidate = obj.payload?.type === "message" ? obj.payload : obj.type === "message" ? obj : null;
  if (!candidate) return null;

  const role = candidate.role === "user" ? "user" : candidate.role === "assistant" ? "assistant" : null;
  if (!role) return null;

  let text = "";
  if (typeof candidate.content === "string") {
    text = candidate.content;
  } else if (Array.isArray(candidate.content)) {
    text = candidate.content
      .filter((part: any) => part && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n");
  }
  text = text.trim();
  if (!text) return null;

  // Codex wraps harness context in tagged blocks; drop pure-harness turns.
  if (role === "user" && /^<(environment_context|user_instructions|turn_context)/.test(text)) return null;

  return {
    role,
    text,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
  };
}
