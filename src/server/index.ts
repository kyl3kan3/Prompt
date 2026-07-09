import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MirrorRun, PHASES, type RunEvent } from "../agent/run.js";
import { toInventory } from "../core/discovery.js";
import type { Source } from "../core/types.js";

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");

const ARTIFACTS = ["evidence.md", "mirror.md", "roadmap.md", "proposals.md", "audit.json"];

export function createServer(sources: Source[]) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(WEB_DIR));

  let run: MirrorRun | null = null;
  // Replay buffer so a refreshed browser tab catches up on the whole run.
  const eventLog: RunEvent[] = [];
  const sseClients = new Set<express.Response>();

  function broadcast(event: RunEvent): void {
    eventLog.push(event);
    for (const res of sseClients) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }

  app.get("/api/inventory", (_req, res) => {
    res.json({ inventory: toInventory(sources), phases: PHASES });
  });

  app.post("/api/run/start", (req, res) => {
    if (run && run.status === "running") {
      res.status(409).json({ error: "A run is already in progress" });
      return;
    }
    if (req.body?.consent !== true) {
      res.status(400).json({ error: "Consent to the data flow is required to start" });
      return;
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(400).json({ error: "ANTHROPIC_API_KEY is not set. Export it and restart mirror." });
      return;
    }
    eventLog.length = 0;
    run = new MirrorRun(sources);
    run.on("event", broadcast);
    void run.start();
    res.json({ ok: true, runDir: run.runDir });
  });

  app.get("/api/run/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    for (const event of eventLog) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
  });

  app.post("/api/run/message", (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!run || run.status !== "running") {
      res.status(409).json({ error: "No run in progress" });
      return;
    }
    if (!text) {
      res.status(400).json({ error: "Empty message" });
      return;
    }
    run.sendUser(text);
    res.json({ ok: true });
  });

  app.post("/api/run/approve", (_req, res) => {
    if (!run || run.status !== "running") {
      res.status(409).json({ error: "No run in progress" });
      return;
    }
    run.approveGate();
    res.json({ ok: true, phase: run.phase });
  });

  app.get("/api/run/artifacts", async (_req, res) => {
    if (!run) {
      res.json({ artifacts: [] });
      return;
    }
    const artifacts: Array<{ name: string; content: string }> = [];
    for (const name of ARTIFACTS) {
      try {
        artifacts.push({ name, content: await fs.readFile(path.join(run.runDir, name), "utf8") });
      } catch {
        // not written yet
      }
    }
    res.json({ artifacts, runDir: run.runDir });
  });

  return app;
}
