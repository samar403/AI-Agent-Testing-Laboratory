import type { AgentConfig, Finding, RunComparison, RunOptions, RunSummary, Scenario, SuiteSpec, TrialResult, PLANS } from "@agentlab/core/browser";

export interface Version {
  id: string;
  agent_id: string;
  version: string;
  config: AgentConfig;
  notes: string;
  created_at: number;
}
export interface Agent {
  id: string;
  name: string;
  description: string;
  created_at: number;
  versions: Version[];
}
export interface RunHeadline {
  ri: number;
  passRate: number;
  passHatK: number;
  k: number;
  toolCallAccuracy: number;
  critical: number;
  costUsd: number;
}
export interface LightRun {
  id: string;
  experimentId: string;
  suiteId: string | null;
  versionId: string | null;
  suiteName: string;
  agentLabel: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  options: RunOptions;
  total: number;
  done: number;
  error: string | null;
  source: "lab" | "ci";
  createdAt: number;
  finishedAt: number | null;
  headline: RunHeadline | null;
}
export interface Cell {
  id: string;
  scenarioId: string;
  trialIndex: number;
  passed: boolean;
  score: number;
  metrics: TrialResult["metrics"];
}
export interface RunDetail {
  id: string;
  experiment_id: string;
  suite_id: string | null;
  agent_version_id: string | null;
  suite_name: string;
  agent_label: string;
  status: LightRun["status"];
  options: RunOptions;
  summary: RunSummary | null;
  total: number;
  done: number;
  error: string | null;
  source: "lab" | "ci";
  created_at: number;
  finished_at: number | null;
  suite: { tools: string[]; scenarios: Array<{ id: string; title: string; tags: string[]; criteria: number }> };
  agent: AgentConfig | { kind: "external" };
  cells: Cell[];
  siblings: LightRun[];
}
export interface SuiteListItem {
  id: string;
  name: string;
  description: string;
  spec: SuiteSpec;
  created_at: number;
  updated_at: number;
  scenarioCount: number;
  toolCount: number;
  criteriaCount: number;
  lastRun: LightRun | null;
}
export interface SuiteDetail extends Omit<SuiteListItem, "scenarioCount" | "toolCount" | "criteriaCount" | "lastRun"> {
  yaml: string;
  runs: LightRun[];
}
export interface TrialDetail extends TrialResult {
  id: string;
  runId: string;
  run: LightRun;
  scenario?: Scenario;
  siblings: Array<{ id: string; trialIndex: number; passed: boolean }>;
}
type Plan = (typeof PLANS)[number];
export interface Usage {
  plan: Plan;
  periodStart: number;
  periodEnd: number;
  trials: number;
  modelCostUsd: number;
  overageTrials: number;
  overageUsd: number;
  projectedInvoiceUsd: number;
  daily: Array<{ day: number; trials: number; cost: number }>;
  plans?: Plan[];
}
export interface Overview {
  counts: { agents: number; versions: number; suites: number; runs: number };
  bestRun: { id: string; label: string; suite: string; ri: number } | null;
  totals: { trials: number; regressionsCaught: number; criticalFindings: number };
  recentRuns: LightRun[];
  openFindings: Array<Finding & { runId: string; agentLabel: string; suiteName: string }>;
  history: Array<{ runId: string; versionId: string | null; suiteId: string | null; label: string; at: number; ri: number; passRate: number }>;
  usage: Usage;
  anthropic: boolean;
}
export interface Health {
  ok: boolean;
  version: string;
  anthropic: boolean;
  locked: boolean;
  models: string[];
  variants: Record<string, { name: string; description: string }>;
}
export interface CompareResult {
  a: LightRun & { summary: RunSummary };
  b: LightRun & { summary: RunSummary };
  comparison: RunComparison;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details: string[] = []) {
    super(message);
  }
}

const TOKEN_KEY = "agentlab.token";
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* storage unavailable */
  }
}

let onAuthRequired: (() => void) | null = null;
export function setAuthHandler(fn: () => void) {
  onAuthRequired = fn;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { "x-agentlab-token": token } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && (data as { auth?: boolean }).auth) onAuthRequired?.();
    throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`, (data as { details?: string[] }).details ?? []);
  }
  return data as T;
}

export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const del = (path: string) => api<void>(path, { method: "DELETE" });

export function eventsUrl(runId: string): string {
  const token = getToken();
  return `/api/runs/${runId}/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}
export function reportUrl(runId: string, format: "json" | "junit" | "markdown"): string {
  const token = getToken();
  return `/api/runs/${runId}/report?format=${format}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
}
