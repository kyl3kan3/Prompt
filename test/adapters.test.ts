import { describe, expect, it } from "vitest";
import { parseClaudeCodeLine } from "../src/core/adapters/claudeCode.js";
import { parseCodexLine } from "../src/core/adapters/codex.js";

describe("claude-code adapter", () => {
  it("parses a user message with string content", () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2026-03-01T10:00:00Z",
      message: { role: "user", content: "fix the login bug" },
    });
    expect(parseClaudeCodeLine(line)).toEqual({
      role: "user",
      text: "fix the login bug",
      timestamp: "2026-03-01T10:00:00Z",
    });
  });

  it("parses assistant block content and joins text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Looking at it." },
          { type: "tool_use", name: "Read", input: {} },
          { type: "text", text: "Found it." },
        ],
      },
    });
    expect(parseClaudeCodeLine(line)?.text).toBe("Looking at it.\nFound it.");
  });

  it("skips harness-injected user turns", () => {
    const line = JSON.stringify({
      type: "user",
      message: { role: "user", content: "<system-reminder>injected</system-reminder>" },
    });
    expect(parseClaudeCodeLine(line)).toBeNull();
  });

  it("skips non-message lines and garbage", () => {
    expect(parseClaudeCodeLine(JSON.stringify({ type: "summary", summary: "x" }))).toBeNull();
    expect(parseClaudeCodeLine("not json at all")).toBeNull();
    expect(parseClaudeCodeLine(JSON.stringify({ type: "user" }))).toBeNull();
  });
});

describe("codex adapter", () => {
  it("parses the response_item payload shape", () => {
    const line = JSON.stringify({
      timestamp: "2026-04-02T08:30:00Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "add retry logic" }],
      },
    });
    expect(parseCodexLine(line)).toEqual({
      role: "user",
      text: "add retry logic",
      timestamp: "2026-04-02T08:30:00Z",
    });
  });

  it("parses the flat message shape", () => {
    const line = JSON.stringify({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Done." }],
    });
    expect(parseCodexLine(line)?.text).toBe("Done.");
  });

  it("skips environment-context turns", () => {
    const line = JSON.stringify({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "<environment_context>...</environment_context>" }],
    });
    expect(parseCodexLine(line)).toBeNull();
  });
});
