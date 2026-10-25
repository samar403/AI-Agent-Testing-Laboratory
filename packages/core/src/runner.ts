import { AnthropicAgent } from "./agents/anthropic.ts";
import { HttpAgent } from "./agents/http.ts";
import { MockSupportAgent } from "./agents/mock.ts";
import { evaluateCriteria, scoreResults, type JudgeFn } from "./criteria.ts";
import { summarizeRun } from "./metrics.ts";
import { estimateCost } from "./pricing.ts";
import { ToolSandbox } from "./sandbox.ts";
import { createJudge, createUserSimulator, type UserSimulator } from "./simulator.ts";
import type {
  AgentAdapter,
  AgentConfig,
  ChatMessage,
  ChaosProfile,
  InvalidCallInfo,
  RunOptions,
  RunSummary,
  Scenario,
  SuiteSpec,
  ToolChaos,
  TraceEvent,
  TrialResult,
} from "./types.ts";
import { createRng, deriveSeed, mapLimit, sleep } from "./util.ts";

export function createAgent(config: AgentConfig, seed: number): AgentAdapter {
  switch (config.kind) {
    case "mock":
      return new MockSupportAgent(config.variant, seed);
    case "anthropic":
      return new AnthropicAgent(config);
    case "http":
      return new HttpAgent(config);
  }
}

export interface TrialOptions {
  seed: number;
  trialIndex: number;
  chaos?: ChaosProfile;
  maxToolIterations?: number;
  judge?: JudgeFn;
  user?: UserSimulator;
  signal?: AbortSignal;
  /** Real milliseconds to pause per simulated agent step, so live dashboards animate. */
  pacingMs?: number;
}

function mergeChaos(...layers: Array<ToolChaos | undefined>): ToolChaos | undefined {
  const defined = layers.filter(Boolean) as ToolChaos[];
  return defined.length ? Object.assign({}, ...defined) : undefined;
}

