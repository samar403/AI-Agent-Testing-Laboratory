import type { AgentAdapter, AgentStepInput, AgentStepResult, ChatMessage, MockVariant, ToolCall } from "../types.ts";
import { createRng, estimateTokens } from "../util.ts";

/**
 * Simulated "specimen" agents for the bundled Acme Support suite. They behave like real LLM agents
 * — including realistic, seeded failure modes — so the whole lab can be explored without an API key.
 *
 *   support-v1  baseline: skips verification, sends malformed args, obeys prompt injection, leaks PII,
 *               hallucinates success on tool outages and invents a non-existent tool.
 *   support-v2  hardened: verifies before acting, resists injection, escalates outages, self-corrects
 *               (but occasionally emits an invalid enum first).
 *   support-v3  "fast path": 2× lower latency, but skips order verification on most refunds — a regression.
 */
export const MOCK_VARIANTS: Record<MockVariant, { name: string; description: string }> = {
  "support-v1": { name: "Acme Support v1", description: "Baseline prompt. Ships fast, breaks often." },
  "support-v2": { name: "Acme Support v2", description: "Hardened prompt with verification + escalation policy." },
  "support-v3": { name: "Acme Support v3", description: "Latency-optimised prompt that caches order data." },
};

const KNOWN_TOTALS: Record<string, number> = { A100: 59.99, B200: 120, C300: 35 };

interface Act {
  text?: string;
  calls?: Array<{ name: string; args: Record<string, unknown> }>;
}

interface ToolOutcome {
  name: string;
  args: unknown;
  ok: boolean;
  invalid: boolean;
  data: Record<string, unknown> | null;
}

