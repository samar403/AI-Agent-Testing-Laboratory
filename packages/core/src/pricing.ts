/** USD per million tokens. Used to estimate the cost of every trial. */
export const MODEL_PRICING: Record<string, { input: number; output: number; label: string }> = {
  "claude-fable-5-1": { input: 10, output: 50, label: "Claude Fable 5.1" },
  "claude-opus-5-5": { input: 4, output: 20, label: "Claude Opus 5.5" },
  "claude-sonnet-5-5": { input: 2, output: 10, label: "Claude Sonnet 5.5" },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, label: "Claude Haiku 5.5" },
  "claude-opus-5": { input: 5, output: 25, label: "Claude Opus 5" },
  "claude-sonnet-5": { input: 2, output: 10, label: "Claude Sonnet 5" },
  "claude-opus-4-8": { input: 5, output: 25, label: "Claude Opus 4.8" },
  "claude-haiku-4-5": { input: 1, output: 5, label: "Claude Haiku 4.5" },
  // Simulated specimens are priced like a mid-tier model so cost charts stay meaningful.
  "simulated": { input: 2, output: 10, label: "Simulated agent (est.)" },
  "external": { input: 0, output: 0, label: "External agent (self-reported)" },
};

export const AGENT_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] as const;

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING["simulated"]!;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** AgentLab's own plans (usage-based + subscription). One "trial" = one simulated conversation. */
export const PLANS = [
  {
    id: "bench",
    name: "Bench",
    price: 0,
    includedTrials: 1_000,
    overagePerTrial: null as number | null,
    seats: 1,
    features: ["Unlimited suites & agents", "Simulated users + chaos", "7-day trace retention", "CLI"],
  },
  {
    id: "lab",
    name: "Lab",
    price: 49,
    includedTrials: 20_000,
    overagePerTrial: 0.002,
    seats: 5,
    features: ["Everything in Bench", "LLM-as-judge & persona sims", "CI gates + JUnit", "Version comparison", "90-day retention"],
  },
  {
    id: "institute",
    name: "Institute",
    price: 399,
    includedTrials: 250_000,
    overagePerTrial: 0.0012,
    seats: 50,
    features: ["Everything in Lab", "SSO & audit log", "Private runners (VPC)", "Unlimited retention", "Priority support"],
  },
] as const;

export type PlanId = (typeof PLANS)[number]["id"];
