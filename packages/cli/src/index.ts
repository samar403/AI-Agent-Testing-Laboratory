import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import YAML from "yaml";
import {
  MOCK_VARIANTS,
  SUPPORT_SUITE,
  SUPPORT_SYSTEM_PROMPT,
  compareRuns,
  hasAnthropicCredentials,
  runExperiment,
  toJUnit,
  toMarkdown,
  validateSuite,
  type AgentConfig,
  type MockVariant,
  type RunSummary,
  type SuiteSpec,
  type TrialResult,
} from "@agentlab/core";

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[38;5;86m${s}\x1b[0m`,
  red: (s: string) => `\x1b[38;5;204m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;5;215m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[38;5;117m${s}\x1b[0m`,
};
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function loadSuite(file: string): SuiteSpec {
  const path = resolve(file);
  if (!existsSync(path)) fail(`suite file not found: ${file}`);
  const text = readFileSync(path, "utf8");
  const raw = /\.ya?ml$/i.test(path) ? YAML.parse(text) : JSON.parse(text);
  const v = validateSuite(raw);
  if (!v.ok) fail(`suite ${file} is invalid:\n  - ${v.errors.join("\n  - ")}`);
  return v.suite;
}

/**
 * --agent accepts:
 *   sim:support-v2                 a bundled simulated specimen
 *   claude:claude-opus-5-5         Claude via the Messages API (use --system-prompt <file>)
 *   http://localhost:3000/agent    any agent speaking the AgentLab HTTP protocol
 *   ./agent.json                   a full AgentConfig object
 */
function parseAgent(spec: string, systemPromptFile?: string): { config: AgentConfig; label: string } {
  if (spec.startsWith("sim:") || spec.startsWith("mock:")) {
    const variant = spec.split(":")[1] as MockVariant;
    if (!(variant in MOCK_VARIANTS)) fail(`unknown simulated agent "${variant}". Try: ${Object.keys(MOCK_VARIANTS).join(", ")}`);
    return { config: { kind: "mock", variant }, label: MOCK_VARIANTS[variant].name };
  }
  if (spec.startsWith("claude:")) {
    if (!hasAnthropicCredentials()) fail("claude: agents need ANTHROPIC_API_KEY in the environment");
    const model = spec.slice("claude:".length) || "claude-opus-5-5";
    const systemPrompt = systemPromptFile ? readFileSync(resolve(systemPromptFile), "utf8") : SUPPORT_SYSTEM_PROMPT;
    return { config: { kind: "anthropic", model, systemPrompt, effort: "medium" }, label: `Claude ${model}` };
  }
  if (/^https?:\/\//.test(spec)) {
    const headers = process.env.AGENTLAB_AGENT_AUTH ? { authorization: process.env.AGENTLAB_AGENT_AUTH } : undefined;
    return { config: { kind: "http", url: spec, headers }, label: new URL(spec).host };
  }
  if (existsSync(resolve(spec))) {
    const config = JSON.parse(readFileSync(resolve(spec), "utf8")) as AgentConfig;
    return { config, label: spec };
  }
  fail(`cannot interpret --agent "${spec}"`);
}

function fail(msg: string): never {
  console.error(c.red(`✖ ${msg}`));
  process.exit(2);
}

/** Render the run as a microplate: one row per scenario, one well per trial. */
function printPlate(summary: RunSummary, trials: TrialResult[]) {
  const rows = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  console.log();
  summary.scenarios.forEach((s, i) => {
    const wells = trials
      .filter((t) => t.scenarioId === s.scenarioId)
      .sort((a, b) => a.trialIndex - b.trialIndex)
      .map((t) => (t.passed ? c.green("●") : t.score > 0.5 ? c.amber("◐") : c.red("●")))
      .join(" ");
    const raw = pct(s.passRate).padStart(6);
    const rate = s.passes === s.trials ? c.green(raw) : s.passes === 0 ? c.red(raw) : c.amber(raw);
    console.log(`  ${c.dim(rows[i % 26]!)}  ${wells}  ${rate}  ${s.title}${s.flaky ? c.amber("  ~flaky") : ""}`);
  });
}

function printSummary(label: string, summary: RunSummary) {
  const ri = summary.reliabilityIndex;
  const riStr = ri >= 85 ? c.green(String(ri)) : ri >= 65 ? c.amber(String(ri)) : c.red(String(ri));
  console.log();
  console.log(`  ${c.bold("Reliability Index")} ${riStr}${c.dim("/100")}   ${c.dim(label)}`);
  console.log(
    `  pass ${pct(summary.passRate)} ${c.dim(`(95% CI ${pct(summary.ci[0])}–${pct(summary.ci[1])})`)} · pass^${summary.k} ${pct(summary.passHatK)} · tool accuracy ${pct(summary.toolCallAccuracy)} · p95 ${Math.round(summary.latency.p95)}ms · $${summary.costUsd.toFixed(4)}`,
  );
  const notes = summary.findings.filter((f) => f.severity !== "info").slice(0, 8);
  if (notes.length) {
    console.log(`\n  ${c.bold("Lab notebook")}`);
    for (const f of notes) console.log(`  ${f.severity === "critical" ? c.red("■") : c.amber("■")} ${f.title}\n    ${c.dim(f.detail)}`);
  }
}

const program = new Command();
program.name("agentlab").description("AgentLab — break your agent before your users do.").version("0.1.0");

program
  .command("run")
  .description("Run a suite against an agent and enforce reliability gates")
  .argument("<suite>", "suite file (.yaml or .json)")
  .requiredOption("-a, --agent <agent>", "sim:support-v2 | claude:<model> | http(s)://endpoint | agent.json")
  .option("-t, --trials <n>", "trials per scenario", "5")
  .option("-s, --seed <n>", "random seed", "42")
  .option("-c, --concurrency <n>", "parallel trials", "4")
  .option("--scenario <ids...>", "only run these scenario ids")
  .option("--chaos <rate>", "inject transient tool errors at this rate (0–1)")
  .option("--system-prompt <file>", "system prompt file for claude: agents")
  .option("--min-ri <n>", "fail if Reliability Index is below n")
  .option("--min-pass <rate>", "fail if pass rate is below rate (0–1)")
  .option("--min-pass-k <rate>", "fail if pass^k is below rate (0–1)")
  .option("--max-critical <n>", "fail if more than n critical findings")
  .option("--junit <file>", "write JUnit XML")
  .option("--json <file>", "write full JSON results")
  .option("--markdown <file>", "write a Markdown summary")
  .option("--upload <url>", "AgentLab server URL to upload results to (uses AGENTLAB_API_KEY)")
  .option("--label <label>", "agent label shown in reports")
  .option("--commit <sha>", "commit SHA to attach (defaults to GITHUB_SHA)")
  .action(async (suiteFile: string, o) => {
    const suite = loadSuite(suiteFile);
    const { config, label: defaultLabel } = parseAgent(o.agent, o.systemPrompt);
    const label = o.label ?? defaultLabel;
    const trials = Number(o.trials);
    const total = (o.scenario?.length ?? suite.scenarios.length) * trials;
    console.log(`\n  ${c.cyan("🧪 AgentLab")} ${c.bold(suite.name)} ${c.dim(`× ${label} · ${total} trials`)}`);
    const started = Date.now();
    const { trials: results, summary } = await runExperiment(
      suite,
      config,
      {
        trials,
        seed: Number(o.seed),
        concurrency: Number(o.concurrency),
        scenarioIds: o.scenario,
        chaos: o.chaos ? { global: { errorRate: Number(o.chaos) } } : undefined,
      },
      {
        onTrial: (_t, done, n) => {
          if (process.stdout.isTTY) process.stdout.write(`\r  ${c.dim(`running ${done}/${n}`)}  `);
        },
      },
    );
    if (process.stdout.isTTY) process.stdout.write("\r" + " ".repeat(30) + "\r");
    printPlate(summary, results);
    printSummary(`${((Date.now() - started) / 1000).toFixed(1)}s`, summary);

    if (o.junit) writeFileSync(o.junit, toJUnit(suite.name, label, results, summary));
    if (o.json) writeFileSync(o.json, JSON.stringify({ suite: suite.name, agent: label, summary, trials: results }, null, 2));
    const md = toMarkdown(suite.name, label, summary);
    if (o.markdown) writeFileSync(o.markdown, md);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

    if (o.upload) {
      const key = process.env.AGENTLAB_API_KEY;
      if (!key) console.error(c.amber("  ! --upload needs AGENTLAB_API_KEY; skipping upload"));
      else {
        const res = await fetch(new URL("/api/ingest", o.upload), {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ suite, agentLabel: label, options: { trials, seed: Number(o.seed) }, trials: results, commit: o.commit ?? process.env.GITHUB_SHA }),
        });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
        if (res.ok) console.log(`\n  ${c.cyan("↑")} uploaded → ${new URL(`/lab/runs/${body.runId}`, o.upload)}`);
        else console.error(c.amber(`  ! upload failed: ${res.status} ${body.error ?? ""}`));
      }
    }

    const gates: string[] = [];
    if (o.minRi !== undefined && summary.reliabilityIndex < Number(o.minRi)) gates.push(`Reliability Index ${summary.reliabilityIndex} < ${o.minRi}`);
    if (o.minPass !== undefined && summary.passRate < Number(o.minPass)) gates.push(`pass rate ${pct(summary.passRate)} < ${pct(Number(o.minPass))}`);
    if (o.minPassK !== undefined && summary.passHatK < Number(o.minPassK)) gates.push(`pass^${summary.k} ${pct(summary.passHatK)} < ${pct(Number(o.minPassK))}`);
    const critical = summary.findings.filter((f) => f.severity === "critical").length;
    if (o.maxCritical !== undefined && critical > Number(o.maxCritical)) gates.push(`${critical} critical findings > ${o.maxCritical}`);
    console.log();
    if (gates.length) {
      for (const g of gates) console.log(`  ${c.red("✖ gate failed:")} ${g}`);
      process.exit(1);
    }
    console.log(`  ${c.green("✔ all gates passed")}\n`);
  });

program
  .command("validate")
  .description("Validate a suite file")
  .argument("<suite>")
  .action((file: string) => {
    const s = loadSuite(file);
    console.log(c.green(`✔ ${s.name}: ${s.scenarios.length} scenarios, ${s.tools.length} tools, ${s.scenarios.reduce((n, x) => n + x.criteria.length, 0)} criteria`));
  });

program
  .command("init")
  .description("Scaffold an example suite in the current directory")
  .option("-f, --force", "overwrite existing files")
  .action((o) => {
    const file = "agentlab.suite.yaml";
    if (existsSync(file) && !o.force) fail(`${file} already exists (use --force)`);
    writeFileSync(file, `# AgentLab suite — docs: https://github.com/samar403/AI-Agent-Testing-Laboratory/blob/main/docs/suite-reference.md\n${YAML.stringify(SUPPORT_SUITE)}`);
    console.log(c.green(`✔ wrote ${file}`));
    console.log(c.dim(`  next: agentlab run ${file} --agent sim:support-v2 --trials 5 --min-ri 80`));
  });

program
  .command("demo")
  .description("Run the bundled support suite against v1 and v2 and compare them")
  .option("-t, --trials <n>", "trials per scenario", "8")
  .action(async (o) => {
    const opts = { trials: Number(o.trials), seed: 42, concurrency: 8 };
    const a = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v1" }, opts);
    const b = await runExperiment(SUPPORT_SUITE, { kind: "mock", variant: "support-v2" }, opts);
    console.log(`\n  ${c.cyan("🧪 AgentLab demo")} ${c.bold(SUPPORT_SUITE.name)}`);
    console.log(`\n  ${c.bold("Acme Support v1")}`);
    printPlate(a.summary, a.trials);
    printSummary("baseline", a.summary);
    console.log(`\n  ${c.bold("Acme Support v2")}`);
    printPlate(b.summary, b.trials);
    printSummary("candidate", b.summary);
    const cmp = compareRuns(a.summary, b.summary);
    console.log(`\n  ${c.bold("v1 → v2")}  pass ${pct(cmp.overall.a)} → ${pct(cmp.overall.b)}  ${c.dim(`p=${cmp.overall.pValue.toExponential(1)}`)}  ${cmp.overall.verdict === "improvement" ? c.green("▲ improvement") : cmp.overall.verdict}`);
    for (const s of cmp.scenarios.filter((x) => x.verdict !== "unchanged")) {
      const tag = s.verdict === "improvement" ? c.green("▲") : s.verdict === "regression" ? c.red("▼") : c.dim("·");
      console.log(`   ${tag} ${s.title.padEnd(22)} ${pct(s.a.passRate)} → ${pct(s.b.passRate)} ${c.dim(`p=${s.pValue.toFixed(3)}`)}`);
    }
    console.log();
  });

await program.parseAsync();
