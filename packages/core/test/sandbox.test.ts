import { describe, expect, it } from "vitest";
import { SUPPORT_TOOLS } from "../src/demo.ts";
import { ToolSandbox } from "../src/sandbox.ts";
import { createRng, validateSchema, renderTemplate, matchValue } from "../src/util.ts";

const sandbox = (chaos?: object) => new ToolSandbox(SUPPORT_TOOLS, { refunds: {} }, createRng(1), () => chaos);

describe("tool sandbox", () => {
  it("answers from matching mocks and mutates world state", () => {
    const sb = sandbox();
    const order = sb.execute({ id: "1", name: "lookup_order", args: { order_id: "A100" } });
    expect(order.ok).toBe(true);
    expect(JSON.parse(order.output).total).toBe(59.99);
    const refund = sb.execute({ id: "2", name: "issue_refund", args: { order_id: "A100", amount: 59.99, reason: "damaged" } });
    expect(refund.ok).toBe(true);
    expect(sb.state).toMatchObject({ refunds: { A100: 59.99 } });
    const again = sb.execute({ id: "3", name: "issue_refund", args: { order_id: "A100", amount: 59.99, reason: "damaged" } });
    expect(again.ok).toBe(false);
    expect(again.output).toContain("already refunded");
  });

  it("rejects schema-invalid arguments with readable errors", () => {
    const res = sandbox().execute({ id: "1", name: "issue_refund", args: { order_id: "A100", amount: "59.99", reason: "broken" } });
    expect(res.ok).toBe(false);
    expect(res.invalid?.errors).toEqual(["amount: expected number, got string", "reason: must be one of \"damaged\", \"wrong_item\", \"not_received\", \"changed_mind\", \"other\""]);
  });

  it("flags hallucinated tools", () => {
    const res = sandbox().execute({ id: "1", name: "track_package", args: {} });
    expect(res.invalid?.unknownTool).toBe(true);
  });

  it("injects chaos faults deterministically", () => {
    const res = sandbox({ errorRate: 1 }).execute({ id: "1", name: "lookup_order", args: { order_id: "A100" } });
    expect(res.fault).toBe("error");
    const t = sandbox({ timeoutRate: 1 }).execute({ id: "1", name: "lookup_order", args: { order_id: "A100" } });
    expect(t.fault).toBe("timeout");
  });

  it("validates nested schemas and templates", () => {
    expect(validateSchema({ a: [1, "x"] }, { type: "object", properties: { a: { type: "array", items: { type: "number" } } } })).toEqual(["a[1]: expected number, got string"]);
    expect(renderTemplate({ id: "RF-{{args.id}}", n: "{{args.n}}" }, { args: { id: "A1", n: 3 } })).toEqual({ id: "RF-A1", n: 3 });
    expect(matchValue(5, { $gt: 3 })).toBe(true);
    expect(matchValue("Hello", { $regex: "^hel" })).toBe(true);
    expect(matchValue(undefined, { $exists: false })).toBe(true);
  });
});
