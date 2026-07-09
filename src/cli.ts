#!/usr/bin/env node
import { discoverSources, toInventory } from "./core/discovery.js";
import { createServer } from "./server/index.js";

function formatBytes(n: number): string {
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

const day = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3777);

  console.log("mirror — discovering session archives (read in place, nothing uploaded)\n");
  const sources = await discoverSources();

  if (sources.length === 0) {
    console.log("No agent session archives found (looked for Claude Code, Codex, opencode).");
    console.log("Run some sessions first — the mirror needs a record to read.");
    process.exit(1);
  }

  for (const row of toInventory(sources)) {
    console.log(
      `  ${row.tool.padEnd(12)} ${String(row.fileCount).padStart(5)} sessions  ` +
        `${formatBytes(row.totalSizeBytes).padStart(9)}  ${day(row.oldestMs)} → ${day(row.newestMs)}  ${row.path}`,
    );
  }

  const app = createServer(sources);
  app.listen(port, "127.0.0.1", () => {
    console.log(`\n  Open http://127.0.0.1:${port} to begin.`);
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  Note: ANTHROPIC_API_KEY is not set — you can browse the inventory but not start a run.");
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
