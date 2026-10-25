import { createHash, randomBytes } from "node:crypto";
import type { AgentConfig, RunOptions, RunSummary, SuiteSpec, TrialResult } from "@agentlab/core";
import { PLANS, type PlanId } from "@agentlab/core";
import { getSetting, id, json, setSetting, type DB } from "./db.ts";

export interface AgentRow {
  id: string;
  name: string;
  description: string;
  created_at: number;
}
export interface VersionRow {
  id: string;
  agent_id: string;
  version: string;
  config: AgentConfig;
  notes: string;
  created_at: number;
}
export interface SuiteRow {
  id: string;
  name: string;
  description: string;
  spec: SuiteSpec;
  created_at: number;
  updated_at: number;
}
export interface RunRow {
  id: string;
  experiment_id: string;
  suite_id: string | null;
  agent_version_id: string | null;
  suite_name: string;
  agent_label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  options: RunOptions;
  summary: RunSummary | null;
  total: number;
  done: number;
  error: string | null;
  source: "lab" | "ci";
  created_at: number;
  finished_at: number | null;
}

type Raw = Record<string, unknown>;

const versionFrom = (r: Raw): VersionRow => ({ ...(r as unknown as VersionRow), config: json(r.config) });
const suiteFrom = (r: Raw): SuiteRow => ({ ...(r as unknown as SuiteRow), spec: json(r.spec) });
const runFrom = (r: Raw): RunRow => {
  const { suite_snapshot: _s, agent_snapshot: _a, ...rest } = r;
  return { ...(rest as unknown as RunRow), options: json(r.options), summary: r.summary ? json(r.summary) : null };
};

export class Store {
  constructor(readonly db: DB) {}

  // ── Agents ────────────────────────────────────────────────────────────────────────────────────
  listAgents(): Array<AgentRow & { versions: VersionRow[] }> {
    const agents = this.db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all() as unknown as AgentRow[];
    const versions = (this.db.prepare("SELECT * FROM agent_versions ORDER BY created_at ASC").all() as Raw[]).map(versionFrom);
    return agents.map((a) => ({ ...a, versions: versions.filter((v) => v.agent_id === a.id) }));
  }
  getAgent(agentId: string) {
    return this.listAgents().find((a) => a.id === agentId) ?? null;
  }
  createAgent(name: string, description = "", at = Date.now()): AgentRow {
    const row = { id: id("ag"), name, description, created_at: at };
    this.db.prepare("INSERT INTO agents VALUES (?, ?, ?, ?)").run(row.id, row.name, row.description, row.created_at);
    return row;
  }
  updateAgent(agentId: string, name: string, description: string) {
    this.db.prepare("UPDATE agents SET name = ?, description = ? WHERE id = ?").run(name, description, agentId);
  }
  deleteAgent(agentId: string) {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(agentId);
  }
  createVersion(agentId: string, version: string, config: AgentConfig, notes = "", at = Date.now()): VersionRow {
    const row = { id: id("av"), agent_id: agentId, version, config, notes, created_at: at };
    this.db.prepare("INSERT INTO agent_versions VALUES (?, ?, ?, ?, ?, ?)").run(row.id, agentId, version, JSON.stringify(config), notes, at);
    return row;
  }
  getVersion(versionId: string): (VersionRow & { agent_name: string }) | null {
    const r = this.db
      .prepare("SELECT v.*, a.name AS agent_name FROM agent_versions v JOIN agents a ON a.id = v.agent_id WHERE v.id = ?")
      .get(versionId) as Raw | undefined;
    return r ? ({ ...versionFrom(r), agent_name: String(r.agent_name) } as VersionRow & { agent_name: string }) : null;
  }
  deleteVersion(versionId: string) {
    this.db.prepare("DELETE FROM agent_versions WHERE id = ?").run(versionId);
  }

