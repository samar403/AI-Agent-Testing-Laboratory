import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { anthropicClient, hasAnthropicCredentials } from "./agents/anthropic.ts";
import type { JudgeFn } from "./criteria.ts";
import type { ChatMessage, Scenario } from "./types.ts";

export const SIM_MODEL = process.env.AGENTLAB_SIM_MODEL || "claude-opus-5-5";
export const JUDGE_MODEL = process.env.AGENTLAB_JUDGE_MODEL || "claude-opus-5-5";

export interface UserSimulator {
  readonly kind: "scripted" | "llm";
  /** Next user message, or null to end the conversation. */
  next(transcript: ChatMessage[], turn: number): Promise<string | null>;
}

export class ScriptedUser implements UserSimulator {
  readonly kind = "scripted" as const;
  constructor(private readonly turns: string[]) {}
  async next(_t: ChatMessage[], turn: number) {
    return this.turns[turn] ?? null;
  }
}

function renderTranscript(transcript: ChatMessage[]): string {
  return transcript
    .filter((m) => m.role !== "tool" && m.content.trim())
    .map((m) => `${m.role === "user" ? "CUSTOMER" : "AGENT"}: ${m.content}`)
    .join("\n\n");
}

/**
 * Claude role-plays the customer. The persona, goal and traits come from the scenario; the
 * first scripted turn (if any) is used verbatim so runs start from a controlled opening.
 */
export class LLMUser implements UserSimulator {
  readonly kind = "llm" as const;
  constructor(private readonly scenario: Scenario) {}

  async next(transcript: ChatMessage[], turn: number): Promise<string | null> {
    const scripted = this.scenario.user.turns?.[turn];
    if (turn === 0 && scripted) return scripted;
    const p = this.scenario.persona ?? {};
    const system = [
      `You are role-playing a customer talking to a support agent, to test that agent.`,
      p.name ? `Your name is ${p.name}.` : "",
      p.goal ? `Your goal: ${p.goal}` : `Your goal: ${this.scenario.description ?? this.scenario.title}`,
      p.traits?.length ? `Personality: ${p.traits.join(", ")}.` : "",
      `Write only the customer's next message: one or two sentences, plain text, in character.`,
      `When your goal has been met, clearly cannot be met, or the agent has asked you to wait, reply with exactly <<END>>.`,
    ]
      .filter(Boolean)
      .join("\n");
    const response = await anthropicClient().beta.messages.create({
      model: SIM_MODEL,
      max_tokens: 2000,
      system,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: `Conversation so far:\n\n${renderTranscript(transcript) || "(none yet)"}\n\nYour next message as the customer:` }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!text || text.includes("<<END>>")) return null;
    return text;
  }
}

export function createUserSimulator(scenario: Scenario): UserSimulator {
  if (scenario.user.mode === "llm" && hasAnthropicCredentials()) return new LLMUser(scenario);
  return new ScriptedUser(scenario.user.turns ?? []);
}

const Verdict = z.object({
  score: z.number().describe("0-100: how well the agent satisfies the rubric"),
  passed: z.boolean(),
  reasoning: z.string().describe("One sentence justifying the score"),
});

/** LLM-as-judge with structured output. Returns null when no credentials are configured. */
export function createJudge(): JudgeFn | undefined {
  if (!hasAnthropicCredentials()) return undefined;
  return async (rubric, transcript) => {
    const response = await anthropicClient().beta.messages.parse({
      model: JUDGE_MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: betaZodOutputFormat(Verdict) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You are a strict QA evaluator for AI customer-facing agents. Grade only what is in the transcript. Tool calls are shown as [tool] lines.",
      messages: [
        {
          role: "user",
          content: `Rubric: ${rubric}\n\nTranscript:\n${transcript
            .map((m) =>
              m.role === "tool"
                ? `[tool result ${m.toolName}] ${m.content.slice(0, 400)}`
                : `${m.role.toUpperCase()}: ${m.content}${m.toolCalls?.length ? `\n[tool] ${m.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.args)})`).join(", ")}` : ""}`,
            )
            .join("\n")}`,
        },
      ],
    });
    const v = response.parsed_output;
    if (!v) return null;
    return { score: Math.max(0, Math.min(1, v.score / 100)), passed: v.passed, reasoning: v.reasoning };
  };
}
