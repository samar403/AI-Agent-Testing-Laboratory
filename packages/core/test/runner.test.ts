import { describe, expect, it } from "vitest";
import { compareRuns, runExperiment, SUPPORT_SUITE, validateSuite, PERSONA_SUITE } from "../src/index.ts";

describe("experiment runner (simulated specimens)", () => {
  it("is deterministic for a given seed", async () => {
    const a = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v1" }, { trials: 3, seed: 7 });
    const b = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v1" }, { trials: 3, seed: 7 });
    expect(a.trials.map((t) => t.passed)).toEqual(b.trials.map((t) => t.passed));
    expect(a.summary.trials).toBe(24);
  });

  it("ranks the hardened agent above the baseline and detects the v3 regression", async () => {
    const opts = { trials: 8, seed: 42 };
    const v1 = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v1" }, opts);
    const v2 = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v2" }, opts);
    const v3 = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v3" }, opts);
    expect(v2.summary.reliabilityIndex).toBeGreaterThan(v1.summary.reliabilityIndex);
    expect(v1.summary.findings.some((f) => f.kind === "safety")).toBe(true);
    const cmp = compareRuns(v2.summary, v3.summary);
    expect(cmp.overall.delta).toBeLessThan(0);
    expect(cmp.scenarios.find((s) => s.scenarioId === "multi-turn-refund")!.verdict).toBe("regression");
  });

  it("records traces, faults and transcripts", async () => {
    const { trials } = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v2" }, { trials: 1, scenarioIds: ["refund-outage"] });
    const t = trials[0]!;
    expect(t.metrics.faultsInjected).toBeGreaterThan(0);
    expect(t.trace.some((e) => e.type === "fault")).toBe(true);
    expect(t.transcript.some((m) => m.toolName === "escalate_to_human")).toBe(true);
    expect(t.passed).toBe(true);
  });

  it("applies global chaos", async () => {
    const { summary } = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v2" }, { trials: 2, chaos: { global: { errorRate: 0.5 } } });
    expect(summary.faultsInjected).toBeGreaterThan(0);
    expect(summary.passRateUnderFaults).not.toBeNull();
  });

  it("validates the bundled suites and rejects broken ones", () => {
    expect(validateSuite(SUPPORT_SUITE).ok).toBe(true);
    expect(validateSuite(PERSONA_SUITE).ok).toBe(true);
    const bad = validateSuite({ ...SUPPORT_SUITE, scenarios: [{ ...SUPPORT_SUITE.scenarios[0], criteria: [{ type: "tool_called", tool: "nope" }] }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('unknown tool "nope"');
  });
});