  // ── Suites ────────────────────────────────────────────────────────────────────────────────────
  listSuites(): SuiteRow[] {
    return (this.db.prepare("SELECT * FROM suites ORDER BY created_at ASC").all() as Raw[]).map(suiteFrom);
  }
  getSuite(suiteId: string): SuiteRow | null {
    const r = this.db.prepare("SELECT * FROM suites WHERE id = ?").get(suiteId) as Raw | undefined;
    return r ? suiteFrom(r) : null;
  }
  createSuite(spec: SuiteSpec, at = Date.now()): SuiteRow {
    const row = { id: id("st"), name: spec.name, description: spec.description ?? "", spec, created_at: at, updated_at: at };
    this.db.prepare("INSERT INTO suites VALUES (?, ?, ?, ?, ?, ?)").run(row.id, row.name, row.description, JSON.stringify(spec), at, at);
    return row;
  }
  updateSuite(suiteId: string, spec: SuiteSpec) {
    this.db
      .prepare("UPDATE suites SET name = ?, description = ?, spec = ?, updated_at = ? WHERE id = ?")
      .run(spec.name, spec.description ?? "", JSON.stringify(spec), Date.now(), suiteId);
  }
  deleteSuite(suiteId: string) {
    this.db.prepare("DELETE FROM suites WHERE id = ?").run(suiteId);
  }

