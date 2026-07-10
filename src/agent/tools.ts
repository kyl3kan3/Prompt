import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readSession } from "../core/adapters/index.js";
import { toInventory } from "../core/discovery.js";
import { NAMED_SWEEPS, sweep, verifyReceipt } from "../core/grep.js";
import { validateTarget, type ProposalStore } from "../core/proposals.js";
import type { Redactor } from "../core/redact/index.js";
import { readRunArtifacts } from "../core/runs.js";
import { BUDGET, planSample } from "../core/sampling.js";
import type { Source } from "../core/types.js";

export interface ToolContext {
  sources: Source[];
  redactor: Redactor;
  /** Local run directory: evidence.md, artifacts, audit log all live here. */
  runDir: string;
  /** Mutable read-budget state, enforced across the whole run. */
  filesRead: Set<string>;
  homeDir: string;
  proposals: ProposalStore;
  /** Previous run directory, if one exists — enables drift observations. */
  prevRunDir: string | null;
  /** Lets tools surface UI events (e.g. a new proposal) through the run. */
  onEvent?: (event: { type: string }) => void;
}

const ARTIFACT_NAMES = ["mirror.md", "roadmap.md", "proposals.md"] as const;

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/** All model-facing archive access goes through these tools — and every string
 * they return has passed through the Redactor. */
