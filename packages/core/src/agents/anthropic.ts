import Anthropic from "@anthropic-ai/sdk";
import type { AgentAdapter, AgentStepInput, AgentStepResult, ChatMessage, ToolCall } from "../types.ts";

export function hasAnthropicCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let shared: Anthropic | null = null;
export function anthropicClient(): Anthropic {
  shared ??= new Anthropic();
  return shared;
}

/**
 * Convert the lab's provider-neutral transcript into Anthropic messages. Assistant turns are
 * replayed from their raw content blocks (thinking included, unchanged) so the history stays
 * append-only. Consecutive tool results are merged into a single user message.
 */
export function toAnthropicMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (Array.isArray(m.raw)) {
        out.push({ role: "assistant", content: m.raw as Anthropic.Beta.BetaContentBlockParam[] });
      } else {
        const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args ?? {} });
        out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "(no reply)" }] });
      }
    } else {
      const block: Anthropic.Beta.BetaToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: m.toolCallId!,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      };
      const prev = out[out.length - 1];
      if (prev && prev.role === "user" && Array.isArray(prev.content) && prev.content.every((b) => b.type === "tool_result")) {
        prev.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export interface AnthropicAgentOptions {
  model: string;
  systemPrompt: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  allowFallback?: boolean;
}

/** An agent under test that is powered directly by Claude through the Messages API. */
export class AnthropicAgent implements AgentAdapter {
  readonly label: string;
  readonly pricingModel: string;

  constructor(private readonly opts: AnthropicAgentOptions) {
    this.label = `Claude · ${opts.model}`;
    this.pricingModel = opts.model;
  }

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const client = anthropicClient();
    const fallback = this.opts.allowFallback !== false;
    const response = await client.beta.messages.create(
      {
        model: this.opts.model,
        max_tokens: this.opts.maxTokens ?? 16000,
        system: this.opts.systemPrompt,
        output_config: { effort: this.opts.effort ?? "medium" },
        tools: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: { type: "object" as const, ...(t.parameters as Record<string, unknown>) },
        })),
        messages: toAnthropicMessages(input.messages),
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: input.signal },
    );

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") toolCalls.push({ id: block.id, name: block.name, args: block.input });
    }
    if (response.stop_reason === "refusal") {
      text ||= `[refused${response.stop_details?.category ? `: ${response.stop_details.category}` : ""}]`;
    }
    return {
      text,
      toolCalls,
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      model: response.model,
      stopReason: response.stop_reason ?? undefined,
      raw: response.content,
    };
  }
}
