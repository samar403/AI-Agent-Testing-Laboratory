import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import YAML from "yaml";
import {
  AGENT_MODELS,
  MOCK_VARIANTS,
  PLANS,
  compareRuns,
  hasAnthropicCredentials,
  summarizeRun,
  toJUnit,
  toMarkdown,
  validateSuite,
  type AgentConfig,
  type ChaosProfile,
  type PlanId,
  type RunOptions,
  type SuiteSpec,
  type TrialResult,
} from "@agentlab/core";
import { id } from "./db.ts";
import { HttpError, type RunEvent, type RunManager } from "./runs.ts";
import type { Store } from "./store.ts";

const VERSION = "0.1.0";

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, "request body must be JSON");
  }
}

function parseSuiteInput(input: { spec?: unknown; yaml?: string }): SuiteSpec {
  let raw = input.spec;
  if (input.yaml !== undefined) {
    try {
      raw = YAML.parse(input.yaml);
    } catch (e) {
      throw new HttpError(400, `YAML parse error: ${(e as Error).message}`);
    }
  }
  const v = validateSuite(raw);
  if (!v.ok) throw Object.assign(new HttpError(400, "suite is invalid"), { details: v.errors });
  return v.suite;
}

function validateAgentConfig(config: AgentConfig): AgentConfig {
  if (!config || typeof config !== "object") throw new HttpError(400, "config is required");
  switch (config.kind) {
    case "mock":
      if (!(config.variant in MOCK_VARIANTS)) throw new HttpError(400, "unknown simulated variant");
      return { kind: "mock", variant: config.variant };
    case "anthropic":
      if (!config.model || !config.systemPrompt?.trim()) throw new HttpError(400, "model and systemPrompt are required");
      return {
        kind: "anthropic",
        model: config.model,
        systemPrompt: config.systemPrompt,
        effort: config.effort ?? "medium",
        maxTokens: config.maxTokens,
        allowFallback: config.allowFallback !== false,
      };
    case "http":
      try {
        const u = new URL(config.url);
        if (!/^https?:$/.test(u.protocol)) throw new Error();
      } catch {
        throw new HttpError(400, "url must be an http(s) URL");
      }
      return { kind: "http", url: config.url, headers: config.headers, timeoutMs: config.timeoutMs };
    default:
      throw new HttpError(400, "config.kind must be mock | anthropic | http");
  }
}

function clampOptions(o: Partial<RunOptions>): RunOptions {
  const trials = Math.round(Number(o.trials ?? 5));
  if (!(trials >= 1 && trials <= 50)) throw new HttpError(400, "trials must be between 1 and 50");
  const chaos: ChaosProfile | undefined = o.chaos?.global
    ? {
        global: {
          errorRate: clamp01(o.chaos.global.errorRate),
          timeoutRate: clamp01(o.chaos.global.timeoutRate),
          malformedRate: clamp01(o.chaos.global.malformedRate),
          ...(o.chaos.global.latencyMs ? { latencyMs: o.chaos.global.latencyMs } : {}),
        },
      }
    : undefined;
  return {
    trials,
    seed: o.seed !== undefined ? Math.abs(Math.round(Number(o.seed))) : Math.floor(Math.random() * 1e6),
    concurrency: o.concurrency ? Math.max(1, Math.min(16, Math.round(o.concurrency))) : undefined,
    chaos,
    scenarioIds: Array.isArray(o.scenarioIds) ? o.scenarioIds.map(String) : undefined,
  };
}

