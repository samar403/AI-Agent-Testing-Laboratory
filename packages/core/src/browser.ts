// Browser-safe surface of the engine (no Node or SDK imports): types, metrics, criteria labels, pricing, demo data.
export * from "./types.ts";
export { describeCriterion } from "./criteria.ts";
export { wilson, passAtK, passHatK, fisherExact, compareRuns, reliabilityIndex } from "./metrics.ts";
export { MODEL_PRICING, AGENT_MODELS, PLANS, estimateCost, type PlanId } from "./pricing.ts";
export { MOCK_VARIANTS } from "./agents/mock.ts";
export { DEMO_SUITES, SUPPORT_SUITE, PERSONA_SUITE, SUPPORT_SYSTEM_PROMPT } from "./demo.ts";
export { validateSuite } from "./schema.ts";
export { toMarkdown } from "./report.ts";
