import type { NormalizedMessage } from "../types.js";

/**
 * Parse one line of a Claude Code session JSONL file.
 *
 * Claude Code writes one JSON object per line. The shapes we care about:
 *   { type: "user",      message: { role: "user",      content: string | Block[] }, timestamp }
 *   { type: "assistant", message: { role: "assistant", content: Block[] },          timestamp }
 * where Block is { type: "text", text } | { type: "tool_use", ... } | { type: "tool_result", ... }.
 * Everything else (summary, system, progress, tool results) is skipped — the
 * analysis cares about what the human said and what the agent replied, not
 * tool plumbing.
 */
export function parseClaudeCodeLine(line: string): NormalizedMessage | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!obj || (obj.type !== "user" && obj.type !== "assistant")) return null;
  const msg = obj.message;
  if (!msg || (msg.role !== "user" && msg.role !== "assistant")) return null;

  let text = "";
  if (typeof msg.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter((block: any) => block && block.type === "text" && typeof block.text === "string")
      .map((block: any) => block.text)
      .join("\n");
  }
  text = text.trim();
  if (!text) return null;

  // Claude Code injects harness content as user turns; it isn't the human speaking.
  if (msg.role === "user" && /^<(system-reminder|command-name|local-command)/.test(text)) return null;

  return {
    role: msg.role,
    text,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : undefined,
  };
}