function clamp01(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function createApp(store: Store, runs: RunManager) {
  const app = new Hono().basePath("/api");

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, details: (err as HttpError & { details?: string[] }).details }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  // Optional workspace lock for public deployments: set AGENTLAB_ADMIN_TOKEN and every route except
  // /health and the API-key-authenticated /ingest requires it (header, or ?token= for EventSource).
  app.use("*", async (c, next) => {
    const required = process.env.AGENTLAB_ADMIN_TOKEN;
    const path = c.req.path.replace(/^\/api/, "");
    if (!required || path === "/health" || path === "/ingest") return next();
    const given = c.req.header("x-agentlab-token") ?? c.req.query("token");
    if (given !== required) return c.json({ error: "workspace token required", auth: true }, 401);
    return next();
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      version: VERSION,
      anthropic: hasAnthropicCredentials(),
      locked: Boolean(process.env.AGENTLAB_ADMIN_TOKEN),
      models: AGENT_MODELS,
      variants: MOCK_VARIANTS,
    }),
  );

  // ── Overview ────────────────────────────────────────────────────────────────────────────────
  app.get("/overview", (c) => {
    const agents = store.listAgents();
    const suites = store.listSuites();
    const allRuns = store.listRuns({ limit: 500 });
    const completed = allRuns.filter((r) => r.status === "completed" && r.summary);
    const latestByPair = new Map<string, (typeof completed)[number]>();
    for (const r of completed) {
      const key = `${r.suite_id}:${r.agent_version_id}`;
      if (!latestByPair.has(key)) latestByPair.set(key, r);
    }
    const openFindings = [...latestByPair.values()].flatMap((r) =>
      r.summary!.findings.filter((f) => f.severity === "critical").map((f) => ({ ...f, runId: r.id, agentLabel: r.agent_label, suiteName: r.suite_name })),
    );
    const history = completed
      .slice()
      .reverse()
      .map((r) => ({ runId: r.id, versionId: r.agent_version_id, suiteId: r.suite_id, label: r.agent_label, at: r.created_at, ri: r.summary!.reliabilityIndex, passRate: r.summary!.passRate }));
    const best = [...latestByPair.values()].sort((a, b) => b.summary!.reliabilityIndex - a.summary!.reliabilityIndex)[0];
    return c.json({
      counts: { agents: agents.length, versions: agents.reduce((s, a) => s + a.versions.length, 0), suites: suites.length, runs: allRuns.length },
      bestRun: best ? { id: best.id, label: best.agent_label, suite: best.suite_name, ri: best.summary!.reliabilityIndex } : null,
      totals: {
        trials: completed.reduce((s, r) => s + r.summary!.trials, 0),
        regressionsCaught: countRegressions(completed),
        criticalFindings: openFindings.length,
      },
      recentRuns: allRuns.slice(0, 8).map(lightRun),
      openFindings: openFindings.slice(0, 8),
      history,
      usage: store.usage(),
      anthropic: hasAnthropicCredentials(),
    });
  });

  // ── Agents ──────────────────────────────────────────────────────────────────────────────────
  app.get("/agents", (c) => c.json(store.listAgents()));
  app.post("/agents", async (c) => {
    const b = await body<{ name?: string; description?: string; version?: string; config?: AgentConfig; notes?: string }>(c);
    if (!b.name?.trim()) throw new HttpError(400, "name is required");
    const agent = store.createAgent(b.name.trim(), b.description?.trim() ?? "");
    if (b.config) store.createVersion(agent.id, b.version?.trim() || "v1", validateAgentConfig(b.config), b.notes ?? "");
    return c.json(store.getAgent(agent.id), 201);
  });
  app.get("/agents/:id", (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) throw new HttpError(404, "agent not found");
    return c.json(agent);
  });
  app.patch("/agents/:id", async (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) throw new HttpError(404, "agent not found");
    const b = await body<{ name?: string; description?: string }>(c);
    store.updateAgent(agent.id, b.name?.trim() || agent.name, b.description ?? agent.description);
    return c.json(store.getAgent(agent.id));
  });
  app.delete("/agents/:id", (c) => {
    store.deleteAgent(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/agents/:id/versions", async (c) => {
    const agent = store.getAgent(c.req.param("id"));
    if (!agent) throw new HttpError(404, "agent not found");
    const b = await body<{ version?: string; config: AgentConfig; notes?: string }>(c);
    const version = b.version?.trim() || `v${agent.versions.length + 1}`;
    if (agent.versions.some((v) => v.version === version)) throw new HttpError(409, `version ${version} already exists`);
    return c.json(store.createVersion(agent.id, version, validateAgentConfig(b.config), b.notes ?? ""), 201);
  });
  app.delete("/versions/:id", (c) => {
    store.deleteVersion(c.req.param("id"));
    return c.body(null, 204);
  });

  // ── Suites ──────────────────────────────────────────────────────────────────────────────────
  app.get("/suites", (c) =>
    c.json(
      store.listSuites().map((s) => ({
        ...s,
        scenarioCount: s.spec.scenarios.length,
        toolCount: s.spec.tools.length,
        criteriaCount: s.spec.scenarios.reduce((n, sc) => n + sc.criteria.length, 0),
        lastRun: lightRunOrNull(store.listRuns({ suiteId: s.id, limit: 1 })[0]),
      })),
    ),
  );
  app.post("/suites/validate", async (c) => {
    const b = await body<{ spec?: unknown; yaml?: string }>(c);
    try {
      const suite = parseSuiteInput(b);
      return c.json({ ok: true, scenarios: suite.scenarios.length, tools: suite.tools.length });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message, details: (e as { details?: string[] }).details ?? [] });
    }
  });
  app.post("/suites", async (c) => c.json(store.createSuite(parseSuiteInput(await body(c))), 201));
  app.get("/suites/:id", (c) => {
    const s = store.getSuite(c.req.param("id"));
    if (!s) throw new HttpError(404, "suite not found");
    return c.json({ ...s, yaml: YAML.stringify(s.spec), runs: store.listRuns({ suiteId: s.id, limit: 20 }).map(lightRun) });
  });
  app.put("/suites/:id", async (c) => {
    const s = store.getSuite(c.req.param("id"));
    if (!s) throw new HttpError(404, "suite not found");
    store.updateSuite(s.id, parseSuiteInput(await body(c)));
    return c.json(store.getSuite(s.id));
  });
  app.delete("/suites/:id", (c) => {
    store.deleteSuite(c.req.param("id"));
    return c.body(null, 204);
  });

  // ── Runs ────────────────────────────────────────────────────────────────────────────────────
  app.get("/runs", (c) =>
    c.json(store.listRuns({ suiteId: c.req.query("suiteId"), versionId: c.req.query("versionId"), limit: Number(c.req.query("limit") ?? 100) }).map(lightRun)),
  );
  app.post("/runs", async (c) => {
    const b = await body<{ suiteId: string; versionIds: string[]; options?: Partial<RunOptions> }>(c);
    if (!b.suiteId || !Array.isArray(b.versionIds) || !b.versionIds.length) throw new HttpError(400, "suiteId and versionIds[] are required");
    if (b.versionIds.length > 6) throw new HttpError(400, "compare at most 6 versions per experiment");
    const created = runs.start({ suiteId: b.suiteId, versionIds: b.versionIds, options: clampOptions(b.options ?? {}) });
    return c.json(created.map(lightRun), 201);
  });
  app.get("/runs/:id", (c) => {
    const run = store.getRun(c.req.param("id"));
    if (!run) throw new HttpError(404, "run not found");
    const snap = store.getRunSnapshot(run.id)!;
    return c.json({
      ...run,
      suite: { tools: snap.suite.tools.map((t) => t.name), scenarios: snap.suite.scenarios.map((s) => ({ id: s.id, title: s.title, tags: s.tags ?? [], criteria: s.criteria.length })) },
      agent: redactConfig(snap.agent),
      cells: store.listTrialCells(run.id),
      siblings: store.listRuns({ limit: 500 }).filter((r) => r.experiment_id === run.experiment_id && r.id !== run.id).map(lightRun),
    });
  });
  app.delete("/runs/:id", (c) => {
    runs.cancel(c.req.param("id"));
    store.deleteRun(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/runs/:id/cancel", (c) => c.json({ cancelled: runs.cancel(c.req.param("id")) }));
  app.get("/runs/:id/events", (c) => {
    const run = store.getRun(c.req.param("id"));
    if (!run) throw new HttpError(404, "run not found");
    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = runs.subscribe(run.id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ status: store.getRun(run.id)?.status }) });
      let finished = !runs.isActive(run.id) && run.status !== "queued";
      while (!finished && !stream.aborted) {
        if (!queue.length) await new Promise<void>((r) => ((wake = r), setTimeout(r, 15_000)));
        wake = null;
        if (!queue.length) {
          await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
        const e = queue.shift()!;
        await stream.writeSSE({ event: e.type, data: JSON.stringify(e) });
        if (e.type === "status" && e.status !== "running") finished = true;
      }
      unsubscribe();
    });
  });
  app.get("/runs/:id/trials/:trialId", (c) => {
    const t = store.getTrial(c.req.param("trialId"));
    if (!t || t.runId !== c.req.param("id")) throw new HttpError(404, "trial not found");
    const run = store.getRun(t.runId)!;
    const snap = store.getRunSnapshot(t.runId)!;
    const scenario = snap.suite.scenarios.find((s) => s.id === t.scenarioId);
    const cells = store.listTrialCells(t.runId).filter((x) => x.scenarioId === t.scenarioId);
    return c.json({ ...t, run: lightRun(run), scenario, siblings: cells.map((x) => ({ id: x.id, trialIndex: x.trialIndex, passed: x.passed })) });
  });
  app.get("/runs/:id/report", (c) => {
    const run = store.getRun(c.req.param("id"));
    if (!run?.summary) throw new HttpError(404, "run has no results yet");
    const format = c.req.query("format") ?? "json";
    if (format === "junit") {
      c.header("content-type", "application/xml");
      c.header("content-disposition", `attachment; filename="agentlab-${run.id}.xml"`);
      return c.body(toJUnit(run.suite_name, run.agent_label, store.listTrials(run.id), run.summary));
    }
    if (format === "markdown") return c.text(toMarkdown(run.suite_name, run.agent_label, run.summary));
    c.header("content-disposition", `attachment; filename="agentlab-${run.id}.json"`);
    return c.json({ run: lightRun(run), summary: run.summary, trials: store.listTrials(run.id) });
  });

  app.get("/compare", (c) => {
    const a = store.getRun(c.req.query("a") ?? "");
    const b = store.getRun(c.req.query("b") ?? "");
    if (!a?.summary || !b?.summary) throw new HttpError(404, "both runs must exist and be finished");
    return c.json({ a: { ...lightRun(a), summary: a.summary }, b: { ...lightRun(b), summary: b.summary }, comparison: compareRuns(a.summary, b.summary) });
  });

  // ── CI ingest (API-key auth) ────────────────────────────────────────────────────────────────
  app.post("/ingest", async (c) => {
    const key = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!key || !store.verifyApiKey(key)) throw new HttpError(401, "invalid or missing API key");
    const b = await body<{ suite: SuiteSpec; agentLabel: string; options: RunOptions; trials: TrialResult[]; commit?: string }>(c);
    const v = validateSuite(b.suite);
    if (!v.ok) throw Object.assign(new HttpError(400, "suite is invalid"), { details: v.errors });
    if (!Array.isArray(b.trials) || !b.trials.length) throw new HttpError(400, "trials[] is required");
    const existing = store.listSuites().find((s) => s.name === v.suite.name);
    const suiteRow = existing ?? store.createSuite(v.suite);
    const summary = summarizeRun(b.trials, Object.fromEntries(v.suite.scenarios.map((s) => [s.id, s.title])));
    const run = store.createRun({
      experimentId: id("exp"),
      suiteId: suiteRow.id,
      versionId: null,
      suite: v.suite,
      agentLabel: `${b.agentLabel || "CI agent"}${b.commit ? ` @ ${b.commit.slice(0, 7)}` : ""}`,
      agentConfig: { kind: "external" },
      options: b.options ?? { trials: 1 },
      total: b.trials.length,
      source: "ci",
    });
    for (const t of b.trials) store.addTrial(run.id, t);
    store.setRunStatus(run.id, "completed", { summary, finishedAt: Date.now() });
    store.recordUsage(run.id, b.trials.length, summary.costUsd);
    return c.json({ runId: run.id, reliabilityIndex: summary.reliabilityIndex }, 201);
  });

  // ── Usage, billing, keys ────────────────────────────────────────────────────────────────────
  app.get("/usage", (c) => c.json({ ...store.usage(), plans: PLANS }));
  app.post("/usage/plan", async (c) => {
    const b = await body<{ planId: PlanId }>(c);
    if (!PLANS.some((p) => p.id === b.planId)) throw new HttpError(400, "unknown plan");
    store.setPlan(b.planId);
    return c.json(store.usage());
  });
  app.get("/keys", (c) => c.json(store.listApiKeys()));
  app.post("/keys", async (c) => {
    const b = await body<{ name?: string }>(c);
    return c.json(store.createApiKey(b.name?.trim() || "CI key"), 201);
  });
  app.delete("/keys/:id", (c) => {
    store.deleteApiKey(c.req.param("id"));
    return c.body(null, 204);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  return app;
}

type RunLike = ReturnType<Store["listRuns"]>[number];

function lightRun(r: RunLike) {
  return {
    id: r.id,
    experimentId: r.experiment_id,
    suiteId: r.suite_id,
    versionId: r.agent_version_id,
    suiteName: r.suite_name,
    agentLabel: r.agent_label,
    status: r.status,
    options: r.options,
    total: r.total,
    done: r.done,
    error: r.error,
    source: r.source,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
    headline: r.summary
      ? {
          ri: r.summary.reliabilityIndex,
          passRate: r.summary.passRate,
          passHatK: r.summary.passHatK,
          k: r.summary.k,
          toolCallAccuracy: r.summary.toolCallAccuracy,
          critical: r.summary.findings.filter((f) => f.severity === "critical").length,
          costUsd: r.summary.costUsd,
        }
      : null,
  };
}

function lightRunOrNull(r: RunLike | undefined) {
  return r ? lightRun(r) : null;
}

function redactConfig(cfg: AgentConfig | { kind: "external" }) {
  if (cfg.kind === "http" && cfg.headers) return { ...cfg, headers: Object.fromEntries(Object.keys(cfg.headers).map((k) => [k, "•••"])) };
  return cfg;
}

function countRegressions(runs: RunLike[]): number {
  // Consecutive runs of the same suite where the newer agent scores significantly worse.
  const bySuite = new Map<string, RunLike[]>();
  for (const r of [...runs].reverse()) bySuite.set(r.suite_id ?? "", [...(bySuite.get(r.suite_id ?? "") ?? []), r]);
  let n = 0;
  for (const list of bySuite.values()) {
    for (let i = 1; i < list.length; i++) {
      if (list[i]!.agent_version_id === list[i - 1]!.agent_version_id) continue;
      n += compareRuns(list[i - 1]!.summary!, list[i]!.summary!).regressions;
    }
  }
  return n;
}
