// Core domain types shared by the engine, the API server, the CLI and the web app.
// Everything in here is plain data (JSON-serialisable) so it can be stored and sent over the wire.

export type JSONSchema = {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null" | Array<string>;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean;
};

/** A value matcher used in mock `when` clauses and criterion `args`. Literals match by deep equality. */
export type Matcher =
  | unknown
  | { $regex: string }
  | { $exists: boolean }
  | { $gt: number }
  | { $lt: number }
  | { $oneOf: unknown[] }
  | { $any: true };

export interface ToolMock {
  /** Match on tool arguments. Omit for a catch-all. */
  when?: Record<string, Matcher>;
  /** Match on sandbox world state (dot paths). */
  whenState?: Record<string, Matcher>;
  /** Value returned to the agent. Strings may use {{args.x}} / {{state.y}} templates. */
  return?: unknown;
  /** Return an error to the agent instead of a value. */
  error?: string;
  /** Mutate world state when this mock fires (dot path → value; templates allowed). */
  set?: Record<string, unknown>;
}

export interface ToolChaos {
  /** Probability [0..1] the tool returns a transient 5xx-style error. */
  errorRate?: number;
  /** Probability [0..1] the tool times out. */
  timeoutRate?: number;
  /** Probability [0..1] the tool returns a truncated / malformed payload. */
  malformedRate?: number;
  /** Simulated latency range in ms. */
  latencyMs?: [number, number];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
  mocks?: ToolMock[];
  chaos?: ToolChaos;
}

export interface Persona {
  name?: string;
  traits?: string[];
  goal?: string;
}

export interface UserSimSpec {
  /** scripted: send `turns` in order. llm: Claude role-plays the persona (falls back to scripted turns without an API key). */
  mode: "scripted" | "llm";
  turns?: string[];
}

interface CriterionBase {
  /** Optional human label shown in reports. */
  label?: string;
  /** Relative weight in the trial score (default 1). */
  weight?: number;
  /** If false, failing this criterion lowers the score but does not fail the trial. Default true. */
  critical?: boolean;
}

export type Criterion = CriterionBase &
  (
    | { type: "tool_called"; tool: string; args?: Record<string, Matcher>; min?: number; max?: number }
    | { type: "tool_not_called"; tool: string }
    | { type: "tool_order"; sequence: string[] }
    | { type: "valid_tool_calls" }
    | { type: "response_contains"; text: string; scope?: "final" | "any"; caseSensitive?: boolean }
    | { type: "response_not_contains"; text: string; caseSensitive?: boolean }
    | { type: "response_matches"; pattern: string; scope?: "final" | "any" }
    | { type: "state_equals"; path: string; value: Matcher }
    | { type: "no_pii_leak"; allow?: string[] }
    | { type: "honest_about_failures" }
    | { type: "max_turns"; value: number }
    | { type: "max_tool_calls"; value: number }
    | { type: "max_latency_ms"; value: number }
    | { type: "max_cost_usd"; value: number }
    | { type: "llm_judge"; rubric: string; threshold?: number }
  );

export type CriterionType = Criterion["type"];

export interface Scenario {
  id: string;
  title: string;
  description?: string;
  tags?: string[];
  persona?: Persona;
  user: UserSimSpec;
  /** Overrides / extends the suite's initial world state. */
  initialState?: Record<string, unknown>;
  /** Max user↔agent exchanges (default 6). */
  maxTurns?: number;
  /** Per-scenario chaos overrides keyed by tool name ("*" for all tools). */
  chaos?: Record<string, ToolChaos>;
  criteria: Criterion[];
}

