# Architecture

```
┌──────────────────────────── apps/web (React + Vite) ─────────────────────────────┐
│ Landing · Bench · Experiment designer · Live microplate · Oscilloscope · Compare │
│ Suites editor (YAML + live validation) · Agents · Usage & billing · Keys · Docs  │
└───────────────▲──────────────────────────────────────────────▲──────────────────┘
                │ REST /api/*                                  │ SSE /api/runs/:id/events
┌───────────────┴──────────── apps/server (Hono + node:sqlite) ─┴──────────────────┐
│ Store (agents, versions, suites, runs, trials, usage, api_keys)                  │
│ RunManager: background experiments, cancellation, live events                    │
│ Usage metering + plan limits · API-key auth for /ingest · optional workspace lock│
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │ imports
┌───────────────┴──────────── packages/core (the engine) ──────────────────────────┐
│ runner      runExperiment → runTrial (user ↔ agent ↔ tools loop, trace, metrics) │
│ sandbox     schema validation · mocks · world state · chaos injection           │
│ simulator   ScriptedUser · LLMUser (Claude persona) · LLM judge (structured out) │
│ agents      MockSupportAgent · AnthropicAgent · HttpAgent (agentlab/v1)          │
│ criteria    15 criterion types → CriterionResult[] → pass/score                  │
│ metrics     Wilson CI · pass@k · pass^k · Fisher exact · Reliability Index ·     │
│             findings ("lab notebook") · run comparison                          │
│ report      JUnit XML · Markdown                                                 │
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │ imports
┌───────────────┴──────────── packages/cli ────────────────────────────────────────┐
│ agentlab run | validate | init | demo — gates, JUnit, Markdown, upload           │
│ action.yml wraps it as a GitHub Action                                           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Life of a trial

1. `runExperiment` expands `scenarios × trials` into jobs and runs them with bounded concurrency.
2. Each job derives a seed from `(runSeed, scenarioId, trialIndex)`, builds a fresh agent adapter and a
   `ToolSandbox` with the merged world state and chaos layers.
3. The user simulator produces a message; the agent is stepped until it answers without tool calls; each tool
   call goes through the sandbox (validate → chaos → mock → state). Everything is appended to the transcript and
   to a timed trace (virtual clock for simulated agents, wall-clock for real ones).
4. Criteria are evaluated against the transcript, final world state and metrics; the trial gets `passed` and
   `score`.
5. `summarizeRun` aggregates per-scenario and overall statistics and derives findings.

## Design decisions

- **The lab owns the agent loop.** Agents are stepped one model call at a time, so the lab can intercept,
  validate and fault every tool call and measure each step — regardless of the agent's framework.
- **Provider-native replay.** Claude agents keep the raw content blocks (including thinking) of each assistant
  turn and send them back unchanged; the HTTP protocol offers the same through an opaque `state` field. Histories
  are append-only.
- **Determinism where possible.** Chaos, simulated agents and scripted users are seeded; reruns with the same
  seed reproduce the plate exactly. LLM components are inherently stochastic — which is why the lab measures
  distributions (pass^k) instead of single outcomes.
- **Statistics over vibes.** Wilson intervals for small n, unbiased pass@k / pass^k estimators, and Fisher exact
  tests for version comparisons, so a regression verdict means something.
- **Zero native dependencies.** Storage is Node's built-in SQLite; the whole stack runs with `npm install`.
- **Snapshots.** Every run stores the exact suite and agent config it ran with, so history stays meaningful as
  suites evolve.

## Data model

| table | purpose |
|---|---|
| `agents`, `agent_versions` | an agent and its immutable versioned configs (`mock` / `anthropic` / `http`) |
| `suites` | suite specs (JSON) |
| `runs` | one suite × one version × options; status, summary, snapshots, source (`lab`/`ci`) |
| `trials` | full trial results (transcript, trace, criteria, metrics) |
| `usage_events` | metered trials and estimated model cost per run |
| `api_keys` | SHA-256 hashed keys for CI ingestion |
| `settings` | plan, seed marker |
