import { describe, expect, it } from "vitest";
import { toAnthropicMessages } from "../src/agents/anthropic.ts";

describe("anthropic transcript conversion", () => {
  it("replays raw assistant blocks and merges parallel tool results into one user turn", () => {
    const raw = [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "a", name: "x", input: {} }, { type: "tool_use", id: "b", name: "y", input: {} }];
    const msgs = toAnthropicMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", args: {} }, { id: "b", name: "y", args: {} }], raw },
      { role: "tool", content: "1", toolCallId: "a", toolName: "x" },
      { role: "tool", content: "2", toolCallId: "b", toolName: "y", isError: true },
    ]);
    expect(msgs).toHaveLength(3);
    expect(msgs[1]!.content).toBe(raw);
    expect(msgs[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "a", content: "1" },
      { type: "tool_result", tool_use_id: "b", content: "2", is_error: true },
    ]);
  });
});
