import { EventEmitter } from "node:events";
import { hasAnthropicCredentials, runExperiment, type AgentConfig, type RunOptions, type SuiteSpec, type TrialResult } from "@agentlab/core";
import { id } from "./db.ts";
import type { RunRow, Store } from "./store.ts";

export interface TrialEvent {
  type: "trial";
  trialId: string;
  scenarioId: string;
  trialIndex: number;
  passed: boolean;
  score: number;
  metrics: TrialResult["metrics"];
  done: number;
  total: number;
}
export interface StatusEvent {
  type: "status";
  status: RunRow["status"];
  error?: string;
}
export type RunEvent = TrialEvent | StatusEvent;

export class RunManager {
  private readonly events = new EventEmitter();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly store: Store, private readonly pacingMs = 45) {
    this.events.setMaxListeners(200);
  }

  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    this.events.on(runId, fn);
    return () => this.events.off(runId, fn);
  }

  isActive(runId: string) {
    return this.controllers.has(runId);
  }

  /** Create one run per agent version (an "experiment") and execute them in the background. */
  start(input: { suiteId: string; versionIds: string[]; options: RunOptions }): RunRow[] {
    const suiteRow = this.store.getSuite(input.suiteId);
    if (!suiteRow) throw new HttpError(404, "suite not found");
    const versions = input.versionIds.map((v) => {
      const row = this.store.getVersion(v);
      if (!row) throw new HttpError(404, `agent version ${v} not found`);
      if (row.config.kind === "anthropic" && !hasAnthropicCredentials()) {
        throw new HttpError(400, `${row.agent_name} ${row.version} is powered by Claude — set ANTHROPIC_API_KEY on the server to run it.`);
      }
      return row;
    });
    const scenarios = suiteRow.spec.scenarios.filter((s) => !input.options.scenarioIds?.length || input.options.scenarioIds.includes(s.id));
    const perRun = scenarios.length * input.options.trials;
    const usage = this.store.usage();
    if (usage.plan.overagePerTrial === null && usage.trials + perRun * versions.length > usage.plan.includedTrials) {
      throw new HttpError(402, `The ${usage.plan.name} plan includes ${usage.plan.includedTrials.toLocaleString()} trials per month. Upgrade to keep experimenting.`);
    }

    const experimentId = id("exp");
    const runs = versions.map((v) =>
      this.store.createRun({
        experimentId,
        suiteId: suiteRow.id,
        versionId: v.id,
        suite: suiteRow.spec,
        agentLabel: `${v.agent_name} ${v.version}`,
        agentConfig: v.config,
        options: input.options,
        total: perRun,
      }),
    );
    for (const run of runs) void this.execute(run.id, suiteRow.spec, versions.find((v) => v.id === run.agent_version_id)!.config, input.options);
    return runs;
  }

  cancel(runId: string): boolean {
    const ctl = this.controllers.get(runId);
    if (!ctl) return false;
    ctl.abort();
    return true;
  }

  async execute(runId: string, suite: SuiteSpec, config: AgentConfig, options: RunOptions, pace = true): Promise<void> {
    const ctl = new AbortController();
    this.controllers.set(runId, ctl);
    this.store.setRunStatus(runId, "running");
    this.events.emit(runId, { type: "status", status: "running" } satisfies RunEvent);
    try {
      const { summary, trials } = await runExperiment(
        suite,
        config,
        { concurrency: config.kind === "mock" ? 6 : 4, ...options },
        {
          signal: ctl.signal,
          pacingMs: pace ? this.pacingMs : 0,
          onTrial: (t, done, total) => {
            const trialId = this.store.addTrial(runId, t);
            this.events.emit(runId, { type: "trial", trialId, scenarioId: t.scenarioId, trialIndex: t.trialIndex, passed: t.passed, score: t.score, metrics: t.metrics, done, total } satisfies RunEvent);
          },
        },
      );
      const status = ctl.signal.aborted ? "cancelled" : "completed";
      this.store.setRunStatus(runId, status, { summary, finishedAt: Date.now() });
      this.store.recordUsage(runId, trials.length, summary.costUsd);
      this.events.emit(runId, { type: "status", status } satisfies RunEvent);
    } catch (err) {
      const error = (err as Error).message;
      this.store.setRunStatus(runId, "failed", { error, finishedAt: Date.now() });
      this.events.emit(runId, { type: "status", status: "failed", error } satisfies RunEvent);
    } finally {
      this.controllers.delete(runId);
    }
  }
}

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 402 | 404 | 409, message: string) {
    super(message);
  }
}
