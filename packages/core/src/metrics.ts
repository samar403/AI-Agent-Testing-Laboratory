import { describeCriterion } from "./criteria.ts";
import type { Finding, RunComparison, RunSummary, ScenarioDiff, ScenarioSummary, TrialResult } from "./types.ts";
import { mean, percentile } from "./util.ts";

/** Wilson score interval (95%) — honest error bars for small trial counts. */
export function wilson(passes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = passes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Unbiased pass@k: probability at least one of k sampled trials passes. */
export function passAtK(n: number, c: number, k: number): number {
  if (n === 0) return 0;
  k = Math.min(k, n);
  if (n - c < k) return 1;
  return 1 - choose(n - c, k) / choose(n, k);
}

/** pass^k: probability all k sampled trials pass — the metric that matters for production reliability. */
export function passHatK(n: number, c: number, k: number): number {
  if (n === 0) return 0;
  k = Math.min(k, n);
  return choose(c, k) / choose(n, k);
}

function logFactorial(n: number): number {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

/** Two-sided Fisher exact test on a 2x2 table [[a,b],[c,d]]. */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const row1 = a + b;
  const col1 = a + c;
  const lf = (x: number) => logFactorial(x);
  const base = lf(row1) + lf(n - row1) + lf(col1) + lf(n - col1) - lf(n);
  const prob = (x: number) => Math.exp(base - lf(x) - lf(row1 - x) - lf(col1 - x) - lf(n - row1 - col1 + x));
  const pObs = prob(a);
  let p = 0;
  const lo = Math.max(0, row1 + col1 - n);
  const hi = Math.min(row1, col1);
  for (let x = lo; x <= hi; x++) {
    const px = prob(x);
    if (px <= pObs * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

export function summarizeScenario(scenarioId: string, title: string, trials: TrialResult[], k: number): ScenarioSummary {
  const n = trials.length;
  const c = trials.filter((t) => t.passed).length;
  const failingCriteria: Record<string, number> = {};
  for (const t of trials) {
    for (const r of t.criteria) {
      if (!r.passed && !r.skipped) {
        const key = describeCriterion(r.criterion);
        failingCriteria[key] = (failingCriteria[key] ?? 0) + 1;
      }
    }
  }
  return {
    scenarioId,
    title,
    trials: n,
    passes: c,
    passRate: n ? c / n : 0,
    ci: wilson(c, n),
    passAtK: passAtK(n, c, k),
    passHatK: passHatK(n, c, k),
    flaky: c > 0 && c < n,
    meanScore: mean(trials.map((t) => t.score)),
    meanLatencyMs: mean(trials.map((t) => t.metrics.agentLatencyMs)),
    failingCriteria,
  };
}

/**
 * Reliability Index (0–100): 60% pass rate, 25% tool-call accuracy, 15% consistency
 * (share of scenarios that behave the same way on every trial).
 */
export function reliabilityIndex(passRate: number, toolCallAccuracy: number, consistency: number): number {
  return Math.round(100 * (0.6 * passRate + 0.25 * toolCallAccuracy + 0.15 * consistency));
}

export function summarizeRun(trials: TrialResult[], scenarioTitles: Record<string, string>): RunSummary {
  const byScenario = new Map<string, TrialResult[]>();
  for (const t of trials) {
    if (!byScenario.has(t.scenarioId)) byScenario.set(t.scenarioId, []);
    byScenario.get(t.scenarioId)!.push(t);
  }
  const k = Math.max(1, Math.min(...[...byScenario.values()].map((v) => v.length)));
  const scenarios = [...byScenario.entries()].map(([id, ts]) => summarizeScenario(id, scenarioTitles[id] ?? id, ts, k));

  const n = trials.length;
  const c = trials.filter((t) => t.passed).length;
  const totalCalls = trials.reduce((s, t) => s + t.metrics.toolCalls, 0);
  const badCalls = trials.reduce((s, t) => s + t.metrics.invalidToolCalls + t.metrics.unknownToolCalls, 0);
  const toolCallAccuracy = totalCalls ? 1 - badCalls / totalCalls : 1;
  const flakyScenarios = scenarios.filter((s) => s.flaky).length;
  const consistency = scenarios.length ? 1 - flakyScenarios / scenarios.length : 1;

  // Average per-scenario pass^k so that every scenario counts equally.
  const decay = Array.from({ length: k }, (_, i) => mean(scenarios.map((s) => passHatK(s.trials, s.passes, i + 1))));
  const withFaults = trials.filter((t) => t.metrics.faultsInjected > 0);
  const withoutFaults = trials.filter((t) => t.metrics.faultsInjected === 0);
  const latencies = trials.map((t) => t.metrics.agentLatencyMs);

  const summary: RunSummary = {
    trials: n,
    passes: c,
    passRate: n ? c / n : 0,
    ci: wilson(c, n),
    k,
    passAtK: mean(scenarios.map((s) => s.passAtK)),
    passHatK: mean(scenarios.map((s) => s.passHatK)),
    decay,
    toolCallAccuracy,
    flakyScenarios,
    reliabilityIndex: reliabilityIndex(n ? c / n : 0, toolCallAccuracy, consistency),
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), mean: mean(latencies) },
    tokens: {
      input: trials.reduce((s, t) => s + t.metrics.inputTokens, 0),
      output: trials.reduce((s, t) => s + t.metrics.outputTokens, 0),
    },
    costUsd: trials.reduce((s, t) => s + t.metrics.costUsd, 0),
    faultsInjected: trials.reduce((s, t) => s + t.metrics.faultsInjected, 0),
    passRateUnderFaults: withFaults.length ? withFaults.filter((t) => t.passed).length / withFaults.length : null,
    passRateWithoutFaults: withoutFaults.length ? withoutFaults.filter((t) => t.passed).length / withoutFaults.length : null,
    scenarios,
    findings: [],
  };
  summary.findings = deriveFindings(trials, summary);
  return summary;
}

const SAFETY_TYPES = new Set(["no_pii_leak", "tool_not_called", "response_not_contains"]);

/** The "lab notebook": turn raw trial data into prioritised, human-readable observations. */
export function deriveFindings(trials: TrialResult[], summary: RunSummary): Finding[] {
  const findings: Finding[] = [];
  const titles = Object.fromEntries(summary.scenarios.map((s) => [s.scenarioId, s.title]));

  // Schema violations, grouped by tool + first error.
  const schema = new Map<string, number>();
  const unknown = new Map<string, number>();
  for (const t of trials) {
    for (const ic of t.invalidCalls) {
      if (ic.unknownTool) unknown.set(ic.tool, (unknown.get(ic.tool) ?? 0) + 1);
      else {
        const key = `${ic.tool}::${ic.errors[0]}`;
        schema.set(key, (schema.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of [...schema.entries()].sort((a, b) => b[1] - a[1])) {
    const [tool, err] = key.split("::");
    findings.push({ severity: "critical", kind: "schema", title: `Malformed ${tool} calls`, detail: `${err} — seen in ${count} call${count > 1 ? "s" : ""}.`, count });
  }
  for (const [tool, count] of unknown) {
    findings.push({ severity: "critical", kind: "hallucinated_tool", title: `Hallucinated tool “${tool}”`, detail: `The agent invoked a tool that does not exist ${count}×.`, count });
  }

  // Per-scenario criterion failures.
  for (const s of summary.scenarios) {
    const scenarioTrials = trials.filter((t) => t.scenarioId === s.scenarioId);
    const fails = new Map<string, { count: number; type: string; example: string }>();
    for (const t of scenarioTrials) {
      for (const r of t.criteria) {
        if (r.passed || r.skipped) continue;
        const key = describeCriterion(r.criterion);
        const cur = fails.get(key) ?? { count: 0, type: r.criterion.type, example: r.message };
        cur.count++;
        fails.set(key, cur);
      }
    }
    for (const [label, f] of fails) {
      if (f.type === "valid_tool_calls") continue; // covered by schema findings
      const kind: Finding["kind"] =
        f.type === "tool_order" ? "ordering" : SAFETY_TYPES.has(f.type) ? "safety" : f.type.startsWith("tool") ? "tool_misuse" : f.type === "honest_about_failures" ? "fault_sensitivity" : f.type.startsWith("max_") ? "latency" : "quality";
      const severity: Finding["severity"] = kind === "safety" || f.count / s.trials >= 0.5 ? "critical" : "warning";
      findings.push({
        severity,
        kind,
        scenarioId: s.scenarioId,
        count: f.count,
        title: `${titles[s.scenarioId]}: ${label}`,
        detail: `Failed in ${f.count}/${s.trials} trials. e.g. ${f.example}`,
      });
    }
    if (s.flaky) {
      findings.push({
        severity: "warning",
        kind: "flaky",
        scenarioId: s.scenarioId,
        title: `${s.title} is flaky`,
        detail: `Passed ${s.passes}/${s.trials}. pass^${summary.k} = ${(s.passHatK * 100).toFixed(0)}% — a user retrying this flow will eventually hit a failure.`,
      });
    }
  }

  if (summary.passRateUnderFaults !== null && summary.passRateWithoutFaults !== null) {
    const drop = summary.passRateWithoutFaults - summary.passRateUnderFaults;
    if (drop > 0.15) {
      findings.push({
        severity: "warning",
        kind: "fault_sensitivity",
        title: "Brittle under tool failures",
        detail: `Pass rate drops from ${(summary.passRateWithoutFaults * 100).toFixed(0)}% to ${(summary.passRateUnderFaults * 100).toFixed(0)}% when chaos faults are injected.`,
      });
    }
  }

  if (summary.latency.p95 > 2.5 * Math.max(1, summary.latency.p50) && summary.trials >= 5) {
    findings.push({ severity: "info", kind: "latency", title: "Long latency tail", detail: `p95 ${Math.round(summary.latency.p95)} ms is ${(summary.latency.p95 / Math.max(1, summary.latency.p50)).toFixed(1)}× the median.` });
  }

  if (!findings.length && summary.trials) {
    findings.push({ severity: "info", kind: "pass", title: "Clean run", detail: `All ${summary.trials} trials passed every criterion.` });
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || (b.count ?? 0) - (a.count ?? 0));
}

function verdict(delta: number, p: number, alpha = 0.1): ScenarioDiff["verdict"] {
  if (Math.abs(delta) < 1e-9) return "unchanged";
  if (p > alpha) return "inconclusive";
  return delta < 0 ? "regression" : "improvement";
}

/** Compare run B (candidate) against run A (baseline). */
export function compareRuns(a: RunSummary, b: RunSummary): RunComparison {
  const ids = [...new Set([...a.scenarios.map((s) => s.scenarioId), ...b.scenarios.map((s) => s.scenarioId)])];
  const scenarios: ScenarioDiff[] = ids.map((id) => {
    const sa = a.scenarios.find((s) => s.scenarioId === id);
    const sb = b.scenarios.find((s) => s.scenarioId === id);
    const A = { passRate: sa?.passRate ?? 0, trials: sa?.trials ?? 0, passes: sa?.passes ?? 0 };
    const B = { passRate: sb?.passRate ?? 0, trials: sb?.trials ?? 0, passes: sb?.passes ?? 0 };
    const p = A.trials && B.trials ? fisherExact(A.passes, A.trials - A.passes, B.passes, B.trials - B.passes) : 1;
    const delta = B.passRate - A.passRate;
    return { scenarioId: id, title: sb?.title ?? sa?.title ?? id, a: A, b: B, delta, pValue: p, verdict: verdict(delta, p) };
  });
  const pOverall = fisherExact(a.passes, a.trials - a.passes, b.passes, b.trials - b.passes);
  const dOverall = b.passRate - a.passRate;
  return {
    scenarios,
    overall: { a: a.passRate, b: b.passRate, delta: dOverall, pValue: pOverall, verdict: verdict(dOverall, pOverall, 0.05) },
    metrics: [
      { name: "Reliability index", a: a.reliabilityIndex, b: b.reliabilityIndex, better: "higher" },
      { name: "Pass rate", a: a.passRate, b: b.passRate, better: "higher", unit: "%" },
      { name: `pass^${Math.min(a.k, b.k)}`, a: a.passHatK, b: b.passHatK, better: "higher", unit: "%" },
      { name: "Tool-call accuracy", a: a.toolCallAccuracy, b: b.toolCallAccuracy, better: "higher", unit: "%" },
      { name: "Flaky scenarios", a: a.flakyScenarios, b: b.flakyScenarios, better: "lower" },
      { name: "p95 latency", a: a.latency.p95, b: b.latency.p95, better: "lower", unit: "ms" },
      { name: "Cost / trial", a: a.trials ? a.costUsd / a.trials : 0, b: b.trials ? b.costUsd / b.trials : 0, better: "lower", unit: "$" },
    ],
    regressions: scenarios.filter((s) => s.verdict === "regression").length,
    improvements: scenarios.filter((s) => s.verdict === "improvement").length,
  };
}
