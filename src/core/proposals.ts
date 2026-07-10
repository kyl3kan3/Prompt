import { promises as fs } from "node:fs";
import path from "node:path";
import { redactSecrets } from "./redact/secrets.js";

/**
 * Phase 6 proposals: the model proposes full new content for an agent config
 * file; the app computes the diff, shows it to the user, and applies it only
 * on explicit per-diff approval. Nothing here is model-writable directly.
 */
export interface Proposal {
  id: string;
  title: string;
  /** Absolute path of the file the change targets. */
  target: string;
  kind: "create" | "modify";
  oldContent: string | null;
  newContent: string;
  /** Unified-style diff of current vs proposed, for the approval UI. */
  diff: string;
  /**
   * True when the current file contains content the redactor masked from the
   * model's view — the proposed content may unknowingly drop it, so the UI
   * tells the user to review extra carefully.
   */
  redactionWarning: boolean;
  status: "pending" | "applied" | "rejected" | "failed";
  error?: string;
  /** Where the pre-apply backup was written, once applied. */
  backupPath?: string;
}

/** Config files the app will ever agree to touch. */
export function validateTarget(homeDir: string, target: string): string | null {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(homeDir + path.sep) && resolved !== homeDir) {
    return `target must be inside the home directory (${homeDir})`;
  }
  const base = path.basename(resolved);
  const allowedNames = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
  const rel = path.relative(homeDir, resolved);
  const allowedDirs = [".claude/skills/", ".claude/commands/", ".claude/agents/"];
  if (allowedNames.includes(base)) return null;
  if (allowedDirs.some((d) => rel.startsWith(d))) return null;
  return `only ${allowedNames.join(", ")} or files under ~/.claude/{skills,commands,agents}/ can be changed`;
}

/** Minimal LCS line diff, unified-style. Display-only — apply writes newContent whole. */
export function computeDiff(oldText: string, newText: string, context = 3): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const header = ["--- current", "+++ proposed"];

  // Config files are small; guard anyway so a pathological input can't stall the server.
  if (a.length * b.length > 4_000_000) {
    return [...header, "@@ full replacement @@", ...a.map((l) => "-" + l), ...b.map((l) => "+" + l)].join("\n");
  }

  const m = a.length;
  const n = b.length;
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  interface Op {
    tag: " " | "-" | "+";
    line: string;
    oldLn: number;
    newLn: number;
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let oldLn = 1;
  let newLn = 1;
  const push = (tag: Op["tag"], line: string) => {
    ops.push({ tag, line, oldLn, newLn });
    if (tag !== "+") oldLn++;
    if (tag !== "-") newLn++;
  };
  while (i < m && j < n) {
    if (a[i] === b[j]) push(" ", a[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", a[i++]);
    else push("+", b[j++]);
  }
  while (i < m) push("-", a[i++]);
  while (j < n) push("+", b[j++]);

  const out = [...header];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].tag === " ") {
      k++;
      continue;
    }
    let start = k;
    while (start > 0 && ops[start - 1].tag === " " && k - start < context) start--;
    // Extend through changes separated by short unchanged runs.
    let end = k;
    let cursor = k;
    while (cursor < ops.length) {
      if (ops[cursor].tag !== " ") {
        end = cursor;
        cursor++;
        continue;
      }
      let runEnd = cursor;
      while (runEnd < ops.length && ops[runEnd].tag === " ") runEnd++;
      if (runEnd < ops.length && runEnd - cursor <= context * 2) cursor = runEnd;
      else break;
    }
    const hunkEnd = Math.min(ops.length - 1, end + context);
    const slice = ops.slice(start, hunkEnd + 1);
    const oldCount = slice.filter((s) => s.tag !== "+").length;
    const newCount = slice.filter((s) => s.tag !== "-").length;
    out.push(`@@ -${slice[0].oldLn},${oldCount} +${slice[0].newLn},${newCount} @@`);
    for (const s of slice) out.push(s.tag + s.line);
    k = hunkEnd + 1;
  }
  if (out.length === header.length) out.push("(no changes)");
  return out.join("\n");
}

export class ProposalStore {
  private items = new Map<string, Proposal>();
  private counter = 0;

  constructor(
    private homeDir: string,
    /** Backups of overwritten files go here (inside the run directory). */
    private backupDir: string,
  ) {}

  async propose(title: string, target: string, newContent: string): Promise<Proposal | string> {
    const invalid = validateTarget(this.homeDir, target);
    if (invalid) return invalid;
    const resolved = path.resolve(target);
    let oldContent: string | null = null;
    try {
      oldContent = await fs.readFile(resolved, "utf8");
    } catch {
      // creating a new file
    }
    const proposal: Proposal = {
      id: `p${++this.counter}`,
      title,
      target: resolved,
      kind: oldContent === null ? "create" : "modify",
      oldContent,
      newContent,
      diff: computeDiff(oldContent ?? "", newContent),
      redactionWarning:
        oldContent !== null && Object.keys(redactSecrets(oldContent).hits).length > 0,
      status: "pending",
    };
    this.items.set(proposal.id, proposal);
    return proposal;
  }

  list(): Proposal[] {
    return [...this.items.values()];
  }

  get(id: string): Proposal | undefined {
    return this.items.get(id);
  }

  /** Apply a pending proposal: back up the current file, then write. */
  async approve(id: string): Promise<Proposal> {
    const proposal = this.items.get(id);
    if (!proposal) throw new Error(`No such proposal: ${id}`);
    if (proposal.status !== "pending") return proposal;
    try {
      if (proposal.oldContent !== null) {
        await fs.mkdir(this.backupDir, { recursive: true });
        const backupPath = path.join(this.backupDir, `${proposal.id}-${path.basename(proposal.target)}`);
        await fs.writeFile(backupPath, proposal.oldContent);
        proposal.backupPath = backupPath;
      }
      await fs.mkdir(path.dirname(proposal.target), { recursive: true });
      await fs.writeFile(proposal.target, proposal.newContent);
      proposal.status = "applied";
    } catch (err) {
      proposal.status = "failed";
      proposal.error = String(err);
    }
    return proposal;
  }

  reject(id: string): Proposal {
    const proposal = this.items.get(id);
    if (!proposal) throw new Error(`No such proposal: ${id}`);
    if (proposal.status === "pending") proposal.status = "rejected";
    return proposal;
  }
}
