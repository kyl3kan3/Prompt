import { query } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Redactor } from "../core/redact/index.js";
import type { Source } from "../core/types.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { createMirrorTools, type ToolContext } from "./tools.js";

export const PHASES = ["Excavate", "Distill", "Interview", "The Mirror", "Leverage", "Residue"] as const;

export interface RunEvent {
  type: "assistant_text" | "tool_activity" | "phase" | "waiting" | "done" | "error";
  text?: string;
  phase?: number;
}

/** Unbounded async queue bridging HTTP handlers to the SDK's streaming input. */
class MessageQueue<T> {
  private items: T[] = [];
  private waiters: Array<(item: T) => void> = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else this.items.push(item);
  }

  async next(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) return item;
    return new Promise<T>((resolve) => this.waiters.push(resolve));
  }
}

const MIRROR_TOOL_NAMES = [
  "get_inventory",
  "get_sample_plan",
  "read_session",
  "sweep",
  "append_evidence",
  "verify_receipt",
  "write_artifact",
].map((name) => `mcp__mirror__${name}`);

/**
 * One mirror run = one continuous agent session across all six phases.
 * Continuity is the product: the entity that mined the archives is the one
 * that interviews the user and writes the mirror. The server is a viewport
 * onto this session, never an orchestrator of decomposed calls.
 */
export class MirrorRun extends EventEmitter {
  readonly runDir: string;
  phase = 1;
  status: "running" | "done" | "error" = "running";
  private queue = new MessageQueue<string>();
  private redactor = new Redactor();

  constructor(private sources: Source[], baseDir?: string) {
    super();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.runDir = path.join(baseDir ?? path.join(os.homedir(), ".mirror"), "runs", stamp);
  }

  /** Push a user chat message (interview answers, pushback, questions). */
  sendUser(text: string): void {
    this.queue.push(text);
  }

  /** User approved the current gate; advance one phase. */
  approveGate(): void {
    if (this.phase >= PHASES.length) return;
    this.phase++;
    this.emit("event", { type: "phase", phase: this.phase } satisfies RunEvent);
    this.queue.push(
      `[gate] The user approved advancing to Phase ${this.phase} (${PHASES[this.phase - 1]}). Proceed.`,
    );
  }

  private async *inputStream(): AsyncGenerator<any> {
    yield this.userMessage(
      "Begin with Phase 1: call mirror__get_inventory, present the inventory and your " +
        "mining plan (which sources, what sampling — see mirror__get_sample_plan), then stop " +
        "and wait. The app collects my approval and will tell you when to proceed.",
    );
    while (this.status === "running") {
      const text = await this.queue.next();
      yield this.userMessage(text);
    }
  }

  private userMessage(text: string) {
    return {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
      parent_tool_use_id: null,
      session_id: "",
    };
  }

  async start(): Promise<void> {
    await fs.mkdir(this.runDir, { recursive: true });
    const ctx: ToolContext = {
      sources: this.sources,
      redactor: this.redactor,
      runDir: this.runDir,
      filesRead: new Set(),
    };

    try {
      const stream = query({
        prompt: this.inputStream(),
        options: {
          systemPrompt: SYSTEM_PROMPT,
          mcpServers: { mirror: createMirrorTools(ctx) },
          allowedTools: MIRROR_TOOL_NAMES,
          disallowedTools: [
            "Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch",
            "Task", "NotebookEdit", "TodoWrite", "AskUserQuestion",
          ],
          permissionMode: "dontAsk",
          model: process.env.MIRROR_MODEL,
          maxTurns: 500,
        },
      });

      for await (const message of stream as AsyncIterable<any>) {
        if (message.type === "assistant") {
          for (const block of message.message?.content ?? []) {
            if (block.type === "text" && block.text) {
              this.emit("event", { type: "assistant_text", text: block.text } satisfies RunEvent);
            } else if (block.type === "tool_use") {
              this.emit("event", {
                type: "tool_activity",
                text: block.name?.replace("mcp__mirror__", "mirror: "),
              } satisfies RunEvent);
            }
          }
          // The agent finished a turn and is waiting on the queue.
          this.emit("event", { type: "waiting" } satisfies RunEvent);
        } else if (message.type === "result") {
          this.status = "done";
          await this.writeAuditLog(ctx);
          this.emit("event", { type: "done" } satisfies RunEvent);
        }
      }
    } catch (err) {
      this.status = "error";
      await this.writeAuditLog(ctx).catch(() => {});
      this.emit("event", { type: "error", text: String(err) } satisfies RunEvent);
    }
  }

  /** Local-only audit: what redaction fired, plus the pseudonym mapping. */
  private async writeAuditLog(ctx: ToolContext): Promise<void> {
    const audit = {
      filesRead: [...ctx.filesRead],
      redactionHits: this.redactor.auditHits,
      pseudonymMapping: this.redactor.mappingTable(),
    };
    await fs.writeFile(path.join(this.runDir, "audit.json"), JSON.stringify(audit, null, 2));
  }
}