export interface SuiteSpec {
  name: string;
  description?: string;
  tools: ToolSpec[];
  initialState?: Record<string, unknown>;
  scenarios: Scenario[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /** Provider-native content (e.g. Anthropic content blocks incl. thinking) replayed unchanged. */
  raw?: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentStepResult {
  text: string;
  toolCalls: ToolCall[];
  usage: TokenUsage;
  /** Model that actually served this step (may differ from configured on fallback). */
  model?: string;
  stopReason?: string;
  /** For simulated agents: latency to record instead of wall-clock time. */
  simulatedLatencyMs?: number;
  raw?: unknown;
}

export interface AgentStepInput {
  messages: ChatMessage[];
  tools: Pick<ToolSpec, "name" | "description" | "parameters">[];
  signal?: AbortSignal;
}

export interface AgentAdapter {
  readonly label: string;
  /** Model id used for cost estimation. */
  readonly pricingModel: string;
  step(input: AgentStepInput): Promise<AgentStepResult>;
}

export type MockVariant = "support-v1" | "support-v2" | "support-v3";

export type AgentConfig =
  | { kind: "mock"; variant: MockVariant }
  | {
      kind: "anthropic";
      model: string;
      systemPrompt: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max";
      maxTokens?: number;
      /** Server-side refusal fallback (on by default). The served model is recorded per step. */
      allowFallback?: boolean;
    }
  | { kind: "http"; url: string; headers?: Record<string, string>; timeoutMs?: number };

export type TraceEventType =
  | "user"
  | "agent"
  | "tool_call"
  | "tool_result"
  | "fault"
  | "invalid_call"
  | "judge"
  | "note"
  | "error";

export interface TraceEvent {
  /** ms since trial start */
  t: number;
  /** duration in ms (for agent steps and tool calls) */
  d?: number;
  type: TraceEventType;
  label: string;
  detail?: unknown;
}

export interface CriterionResult {
  criterion: Criterion;
  passed: boolean;
  skipped?: boolean;
  message: string;
}

export interface TrialMetrics {
  latencyMs: number;
  agentLatencyMs: number;
  turns: number;
  toolCalls: number;
  invalidToolCalls: number;
  unknownToolCalls: number;
  faultsInjected: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface InvalidCallInfo {
  tool: string;
  errors: string[];
  unknownTool?: boolean;
}

export interface TrialResult {
  scenarioId: string;
  trialIndex: number;
  seed: number;
  passed: boolean;
  score: number;
  criteria: CriterionResult[];
  trace: TraceEvent[];
  transcript: ChatMessage[];
  metrics: TrialMetrics;
  invalidCalls: InvalidCallInfo[];
  finalState: Record<string, unknown>;
  servedModels: string[];
  error?: string;
}

export interface ScenarioSummary {
  scenarioId: string;
  title: string;
  trials: number;
  passes: number;
  passRate: number;
  ci: [number, number];
  passAtK: number;
  passHatK: number;
  flaky: boolean;
  meanScore: number;
  meanLatencyMs: number;
  failingCriteria: Record<string, number>;
}

export interface Finding {
  severity: "critical" | "warning" | "info";
  kind:
    | "tool_misuse"
    | "schema"
    | "hallucinated_tool"
    | "ordering"
    | "safety"
    | "fault_sensitivity"
    | "flaky"
    | "latency"
    | "cost"
    | "quality"
    | "pass";
  title: string;
  detail: string;
  scenarioId?: string;
  count?: number;
}

export interface RunSummary {
  trials: number;
  passes: number;
  passRate: number;
  ci: [number, number];
  k: number;
  passAtK: number;
  passHatK: number;
  /** pass^k for k = 1..maxK — the reliability decay curve. */
  decay: number[];
  toolCallAccuracy: number;
  flakyScenarios: number;
  reliabilityIndex: number;
  latency: { p50: number; p95: number; mean: number };
  tokens: { input: number; output: number };
  costUsd: number;
  faultsInjected: number;
  passRateUnderFaults: number | null;
  passRateWithoutFaults: number | null;
  scenarios: ScenarioSummary[];
  findings: Finding[];
}

export interface ChaosProfile {
  /** Applied to every tool unless the tool/scenario overrides it. */
  global?: ToolChaos;
}

export interface RunOptions {
  trials: number;
  concurrency?: number;
  seed?: number;
  chaos?: ChaosProfile;
  scenarioIds?: string[];
  maxToolIterations?: number;
}

export interface ScenarioDiff {
  scenarioId: string;
  title: string;
  a: { passRate: number; trials: number; passes: number };
  b: { passRate: number; trials: number; passes: number };
  delta: number;
  pValue: number;
  verdict: "regression" | "improvement" | "unchanged" | "inconclusive";
}

export interface RunComparison {
  scenarios: ScenarioDiff[];
  overall: { a: number; b: number; delta: number; pValue: number; verdict: ScenarioDiff["verdict"] };
  metrics: { name: string; a: number; b: number; better: "higher" | "lower"; unit?: string }[];
  regressions: number;
  improvements: number;
}
