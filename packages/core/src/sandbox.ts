import type { InvalidCallInfo, ToolCall, ToolChaos, ToolSpec } from "./types.ts";
import { clone, matchObject, getPath, renderTemplate, setPath, validateSchema } from "./util.ts";

export interface ToolExecution {
  ok: boolean;
  output: string;
  /** Simulated latency of the tool in ms. */
  latencyMs: number;
  fault?: "error" | "timeout" | "malformed";
  invalid?: InvalidCallInfo;
}

/**
 * The tool sandbox stands in for every real tool the agent can call. It validates arguments
 * against the declared schema, injects chaos (errors, timeouts, malformed payloads, latency),
 * answers from declarative mocks and keeps a mutable "world state" that criteria can inspect.
 */
export class ToolSandbox {
  readonly state: Record<string, unknown>;
  private readonly tools: Map<string, ToolSpec>;

  constructor(
    tools: ToolSpec[],
    initialState: Record<string, unknown>,
    private readonly rng: () => number,
    private readonly chaosFor: (tool: string) => ToolChaos | undefined,
  ) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
    this.state = clone(initialState) ?? {};
  }

  execute(call: ToolCall): ToolExecution {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        ok: false,
        output: JSON.stringify({ error: `Unknown tool "${call.name}"` }),
        latencyMs: 0,
        invalid: { tool: call.name, errors: [`tool "${call.name}" does not exist`], unknownTool: true },
      };
    }

    const errors = validateSchema(call.args ?? {}, tool.parameters);
    if (errors.length) {
      return {
        ok: false,
        output: JSON.stringify({ error: "Invalid arguments", details: errors }),
        latencyMs: 5,
        invalid: { tool: call.name, errors },
      };
    }

    const chaos = this.chaosFor(call.name) ?? {};
    const [lo, hi] = chaos.latencyMs ?? [20, 120];
    const latencyMs = Math.round(lo + this.rng() * Math.max(0, hi - lo));

    // Draw every chaos roll up-front so the random stream doesn't depend on which fault fires.
    const rTimeout = this.rng();
    const rError = this.rng();
    const rMalformed = this.rng();
    if (chaos.timeoutRate && rTimeout < chaos.timeoutRate) {
      return { ok: false, output: JSON.stringify({ error: "Request timed out after 30000ms" }), latencyMs: 30000, fault: "timeout" };
    }
    if (chaos.errorRate && rError < chaos.errorRate) {
      return { ok: false, output: JSON.stringify({ error: "503 Service Unavailable — upstream dependency failed" }), latencyMs, fault: "error" };
    }

    const ctx = { args: call.args ?? {}, state: this.state };
    const mock = (tool.mocks ?? []).find(
      (m) =>
        matchObject(call.args, m.when) &&
        matchObject(
          this.state,
          m.whenState && Object.fromEntries(Object.entries(m.whenState).map(([k, v]) => [renderTemplate(k, ctx) as string, v])),
          getPath,
        ),
    );

    let ok = true;
    let output: string;
    if (!mock) {
      output = JSON.stringify({ ok: true });
    } else if (mock.error) {
      ok = false;
      output = JSON.stringify({ error: renderTemplate(mock.error, ctx) });
    } else {
      const value = renderTemplate(mock.return ?? { ok: true }, ctx);
      output = typeof value === "string" ? value : JSON.stringify(value);
    }
    if (mock?.set) {
      for (const [path, v] of Object.entries(mock.set)) setPath(this.state, renderTemplate(path, ctx) as string, renderTemplate(v, ctx));
    }

    if (ok && chaos.malformedRate && rMalformed < chaos.malformedRate) {
      return { ok: true, output: output.slice(0, Math.max(3, Math.floor(output.length / 2))), latencyMs, fault: "malformed" };
    }
    return { ok, output, latencyMs };
  }
}