export function createMirrorTools(ctx: ToolContext) {
  return createSdkMcpServer({
    name: "mirror",
    version: "0.1.0",
    tools: [
      tool(
        "get_inventory",
        "Inventory of discovered session archives: tool, path, file count, size, date range.",
        {},
        async () => ok(JSON.stringify(toInventory(ctx.sources), null, 2)),
      ),

      tool(
        "get_sample_plan",
        "The budgeted sample: 15 newest, 10 oldest, 20 spread across the middle, per source.",
        {},
        async () => {
          const plan = ctx.sources.map((s) => {
            const { newest, oldest, middle } = planSample(s.files);
            const brief = (files: typeof s.files) =>
              files.map((f) => ({ path: f.path, date: new Date(f.mtimeMs).toISOString() }));
            return { tool: s.tool, newest: brief(newest), oldest: brief(oldest), middle: brief(middle) };
          });
          return ok(JSON.stringify(plan, null, 2));
        },
      ),

      tool(
        "read_session",
        `A redacted excerpt of one session file (max ${BUDGET.maxLinesPerFile} message-lines). Run budget: ${BUDGET.maxFilesPerRun} files.`,
        { file_path: z.string().describe("Path from get_sample_plan or a sweep hit") },
        async ({ file_path }) => {
          const source = ctx.sources.find((s) => s.files.some((f) => f.path === file_path));
          if (!source) return ok(`Not an archive file known to this run: ${file_path}`);
          if (!ctx.filesRead.has(file_path) && ctx.filesRead.size >= BUDGET.maxFilesPerRun) {
            return ok(`Read budget exhausted (${BUDGET.maxFilesPerRun} files). Work with what you have.`);
          }
          ctx.filesRead.add(file_path);
          const file = source.files.find((f) => f.path === file_path)!;
          const session = await readSession(source.kind, file);
          const lines: string[] = [];
          for (const msg of session.messages) {
            for (const raw of msg.text.split("\n")) {
              if (lines.length >= BUDGET.maxLinesPerFile) break;
              const stamp = msg.timestamp ? ` ${msg.timestamp}` : "";
              lines.push(`[${msg.role}${stamp}] ${ctx.redactor.clean(raw).slice(0, 400)}`);
            }
          }
          return ok(lines.length ? lines.join("\n") : "(no extractable messages)");
        },
      ),

      tool(
        "sweep",
        `Scan ALL sessions locally for a pattern; returns total count plus redacted dated matches. Named sweeps: ${Object.keys(NAMED_SWEEPS).join(", ")} — or pass a custom regex.`,
        {
          named: z.string().optional().describe("A named sweep"),
          regex: z.string().optional().describe("Custom regex (case-insensitive)"),
        },
        async ({ named, regex }) => {
          let pattern: RegExp | undefined = named ? NAMED_SWEEPS[named] : undefined;
          if (!pattern && regex) {
            try {
              pattern = new RegExp(regex, "i");
            } catch (e) {
              return ok(`Invalid regex: ${e}`);
            }
          }
          if (!pattern) return ok(`Pass "named" (one of: ${Object.keys(NAMED_SWEEPS).join(", ")}) or "regex".`);
          const result = await sweep(ctx.sources, pattern, ctx.redactor);
          return ok(JSON.stringify(result, null, 2));
        },
      ),

      tool(
        "append_evidence",
        "Append a section to evidence.md in the local run directory.",
        {
          section: z.string().describe("Section heading, e.g. 'Repetition tax'"),
          markdown: z.string().describe("Body: short quotes, dates, counts"),
        },
        async ({ section, markdown }) => {
          const file = path.join(ctx.runDir, "evidence.md");
          await fs.appendFile(file, `\n## ${section}\n\n${markdown}\n`);
          return ok(`Appended to ${file}`);
        },
      ),

      tool(
        "verify_receipt",
        "Mechanically verify that a quote exists in the cited session file. Verify every receipt before citing it; drop any that fail.",
        {
          file_path: z.string(),
          quote: z.string().describe("The exact (redacted) text you intend to cite"),
        },
        async ({ file_path, quote }) => {
          const source = ctx.sources.find((s) => s.files.some((f) => f.path === file_path));
          if (!source) return ok(`VERIFICATION FAILED — unknown file: ${file_path}`);
          const found = await verifyReceipt(source, file_path, quote, ctx.redactor);
          return ok(found ? "VERIFIED" : "VERIFICATION FAILED — do not cite this receipt");
        },
      ),

      tool(
        "write_artifact",
        `Write a run artifact to the local run directory. Allowed names: ${ARTIFACT_NAMES.join(", ")}.`,
        {
          name: z.enum(ARTIFACT_NAMES),
          markdown: z.string(),
        },
        async ({ name, markdown }) => {
          const file = path.join(ctx.runDir, name);
          await fs.writeFile(file, markdown);
          return ok(`Wrote ${file}`);
        },
      ),

      tool(
        "read_previous_run",
        "Artifacts from the previous mirror run, if any. Use them to observe drift: what changed since last time, which roadmap items got receipts, which patterns persisted.",
        {},
        async () => {
          if (!ctx.prevRunDir) return ok("No previous run found. This is the first mirror.");
          const artifacts = await readRunArtifacts(ctx.prevRunDir);
          if (Object.keys(artifacts).length === 0) return ok("Previous run left no readable artifacts.");
          const parts = Object.entries(artifacts).map(
            ([name, content]) => `=== ${name} (from ${path.basename(ctx.prevRunDir!)}) ===\n${content.slice(0, 12000)}`,
          );
          return ok(parts.join("\n\n"));
        },
      ),

      tool(
        "read_config",
        "Read one of the user's agent config files (CLAUDE.md, AGENTS.md, or a file under ~/.claude/{skills,commands,agents}). Redacted. Read before proposing changes.",
        { path: z.string().describe("Absolute path, e.g. ~ expanded") },
        async ({ path: target }) => {
          const invalid = validateTarget(ctx.homeDir, target);
          if (invalid) return ok(`Cannot read: ${invalid}`);
          try {
            const content = await fs.readFile(path.resolve(target), "utf8");
            return ok(ctx.redactor.clean(content).slice(0, 20000));
          } catch {
            return ok("(file does not exist yet)");
          }
        },
      ),

      tool(
        "propose_change",
        "Propose one config change for per-diff user approval. Provide the FULL new file content; the app computes the diff and shows it to the user. Never state or imply a change was applied — only the user can apply it, in the UI.",
        {
          title: z.string().describe("One line: what this change does and which pattern it kills"),
          target_path: z.string().describe("Absolute path of the config file"),
          new_content: z.string().describe("Complete proposed file content"),
        },
        async ({ title, target_path, new_content }) => {
          const result = await ctx.proposals.propose(title, target_path, new_content);
          if (typeof result === "string") return ok(`Proposal rejected: ${result}`);
          ctx.onEvent?.({ type: "proposal" });
          return ok(
            `Recorded proposal ${result.id} (${result.kind} ${result.target}). ` +
              `It is PENDING until the user approves it in the app.\n` +
              ctx.redactor.clean(result.diff).slice(0, 4000),
          );
        },
      ),
    ],
  });
}
