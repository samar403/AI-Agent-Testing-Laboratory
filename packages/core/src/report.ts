import { describeCriterion } from "./criteria.ts";
import type { RunSummary, TrialResult } from "./types.ts";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JUnit XML so CI systems (GitHub Actions, GitLab, Jenkins…) render AgentLab results natively. */
export function toJUnit(suiteName: string, agentLabel: string, trials: TrialResult[], summary: RunSummary): string {
  const bySc = new Map<string, TrialResult[]>();
  for (const t of trials) bySc.set(t.scenarioId, [...(bySc.get(t.scenarioId) ?? []), t]);
  const cases: string[] = [];
  for (const [scenarioId, ts] of bySc) {
    for (const t of ts) {
      const name = `${scenarioId} #${t.trialIndex + 1}`;
      const time = (t.metrics.agentLatencyMs / 1000).toFixed(3);
      if (t.passed) {
        cases.push(`    <testcase classname="${esc(scenarioId)}" name="${esc(name)}" time="${time}"/>`);
      } else {
        const failed = t.criteria.filter((c) => !c.passed && !c.skipped);
        const msg = t.error ?? failed.map((c) => `${describeCriterion(c.criterion)}: ${c.message}`).join("; ");
        cases.push(
          `    <testcase classname="${esc(scenarioId)}" name="${esc(name)}" time="${time}">\n      <failure message="${esc(msg.slice(0, 500))}">${esc(msg)}</failure>\n    </testcase>`,
        );
      }
    }
  }
  const failures = trials.filter((t) => !t.passed).length;
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="AgentLab" tests="${trials.length}" failures="${failures}">
  <testsuite name="${esc(`${suiteName} — ${agentLabel}`)}" tests="${trials.length}" failures="${failures}">
    <properties>
      <property name="reliability_index" value="${summary.reliabilityIndex}"/>
      <property name="pass_rate" value="${summary.passRate.toFixed(4)}"/>
      <property name="pass_hat_k" value="${summary.passHatK.toFixed(4)}"/>
      <property name="tool_call_accuracy" value="${summary.toolCallAccuracy.toFixed(4)}"/>
    </properties>
${cases.join("\n")}
  </testsuite>
</testsuites>
`;
}

/** Markdown summary for PR comments / GitHub job summaries. */
export function toMarkdown(suiteName: string, agentLabel: string, summary: RunSummary): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const lines = [
    `## 🧪 AgentLab · ${suiteName}`,
    `**Agent:** ${agentLabel} · **Reliability Index:** ${summary.reliabilityIndex}/100`,
    "",
    `| Pass rate | pass^${summary.k} | Tool-call accuracy | Flaky scenarios | p95 latency | Cost |`,
    "|---|---|---|---|---|---|",
    `| ${pct(summary.passRate)} (95% CI ${pct(summary.ci[0])}–${pct(summary.ci[1])}) | ${pct(summary.passHatK)} | ${pct(summary.toolCallAccuracy)} | ${summary.flakyScenarios} | ${Math.round(summary.latency.p95)} ms | $${summary.costUsd.toFixed(4)} |`,
    "",
    "| Scenario | Passed | pass^k |",
    "|---|---|---|",
    ...summary.scenarios.map((s) => `| ${s.passes === s.trials ? "✅" : s.passes === 0 ? "❌" : "⚠️"} ${s.title} | ${s.passes}/${s.trials} | ${pct(s.passHatK)} |`),
  ];
  const top = summary.findings.filter((f) => f.severity !== "info").slice(0, 6);
  if (top.length) {
    lines.push("", "### Lab notebook", ...top.map((f) => `- **${f.severity === "critical" ? "🔴" : "🟠"} ${f.title}** — ${f.detail}`));
  }
  return lines.join("\n") + "\n";
}
