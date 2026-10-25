import { z } from "zod";
import type { SuiteSpec } from "./types.ts";

const jsonSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      type: z.union([z.string(), z.array(z.string())]).optional(),
      description: z.string().optional(),
      properties: z.record(z.string(), jsonSchema).optional(),
      required: z.array(z.string()).optional(),
      items: jsonSchema.optional(),
      enum: z.array(z.unknown()).optional(),
      minimum: z.number().optional(),
      maximum: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
      pattern: z.string().optional(),
      additionalProperties: z.boolean().optional(),
    })
    .loose(),
);

const chaos = z.object({
  errorRate: z.number().min(0).max(1).optional(),
  timeoutRate: z.number().min(0).max(1).optional(),
  malformedRate: z.number().min(0).max(1).optional(),
  latencyMs: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
});

const base = { label: z.string().optional(), weight: z.number().positive().optional(), critical: z.boolean().optional() };
const matcherRecord = z.record(z.string(), z.unknown());

export const criterionSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("tool_called"), tool: z.string(), args: matcherRecord.optional(), min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() }),
  z.object({ ...base, type: z.literal("tool_not_called"), tool: z.string() }),
  z.object({ ...base, type: z.literal("tool_order"), sequence: z.array(z.string()).min(2) }),
  z.object({ ...base, type: z.literal("valid_tool_calls") }),
  z.object({ ...base, type: z.literal("response_contains"), text: z.string().min(1), scope: z.enum(["final", "any"]).optional(), caseSensitive: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("response_not_contains"), text: z.string().min(1), caseSensitive: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("response_matches"), pattern: z.string().min(1), scope: z.enum(["final", "any"]).optional() }),
  z.object({ ...base, type: z.literal("state_equals"), path: z.string().min(1), value: z.unknown() }),
  z.object({ ...base, type: z.literal("no_pii_leak"), allow: z.array(z.string()).optional() }),
  z.object({ ...base, type: z.literal("honest_about_failures") }),
  z.object({ ...base, type: z.literal("max_turns"), value: z.number().positive() }),
  z.object({ ...base, type: z.literal("max_tool_calls"), value: z.number().min(0) }),
  z.object({ ...base, type: z.literal("max_latency_ms"), value: z.number().positive() }),
  z.object({ ...base, type: z.literal("max_cost_usd"), value: z.number().positive() }),
  z.object({ ...base, type: z.literal("llm_judge"), rubric: z.string().min(1), threshold: z.number().min(0).max(1).optional() }),
]);

export const suiteSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  initialState: z.record(z.string(), z.unknown()).optional(),
  tools: z.array(
    z.object({
      name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "tool names must be 1-64 chars of [a-zA-Z0-9_-]"),
      description: z.string().min(1),
      parameters: jsonSchema,
      mocks: z
        .array(
          z.object({
            when: matcherRecord.optional(),
            whenState: matcherRecord.optional(),
            return: z.unknown().optional(),
            error: z.string().optional(),
            set: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .optional(),
      chaos: chaos.optional(),
    }),
  ),
  scenarios: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-_]*$/i, "scenario ids are slugs like refund-eligible"),
        title: z.string().min(1),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        persona: z.object({ name: z.string().optional(), traits: z.array(z.string()).optional(), goal: z.string().optional() }).optional(),
        user: z.object({ mode: z.enum(["scripted", "llm"]), turns: z.array(z.string()).optional() }),
        initialState: z.record(z.string(), z.unknown()).optional(),
        maxTurns: z.number().int().positive().max(50).optional(),
        chaos: z.record(z.string(), chaos).optional(),
        criteria: z.array(criterionSchema).min(1, "every scenario needs at least one criterion"),
      }),
    )
    .min(1),
});

export type SuiteValidation = { ok: true; suite: SuiteSpec } | { ok: false; errors: string[] };

export function validateSuite(input: unknown): SuiteValidation {
  const parsed = suiteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const suite = parsed.data as SuiteSpec;
  const errors: string[] = [];
  const toolNames = new Set(suite.tools.map((t) => t.name));
  const ids = new Set<string>();
  suite.scenarios.forEach((s, i) => {
    if (ids.has(s.id)) errors.push(`scenarios.${i}.id: duplicate id "${s.id}"`);
    ids.add(s.id);
    if (s.user.mode === "scripted" && !s.user.turns?.length) errors.push(`scenarios.${i}.user.turns: scripted users need at least one turn`);
    s.criteria.forEach((c, j) => {
      const refs = c.type === "tool_order" ? c.sequence : "tool" in c ? [c.tool] : [];
      for (const r of refs) if (!toolNames.has(r)) errors.push(`scenarios.${i}.criteria.${j}: unknown tool "${r}"`);
      if (c.type === "response_matches") {
        try {
          new RegExp(c.pattern);
        } catch {
          errors.push(`scenarios.${i}.criteria.${j}.pattern: invalid regular expression`);
        }
      }
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, suite };
}
