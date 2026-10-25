import type { AgentAdapter, AgentStepInput, AgentStepResult, ToolCall } from "../types.ts";
import { estimateTokens } from "../util.ts";

/**
 * AgentLab Agent Protocol v1 — plug in any agent (any framework, any model) by exposing one endpoint.
 *
 * Request  POST <url>
 *   { protocol: "agentlab/v1",
 *     messages: [{ role: "user"|"assistant"|"tool", content, tool_calls?, tool_call_id?, name? }],
 *     tools: [{ name, description, parameters }] }
 *
 * Response 200
 *   { content: string,
 *     tool_calls?: [{ id?, name, arguments: object | string }],
 *     usage?: { input_tokens, output_tokens }, model?: string }
 *
 * Return tool_calls to have the lab execute them in the sandbox; return only content to reply to the user.
 */
export interface HttpAgentOptions {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface WireToolCall {
  id?: string;
  name: string;
  arguments?: unknown;
}

export class HttpAgent implements AgentAdapter {
  readonly label: string;
  readonly pricingModel = "external";
  private counter = 0;

  constructor(private readonly opts: HttpAgentOptions) {
    this.label = `HTTP · ${new URL(opts.url).host}`;
  }

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const body = {
      protocol: "agentlab/v1",
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, name: t.name, arguments: t.args })) } : {}),
        ...(m.role === "tool" ? { tool_call_id: m.toolCallId, name: m.toolName, is_error: Boolean(m.isError) } : {}),
      })),
      tools: input.tools,
    };
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 60_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const res = await fetch(this.opts.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.opts.headers },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`agent endpoint returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      content?: string;
      tool_calls?: WireToolCall[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const toolCalls: ToolCall[] = (data.tool_calls ?? []).map((tc) => ({
      id: tc.id ?? `call_${++this.counter}`,
      name: tc.name,
      args: typeof tc.arguments === "string" ? safeParse(tc.arguments) : tc.arguments ?? {},
    }));
    const text = data.content ?? "";
    return {
      text,
      toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens ?? estimateTokens(JSON.stringify(body.messages)),
        outputTokens: data.usage?.output_tokens ?? estimateTokens(text + JSON.stringify(toolCalls)),
      },
      model: data.model,
    };
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s; // keep the raw string so schema validation flags it
  }
}
