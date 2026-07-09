# Mirror

A local-first app that mines your AI agent session archives — Claude Code, Codex CLI,
opencode — into an evidence-backed mirror of how you actually work: what you return to,
what you abandon, what you correct, what you ask for over and over and never automate.

Based on "the prompt" (a six-phase prompt originally written to be pasted into Claude
Code), rebuilt as an app with the two guarantees a prompt cannot make:

1. **A real privacy boundary.** Your archives are read *in place* — there is no upload
   and no import step. Everything the model may see passes through a local redaction
   pass first (secret masking + email/IP pseudonymization), and a local audit log
   records exactly what was read and what redaction fired. The honest framing, shown
   on the consent screen: raw files never leave your machine; *redacted sampled
   excerpts* are sent to the Anthropic API under your own key.
2. **Mechanically verified receipts.** Every quote the mirror cites is checked against
   the source session file before it can be used. A receipt that fails verification is
   dropped. One hallucinated quote poisons a mirror; this is the guard.

## How it works

```
discovery ─→ inventory + consent screen (nothing read yet)
              │ user approves
              ▼
one continuous agent session (Claude Agent SDK) across six phases:
  1 Excavate   inventory + mining plan            [gate: user approves]
  2 Distill    budgeted mining → evidence.md      [gate]
  3 Interview  five hypotheses, one question at a time
  4 The Mirror evidence-cited portrait, hardest truth last
  5 Leverage   WASTE / DELEGATE / FOCUS / DROP / KEEP / RHYTHM
  6 Residue    mirror.md, roadmap.md, proposed config diffs (never auto-applied)
```

The model has **no filesystem, shell, or network tools**. Its only access to your
archives is a set of `mirror__*` tools that enforce the mining budget in code
(150 lines per session, 200 sessions per run, 15-newest/10-oldest/20-middle sampling)
and redact everything on the way out.

## Run it

```sh
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # your key, your data-retention policy
npm run dev                            # discovers archives, serves http://127.0.0.1:3777
```

A full run reads up to 200 sessions and costs roughly $5–15 in API tokens depending on
model and archive size. Artifacts (evidence.md, mirror.md, roadmap.md, proposals.md,
audit.json) are written to `~/.mirror/runs/<timestamp>/` and never leave your machine.

```sh
npm test        # unit tests: adapters, redaction, sampling, discovery, receipts
npm run build   # compile to dist/
```

## Layout

```
src/core/        discovery, format adapters, sampling budget, sweeps, redaction
src/agent/       six-phase system prompt, redaction-gated tools, run orchestrator
src/server/      express API: inventory, run lifecycle, SSE events, artifacts
src/cli.ts       entry point
web/             no-build vanilla UI: consent screen, phase rail, transcript, artifacts
test/            vitest suite
```

## Design decisions

- **One continuous session, not decomposed calls.** The entity that mined your
  archives is the one that interviews you and writes your mirror. The server is a
  viewport onto that session; structure in the UI is parsed from output, never forced
  onto generation.
- **Budget enforced in code, not by model discipline.** The read cap, sampling spread,
  and line limits live in `src/core/sampling.ts` and the tool layer.
- **Gates are real.** Phases advance only when the user clicks approve; the approval
  is delivered to the model as a message it cannot fake.
- **No database.** v1 reads archives on demand through the adapters. A normalized
  local index (and with it incremental re-runs and drift tracking) is the first
  post-v1 milestone.

## Roadmap

- [ ] Drift tracking: diff evidence/mirror snapshots across runs ("in March you called
      X temporary; it's July and you've logged 40 more hours on it")
- [ ] Residue diffs applied via per-diff approval UI (currently written to
      proposals.md only)
- [ ] opencode/Cursor/aider adapters beyond the lenient default
- [ ] Tauri desktop shell around the same core + UI
- [ ] Local-model option for the mining phase (only redacted evidence reaches the
      frontier model)