/** Run one simulated conversation between a (simulated) user and the agent under test. */
export async function runTrial(suite: SuiteSpec, scenario: Scenario, agent: AgentAdapter, opts: TrialOptions): Promise<TrialResult> {
  const rng = createRng(opts.seed);
  const toolByName = new Map(suite.tools.map((t) => [t.name, t]));
  const sandbox = new ToolSandbox(
    suite.tools,
    { ...(suite.initialState ?? {}), ...(scenario.initialState ?? {}) },
    rng,
    (tool) => mergeChaos(opts.chaos?.global, toolByName.get(tool)?.chaos, scenario.chaos?.["*"], scenario.chaos?.[tool]),
  );
  const user = opts.user ?? createUserSimulator(scenario);
  const toolDefs = suite.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const maxTurns = scenario.maxTurns ?? 6;
  const maxIter = opts.maxToolIterations ?? 8;

  const transcript: ChatMessage[] = [];
  const trace: TraceEvent[] = [];
  const invalidCalls: InvalidCallInfo[] = [];
  const servedModels = new Set<string>();
  let clock = 0; // virtual ms: simulated latencies for mock agents/tools, wall-clock otherwise
  let agentLatency = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolCalls = 0;
  let faults = 0;
  let turns = 0;
  let error: string | undefined;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (opts.signal?.aborted) throw new Error("aborted");
      const userMsg = await user.next(transcript, turn);
      if (userMsg === null) break;
      turns++;
      transcript.push({ role: "user", content: userMsg });
      trace.push({ t: clock, type: "user", label: userMsg });

      for (let iter = 0; iter < maxIter; iter++) {
        const started = performance.now();
        const step = await agent.step({ messages: transcript, tools: toolDefs, signal: opts.signal });
        const wall = performance.now() - started;
        const d = step.simulatedLatencyMs ?? wall;
        if (opts.pacingMs && step.simulatedLatencyMs !== undefined) await sleep(opts.pacingMs, opts.signal);
        agentLatency += d;
        inputTokens += step.usage.inputTokens;
        outputTokens += step.usage.outputTokens;
        if (step.model) servedModels.add(step.model);
        transcript.push({ role: "assistant", content: step.text, toolCalls: step.toolCalls.length ? step.toolCalls : undefined, raw: step.raw });
        trace.push({
          t: clock,
          d,
          type: "agent",
          label: step.toolCalls.length ? `→ ${step.toolCalls.map((c) => c.name).join(", ")}` : step.text || "(empty reply)",
          detail: { tokens: step.usage, model: step.model, stopReason: step.stopReason },
        });
        clock += d;
        if (!step.toolCalls.length) break;

        let batchLatency = 0;
        for (const call of step.toolCalls) {
          toolCalls++;
          const exec = sandbox.execute(call);
          trace.push({ t: clock, d: exec.latencyMs, type: "tool_call", label: call.name, detail: { args: call.args } });
          if (exec.invalid) {
            invalidCalls.push(exec.invalid);
            trace.push({ t: clock, type: "invalid_call", label: exec.invalid.unknownTool ? `unknown tool ${call.name}` : `${call.name}: ${exec.invalid.errors.join("; ")}`, detail: exec.invalid });
          }
          if (exec.fault) {
            faults++;
            trace.push({ t: clock, type: "fault", label: `${exec.fault} injected on ${call.name}` });
          }
          trace.push({ t: clock + exec.latencyMs, type: "tool_result", label: `${call.name} ${exec.ok ? "ok" : "error"}`, detail: { output: exec.output, ok: exec.ok } });
          transcript.push({ role: "tool", content: exec.output, toolCallId: call.id, toolName: call.name, isError: !exec.ok });
          batchLatency = Math.max(batchLatency, Math.min(exec.latencyMs, 30000));
        }
        clock += batchLatency;
        if (iter === maxIter - 1) trace.push({ t: clock, type: "note", label: `tool loop capped at ${maxIter} iterations` });
      }
    }
  } catch (err) {
    error = (err as Error).message;
    trace.push({ t: clock, type: "error", label: error });
  }

  const unknownToolCalls = invalidCalls.filter((c) => c.unknownTool).length;
  const metrics = {
    latencyMs: clock,
    agentLatencyMs: agentLatency,
    turns,
    toolCalls,
    invalidToolCalls: invalidCalls.length - unknownToolCalls,
    unknownToolCalls,
    faultsInjected: faults,
    inputTokens,
    outputTokens,
    costUsd: estimateCost(agent.pricingModel, inputTokens, outputTokens),
  };
  const criteria = await evaluateCriteria(scenario.criteria, {
    transcript,
    finalState: sandbox.state,
    metrics,
    invalidCalls,
    judge: opts.judge,
  });
  for (const c of criteria) {
    if (c.criterion.type === "llm_judge" && !c.skipped) trace.push({ t: clock, type: "judge", label: c.message });
  }
  const { passed, score } = scoreResults(criteria);
  return {
    scenarioId: scenario.id,
    trialIndex: opts.trialIndex,
    seed: opts.seed,
    passed: passed && !error,
    score: error ? 0 : score,
    criteria,
    trace,
    transcript: transcript.map(({ raw: _raw, ...m }) => m),
    metrics,
    invalidCalls,
    finalState: sandbox.state,
    servedModels: [...servedModels],
    error,
  };
}

export interface ExperimentHooks {
  onTrial?: (result: TrialResult, done: number, total: number) => void | Promise<void>;
  signal?: AbortSignal;
  pacingMs?: number;
}

/** Run every scenario × trial of a suite against one agent configuration. */
export async function runExperiment(
  suite: SuiteSpec,
  agentConfig: AgentConfig,
  options: RunOptions,
  hooks: ExperimentHooks = {},
): Promise<{ trials: TrialResult[]; summary: RunSummary }> {
  const seed = options.seed ?? 42;
  const scenarios = suite.scenarios.filter((s) => !options.scenarioIds?.length || options.scenarioIds.includes(s.id));
  const jobs = scenarios.flatMap((scenario) => Array.from({ length: options.trials }, (_, i) => ({ scenario, i })));
  const judge = createJudge();
  let done = 0;
  const results = await mapLimit(jobs, options.concurrency ?? 4, async ({ scenario, i }) => {
    if (hooks.signal?.aborted) return null;
    const trialSeed = deriveSeed(seed, scenario.id, i);
    const agent = createAgent(agentConfig, trialSeed);
    const result = await runTrial(suite, scenario, agent, {
      seed: trialSeed,
      trialIndex: i,
      chaos: options.chaos,
      maxToolIterations: options.maxToolIterations,
      judge,
      signal: hooks.signal,
      pacingMs: hooks.pacingMs,
    });
    if (hooks.signal?.aborted && result.error) return null;
    done++;
    await hooks.onTrial?.(result, done, jobs.length);
    return result;
  });
  const trials = results.filter((r): r is TrialResult => r !== null);
  const titles = Object.fromEntries(suite.scenarios.map((s) => [s.id, s.title]));
  return { trials, summary: summarizeRun(trials, titles) };
}
