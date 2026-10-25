import { PERSONA_SUITE, SUPPORT_SUITE, SUPPORT_SYSTEM_PROMPT, runExperiment, type AgentConfig, type RunOptions } from "@agentlab/core";
import { getSetting, id, setSetting } from "./db.ts";
import type { Store } from "./store.ts";

const DAY = 86_400_000;

/**
 * First boot: a populated lab. Three versions of a simulated support agent, a Claude-powered
 * variant, two suites, and a history of experiments that tells a story (v1 → v2 improves,
 * v3 regresses) — so every screen has real data from the first second.
 */
export async function seed(store: Store): Promise<void> {
  if (getSetting(store.db, "seeded")) return;
  const now = Date.now();

  const support = store.createAgent("Acme Support", "Customer-support agent for Acme Outfitters: orders, refunds, shipping.", now - 12 * DAY);
  const v1 = store.createVersion(support.id, "v1", { kind: "mock", variant: "support-v1" }, "Baseline prompt shipped to beta.", now - 12 * DAY);
  const v2 = store.createVersion(support.id, "v2", { kind: "mock", variant: "support-v2" }, "Verification-first policy, injection guard, outage escalation.", now - 7 * DAY);
  const v3 = store.createVersion(support.id, "v3", { kind: "mock", variant: "support-v3" }, "Caches order data to cut latency in half.", now - 2 * DAY);

  const claude = store.createAgent("Acme Support · Claude", "The same support policy running live on Claude via the Messages API.", now - 6 * DAY);
  const claudeConfig: AgentConfig = { kind: "anthropic", model: "claude-opus-5-5", systemPrompt: SUPPORT_SYSTEM_PROMPT, effort: "medium", allowFallback: true };
  store.createVersion(claude.id, "opus-5.5", claudeConfig, "Requires ANTHROPIC_API_KEY.", now - 6 * DAY);
  store.createVersion(claude.id, "sonnet-5.5", { ...claudeConfig, model: "claude-sonnet-5-5" }, "Requires ANTHROPIC_API_KEY.", now - 6 * DAY);

  const supportSuite = store.createSuite(SUPPORT_SUITE, now - 12 * DAY);
  const personaSuite = store.createSuite(PERSONA_SUITE, now - 6 * DAY);

  const history: Array<{ suite: typeof supportSuite; version: typeof v1; options: RunOptions; at: number }> = [
    { suite: supportSuite, version: v1, options: { trials: 12, seed: 11 }, at: now - 11 * DAY },
    { suite: supportSuite, version: v1, options: { trials: 12, seed: 12, chaos: { global: { errorRate: 0.15 } } }, at: now - 9 * DAY },
    { suite: supportSuite, version: v2, options: { trials: 12, seed: 21 }, at: now - 6 * DAY },
    { suite: supportSuite, version: v2, options: { trials: 12, seed: 22, chaos: { global: { errorRate: 0.15 } } }, at: now - 5 * DAY },
    { suite: personaSuite, version: v2, options: { trials: 6, seed: 23 }, at: now - 4 * DAY },
    { suite: supportSuite, version: v2, options: { trials: 12, seed: 42 }, at: now - 1 * DAY },
    { suite: supportSuite, version: v3, options: { trials: 12, seed: 42 }, at: now - 1 * DAY + 60_000 },
  ];

  for (const h of history) {
    const experimentId = id("exp");
    const total = h.suite.spec.scenarios.length * h.options.trials;
    const run = store.createRun({
      experimentId,
      suiteId: h.suite.id,
      versionId: h.version.id,
      suite: h.suite.spec,
      agentLabel: `Acme Support ${h.version.version}`,
      agentConfig: h.version.config,
      options: h.options,
      total,
      at: h.at,
    });
    const { summary, trials } = await runExperiment(h.suite.spec, h.version.config, h.options);
    for (const t of trials) store.addTrial(run.id, t, h.at);
    store.setRunStatus(run.id, "completed", { summary, finishedAt: h.at + 40_000 });
    store.recordUsage(run.id, trials.length, summary.costUsd, h.at);
  }
  setSetting(store.db, "seeded", new Date().toISOString());
}
