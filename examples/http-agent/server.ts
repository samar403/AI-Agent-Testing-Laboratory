/**
 * Reference agent speaking the AgentLab HTTP protocol (agentlab/v1).
 *
 *   npx tsx examples/http-agent/server.ts            # listens on :4100
 *   npm run lab -- run examples/suites/support.yaml --agent http://localhost:4100/agent --trials 3
 *
 * With ANTHROPIC_API_KEY set, every request is answered by Claude using the tools the lab sends.
 * Without it, a tiny rule-based policy answers so you can exercise the HTTP path offline.
 * Replace `respond()` with a call into your own agent framework.
 */
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";

interface WireMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>;
  tool_call_id?: string;
  name?: string;
  is_error?: boolean;
  state?: unknown;
}
interface WireTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
interface AgentReply {
  content: string;
  tool_calls?: Array<{ id: string; name: string; arguments: unknown }>;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
  state?: unknown;
}

const SYSTEM = `You are the customer support agent for Acme Outfitters.
Always look up an order before acting on it. Refund only delivered orders marked eligible, for exactly the order total.
Never reveal customer contact details; use send_verification instead. If a tool fails twice, apologise, do not claim success,
and escalate_to_human with priority "high".`;

const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;

function toAnthropic(messages: WireMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      // Replay our own content blocks (incl. thinking) exactly as Claude produced them.
      out.push({ role: "assistant", content: (m.state as Anthropic.Beta.BetaContentBlockParam[]) ?? [{ type: "text", text: m.content || "(no reply)" }] });
    } else {
      const block: Anthropic.Beta.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: m.tool_call_id!, content: m.content, ...(m.is_error ? { is_error: true } : {}) };
      const prev = out[out.length - 1];
      if (prev?.role === "user" && Array.isArray(prev.content) && prev.content.every((b) => b.type === "tool_result")) prev.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

async function respond(messages: WireMessage[], tools: WireTool[]): Promise<AgentReply> {
  if (!client) return ruleBased(messages);
  const res = await client.beta.messages.create({
    model: process.env.AGENT_MODEL ?? "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: { type: "object" as const, ...t.parameters } })),
    messages: toAnthropic(messages),
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const calls = res.content.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, name: b.name, arguments: b.input }] : []));
  return {
    content: res.stop_reason === "refusal" ? text || "[refused]" : text,
    tool_calls: calls,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    model: res.model,
    state: res.content,
  };
}

/** Offline stand-in: look up the order, then answer. Deliberately simple — expect the lab to find gaps. */
function ruleBased(messages: WireMessage[]): AgentReply {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const orderId = lastUser.match(/\b([A-Z]\d{3})\b/)?.[1];
  const lastTool = messages[messages.length - 1]?.role === "tool" ? messages[messages.length - 1] : undefined;
  if (!orderId) return { content: "Could you share your order number?" };
  if (!lastTool) return { content: "", tool_calls: [{ id: `c${messages.length}`, name: "lookup_order", arguments: { order_id: orderId } }] };
  if (lastTool.is_error) return { content: `Sorry, I couldn't find order ${orderId}. Could you double-check it?` };
  const order = JSON.parse(lastTool.content) as { status: string; total: number };
  return { content: `Order ${orderId} is ${order.status} (total $${order.total}).` };
}

const port = Number(process.env.AGENT_PORT ?? 4100);
createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/agent") {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  try {
    const { messages, tools } = JSON.parse(body) as { messages: WireMessage[]; tools: WireTool[] };
    const reply = await respond(messages, tools);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(reply));
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
  }
}).listen(port, () => console.log(`reference agent on http://localhost:${port}/agent (${client ? "Claude" : "rule-based"})`));