  // ── Runs & trials ─────────────────────────────────────────────────────────────────────────────
  createRun(input: {
    experimentId: string;
    suiteId: string | null;
    versionId: string | null;
    suite: SuiteSpec;
    agentLabel: string;
    agentConfig: AgentConfig | { kind: "external" };
    options: RunOptions;
    total: number;
    source?: "lab" | "ci";
    at?: number;
  }): RunRow {
    const runId = id("run");
    const at = input.at ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO runs (id, experiment_id, suite_id, agent_version_id, suite_name, agent_label, status, options, total, source, suite_snapshot, agent_snapshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        runId,
        input.experimentId,
        input.suiteId,
        input.versionId,
        input.suite.name,
        input.agentLabel,
        JSON.stringify(input.options),
        input.total,
        input.source ?? "lab",
        JSON.stringify(input.suite),
        JSON.stringify(input.agentConfig),
        at,
      );
    return this.getRun(runId)!;
  }
  getRun(runId: string): RunRow | null {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Raw | undefined;
    return r ? runFrom(r) : null;
  }
  getRunSnapshot(runId: string): { suite: SuiteSpec; agent: AgentConfig } | null {
    const r = this.db.prepare("SELECT suite_snapshot, agent_snapshot FROM runs WHERE id = ?").get(runId) as Raw | undefined;
    return r ? { suite: json(r.suite_snapshot), agent: json(r.agent_snapshot) } : null;
  }
  listRuns(filter: { suiteId?: string; versionId?: string; limit?: number } = {}): RunRow[] {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.suiteId) (where.push("suite_id = ?"), args.push(filter.suiteId));
    if (filter.versionId) (where.push("agent_version_id = ?"), args.push(filter.versionId));
    const sql = `SELECT * FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}`;
    return (this.db.prepare(sql).all(...args) as Raw[]).map(runFrom);
  }
  setRunStatus(runId: string, status: RunRow["status"], extra: { summary?: RunSummary; error?: string; finishedAt?: number } = {}) {
    this.db
      .prepare("UPDATE runs SET status = ?, summary = COALESCE(?, summary), error = COALESCE(?, error), finished_at = COALESCE(?, finished_at) WHERE id = ?")
      .run(status, extra.summary ? JSON.stringify(extra.summary) : null, extra.error ?? null, extra.finishedAt ?? null, runId);
  }
  deleteRun(runId: string) {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  }
  addTrial(runId: string, t: TrialResult, at = Date.now()): string {
    const trialId = id("tr");
    this.db
      .prepare("INSERT INTO trials VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(trialId, runId, t.scenarioId, t.trialIndex, t.passed ? 1 : 0, t.score, JSON.stringify(t.metrics), JSON.stringify(t), at);
    this.db.prepare("UPDATE runs SET done = done + 1 WHERE id = ?").run(runId);
    return trialId;
  }
  listTrialCells(runId: string) {
    return (this.db.prepare("SELECT id, scenario_id, trial_index, passed, score, metrics FROM trials WHERE run_id = ? ORDER BY scenario_id, trial_index").all(runId) as Raw[]).map(
      (r) => ({ id: String(r.id), scenarioId: String(r.scenario_id), trialIndex: Number(r.trial_index), passed: Boolean(r.passed), score: Number(r.score), metrics: json(r.metrics) }),
    );
  }
  getTrial(trialId: string): (TrialResult & { id: string; runId: string }) | null {
    const r = this.db.prepare("SELECT id, run_id, data FROM trials WHERE id = ?").get(trialId) as Raw | undefined;
    return r ? { ...json<TrialResult>(r.data), id: String(r.id), runId: String(r.run_id) } : null;
  }
  listTrials(runId: string): TrialResult[] {
    return (this.db.prepare("SELECT data FROM trials WHERE run_id = ? ORDER BY scenario_id, trial_index").all(runId) as Raw[]).map((r) => json<TrialResult>(r.data));
  }

  // ── Usage & plan ──────────────────────────────────────────────────────────────────────────────
  recordUsage(runId: string | null, trials: number, costUsd: number, at = Date.now()) {
    this.db.prepare("INSERT INTO usage_events (run_id, trials, cost_usd, created_at) VALUES (?, ?, ?, ?)").run(runId, trials, costUsd, at);
  }
  plan(): (typeof PLANS)[number] {
    const pid = (getSetting(this.db, "plan") ?? "lab") as PlanId;
    return PLANS.find((p) => p.id === pid) ?? PLANS[1];
  }
  setPlan(pid: PlanId) {
    setSetting(this.db, "plan", pid);
  }
  usage(now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const totals = this.db
      .prepare("SELECT COALESCE(SUM(trials),0) AS trials, COALESCE(SUM(cost_usd),0) AS cost FROM usage_events WHERE created_at >= ? AND created_at < ?")
      .get(start, end) as { trials: number; cost: number };
    const daily = this.db
      .prepare(
        "SELECT CAST((created_at - ?) / 86400000 AS INTEGER) AS day, SUM(trials) AS trials, SUM(cost_usd) AS cost FROM usage_events WHERE created_at >= ? AND created_at < ? GROUP BY day ORDER BY day",
      )
      .all(start, start, end) as Array<{ day: number; trials: number; cost: number }>;
    const plan = this.plan();
    const over = Math.max(0, totals.trials - plan.includedTrials);
    return {
      plan,
      periodStart: start,
      periodEnd: end,
      trials: totals.trials,
      modelCostUsd: totals.cost,
      overageTrials: over,
      overageUsd: plan.overagePerTrial ? over * plan.overagePerTrial : 0,
      projectedInvoiceUsd: plan.price + (plan.overagePerTrial ? over * plan.overagePerTrial : 0),
      daily,
    };
  }

  // ── API keys ──────────────────────────────────────────────────────────────────────────────────
  createApiKey(name: string): { id: string; key: string } {
    const key = `alk_${randomBytes(24).toString("base64url")}`;
    const keyId = id("key");
    this.db.prepare("INSERT INTO api_keys VALUES (?, ?, ?, ?, ?, NULL)").run(keyId, name, key.slice(0, 10), sha256(key), Date.now());
    return { id: keyId, key };
  }
  listApiKeys() {
    return this.db.prepare("SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC").all();
  }
  deleteApiKey(keyId: string) {
    this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(keyId);
  }
  verifyApiKey(key: string): boolean {
    const row = this.db.prepare("SELECT id FROM api_keys WHERE hash = ?").get(sha256(key)) as { id: string } | undefined;
    if (row) this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(Date.now(), row.id);
    return Boolean(row);
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