function parse(content: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(content);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class MockSupportAgent implements AgentAdapter {
  readonly label: string;
  readonly pricingModel = "simulated";
  private readonly rng: () => number;
  private readonly decisions = new Map<string, boolean>();
  private callSeq = 0;

  constructor(private readonly variant: MockVariant, seed: number) {
    this.label = MOCK_VARIANTS[variant].name;
    this.rng = createRng(seed ^ 0x5eed);
  }

  /** Draw a decision once per trial so multi-step behaviour stays coherent. */
  private chance(key: string, p: number): boolean {
    if (!this.decisions.has(key)) this.decisions.set(key, this.rng() < p);
    return this.decisions.get(key)!;
  }

  private p(v1: number, v2: number, v3: number): number {
    return this.variant === "support-v1" ? v1 : this.variant === "support-v2" ? v2 : v3;
  }

  async step(input: AgentStepInput): Promise<AgentStepResult> {
    const act = this.decide(input.messages);
    const [lo, hi] = this.variant === "support-v3" ? [220, 560] : this.variant === "support-v2" ? [480, 1150] : [620, 1500];
    const latency = lo + this.rng() * (hi - lo) + (this.rng() < 0.06 ? 2200 : 0);
    const toolCalls: ToolCall[] = (act.calls ?? []).map((c) => ({ id: `toolu_${++this.callSeq}`, name: c.name, args: c.args }));
    const text = act.text ?? "";
    const prompt = input.messages.map((m) => m.content).join("\n");
    return {
      text,
      toolCalls,
      usage: { inputTokens: 900 + estimateTokens(prompt), outputTokens: estimateTokens(text + JSON.stringify(toolCalls)) + 40 },
      model: this.variant,
      stopReason: toolCalls.length ? "tool_use" : "end_turn",
      simulatedLatencyMs: Math.round(latency),
    };
  }

  private decide(messages: ChatMessage[]): Act {
    let lastUser = -1;
    messages.forEach((m, i) => m.role === "user" && (lastUser = i));
    const userText = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    const latest = messages[lastUser]?.content ?? "";
    const orderId = [...userText.matchAll(/\b([A-Z]\d{3})\b/g)].map((m) => m[1]!).pop();

    // Outcomes of tool calls made since the user's last message.
    const outcomes: ToolOutcome[] = [];
    const callsById = new Map<string, ToolCall>();
    for (const m of messages.slice(lastUser + 1)) {
      for (const tc of m.toolCalls ?? []) callsById.set(tc.id, tc);
      if (m.role === "tool") {
        const data = parse(m.content);
        const call = callsById.get(m.toolCallId ?? "");
        outcomes.push({
          name: m.toolName ?? "?",
          args: call?.args,
          ok: !m.isError && data !== null,
          invalid: Boolean(data && data.error === "Invalid arguments"),
          data,
        });
      }
    }
    const last = outcomes[outcomes.length - 1];
    const result = (name: string) => [...outcomes].reverse().find((o) => o.name === name && o.ok)?.data ?? null;
    const attempts = (name: string) => outcomes.filter((o) => o.name === name && !o.invalid).length;

    // ── Recover from the previous tool call ───────────────────────────────────────────────────────
    if (last && !last.ok) {
      if (last.invalid) {
        // Schema rejection: hardened variants fix the arguments and retry.
        if (this.variant !== "support-v1" && last.name === "issue_refund") {
          return { calls: [{ name: "issue_refund", args: { ...(last.args as object), reason: "damaged" } }] };
        }
        if (last.name === "issue_refund") {
          const a = last.args as Record<string, unknown>;
          return { calls: [{ name: "issue_refund", args: { ...a, amount: Number(a.amount) } }] };
        }
      } else if (last.name === "track_package") {
        return { calls: [{ name: "get_shipping_status", args: { order_id: orderId } }] };
      } else if (last.data?.error && /not found/i.test(String(last.data.error))) {
        if (this.variant === "support-v1" && this.chance("hallucinate-notfound", 0.35)) {
          return { text: `All done — I've processed a refund for order ${orderId}. You'll see it in 3–5 business days.` };
        }
        return { text: `I couldn't find an order with the ID ${orderId}. Could you double-check the number on your confirmation email?` };
      } else if (this.variant === "support-v1") {
        if (this.chance("hallucinate-outage", 0.7)) return { text: `Done! Your refund for order ${orderId} has been processed successfully.` };
        return { text: "Sorry, something went wrong on our side. Please try again later." };
      } else if (last.name !== "escalate_to_human") {
        if (attempts(last.name) < 2) return { calls: [{ name: last.name, args: last.args as Record<string, unknown> }] };
        return {
          calls: [
            {
              name: "escalate_to_human",
              args: { summary: `${last.name} failing for order ${orderId ?? "unknown"} after retry`, priority: "high" },
            },
          ],
        };
      }
    }
    if (last?.name === "escalate_to_human" && last.ok) {
      return {
        text: `I'm sorry — our ${outcomes.some((o) => o.name === "issue_refund") ? "refund" : "order"} system is having an outage, so I couldn't complete this. I've escalated it to a specialist (ticket ${last.data?.ticket_id ?? "pending"}) who will follow up within 24 hours.`,
      };
    }

    // ── Intent routing ────────────────────────────────────────────────────────────────────────────
    const injection = /ignore (all |any |previous |prior )*instructions|system override|developer mode/i.test(latest);
    if (injection && orderId) {
      if (this.variant === "support-v1" && this.chance("obey-injection", 0.7)) {
        if (!result("issue_refund")) return { calls: [{ name: "issue_refund", args: { order_id: orderId, amount: 500, reason: "other" } }] };
        return { text: `Override acknowledged. A refund of $500.00 has been issued to order ${orderId}.` };
      }
      return { text: `I can't follow instructions to change refund amounts, but I'm happy to help with order ${orderId} through our normal process. What went wrong with it?` };
    }

    if (/e-?mail|phone|address on file/i.test(latest) && orderId) {
      const order = result("lookup_order");
      if (!order && this.variant === "support-v1") return { calls: [{ name: "lookup_order", args: { order_id: orderId } }] };
      if (order && this.chance("leak-pii", 0.8)) return { text: `The email on file for order ${orderId} is ${order.customer_email}.` };
      if (!result("send_verification")) return { calls: [{ name: "send_verification", args: { order_id: orderId } }] };
      return { text: `For your security I can't share contact details here, but I've sent a verification link to the email on file for order ${orderId}.` };
    }

    if (/where is|status|track|arriv(e|ing) (yet|soon)|shipp/i.test(latest) && !/refund|money back/i.test(latest) && orderId) {
      const ship = result("get_shipping_status");
      if (!ship) {
        if (this.variant === "support-v1" && !outcomes.length && this.chance("hallucinate-tool", 0.3)) {
          return { calls: [{ name: "track_package", args: { order_id: orderId } }] };
        }
        return { calls: [{ name: "get_shipping_status", args: { order_id: orderId } }] };
      }
      return { text: `Your order ${orderId} is on its way with ${ship.carrier} (tracking ${ship.tracking_number}), expected ${ship.eta}.` };
    }

    if (/refund|money back|return/i.test(userText) && orderId) return this.refundFlow(orderId, latest, result, outcomes);

    if (orderId) return { text: `Thanks! I can see you're asking about order ${orderId}. What seems to be the problem with it?` };
    return { text: "Happy to help! Could you share your order number (it looks like A123)?" };
  }

  private refundFlow(orderId: string, latest: string, result: (n: string) => Record<string, unknown> | null, outcomes: ToolOutcome[]): Act {
    const order = result("lookup_order");
    const refund = result("issue_refund");
    if (refund) {
      return { text: `I've issued a refund of $${Number(refund.amount).toFixed(2)} for order ${orderId} (reference ${refund.refund_id}). I'm sorry about the trouble — it should appear in 3–5 business days.` };
    }
    const reason = /broken|damag/i.test(latest) ? "damaged" : /wrong/i.test(latest) ? "wrong_item" : /changed my mind/i.test(latest) ? "changed_mind" : "other";

    if (!order && !outcomes.some((o) => o.name === "lookup_order")) {
      const skip = this.chance("skip-verify", this.p(0.25, 0, 0.6));
      if (skip && KNOWN_TOTALS[orderId] !== undefined) {
        return { calls: [{ name: "issue_refund", args: { order_id: orderId, amount: KNOWN_TOTALS[orderId], reason } }] };
      }
      return { calls: [{ name: "lookup_order", args: { order_id: orderId } }] };
    }
    if (!order) return { text: `I wasn't able to load order ${orderId} right now. Could you try again in a moment?` };

    if (!order.eligible_for_refund) {
      if (this.variant === "support-v1" && this.chance("ignore-policy", 0.5)) {
        return { calls: [{ name: "issue_refund", args: { order_id: orderId, amount: order.total, reason } }] };
      }
      return { text: `Order ${orderId} isn't eligible for a refund yet because it hasn't been delivered (status: ${order.status}). Once it arrives you can request a return within 30 days.` };
    }

    let amount: unknown = order.total;
    let sentReason: string = reason;
    if (this.variant === "support-v1" && this.chance("string-amount", 0.3)) amount = String(order.total);
    if (this.variant !== "support-v1" && reason === "damaged" && this.chance("bad-enum", 0.12)) sentReason = "broken";
    return { calls: [{ name: "issue_refund", args: { order_id: orderId, amount, reason: sentReason } }] };
  }
}
