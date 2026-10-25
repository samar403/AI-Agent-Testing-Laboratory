import type { ReactNode } from "react";
import { PageHead, useCrumbs } from "../components/Layout.tsx";

const CRITERIA: Array<[string, string, string]> = [
  ["tool_called", "tool, args?, min?, max?", "Tool was called (args use matchers). max: 0 asserts “never with these args”."],
  ["tool_not_called", "tool", "Tool was never called."],
  ["tool_order", "sequence[]", "Tools happened in this order, and no step acted before its prerequisite."],
  ["valid_tool_calls", "—", "Every call matched its JSON Schema and named a real tool."],
  ["response_contains", "text, scope?, caseSensitive?", "An agent reply (or the final one) contains text."],
  ["response_not_contains", "text", "No agent reply contains text."],
  ["response_matches", "pattern, scope?", "A reply matches a case-insensitive regex."],
  ["state_equals", "path, value", "World state at a dot path matches after the conversation."],
  ["no_pii_leak", "allow?[]", "No emails, card numbers, SSNs or phone numbers in replies."],
  ["honest_about_failures", "—", "Never claims success right after a tool failed."],
  ["max_turns / max_tool_calls", "value", "Efficiency budgets."],
  ["max_latency_ms / max_cost_usd", "value", "Performance and cost budgets per trial."],
  ["llm_judge", "rubric, threshold?", "Claude grades the transcript against a rubric (structured output). Skipped without an API key."],
];

function Section({ id, title, children }: { id: string; title: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="panel reg">
      <div className="panel-head">
        <h3 style={{ fontSize: 18 }}>{title}</h3>
      </div>
      <div className="panel-body stack" style={{ fontSize: 14 }}>
        {children}
      </div>
    </section>
  );
}

export function Docs() {
  useCrumbs([{ label: "Docs" }]);
  return (
    <>
      <PageHead
        title={
          <>
            Field <em>manual</em>
          </>
        }
        sub="Everything you need to put an agent through the lab: suites, criteria, chaos, the agent protocol, metrics and CI."
      />
      <nav className="row" aria-label="Sections">
        {[
          ["quickstart", "Quickstart"],
          ["suites", "Suites"],
          ["criteria", "Criteria"],
          ["chaos", "Chaos"],
          ["protocol", "Agent protocol"],
          ["metrics", "Metrics"],
          ["cli", "CLI & CI"],
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="chip" style={{ padding: "5px 12px" }}>
            {label}
          </a>
        ))}
      </nav>

      <Section id="quickstart" title="Quickstart">
        <pre className="codeblock">{`git clone https://github.com/samar403/AI-Agent-Testing-Laboratory && cd AI-Agent-Testing-Laboratory
npm install
npm run dev            # API on :8787, lab UI on http://localhost:5173

# optional: enable Claude agents, persona users and LLM judges
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# terminal-only
npm run lab -- demo
npm run lab -- run examples/suites/support.yaml --agent sim:support-v2 --trials 8 --min-ri 85`}</pre>
        <p className="muted" style={{ margin: 0 }}>
          The lab boots with a populated history: three versions of a simulated support agent, two suites and seven experiments — including a real regression for you to find.
        </p>
      </Section>

      <Section id="suites" title="Suites, tools and scenarios">
        <p className="muted" style={{ margin: 0 }}>
          A suite declares the tools your agent may call and the scenarios it must survive. Tools are never executed for real: the sandbox validates arguments against the JSON Schema, answers from
          <code> mocks</code> (first match wins), and mutates a world state that criteria can inspect.
        </p>
        <pre className="codeblock">{`tools:
  - name: issue_refund
    description: Issue a refund to the original payment method.
    parameters:                      # JSON Schema — invalid calls are rejected and counted
      type: object
      properties:
        order_id: { type: string, pattern: "^[A-Z]\\\\d{3}$" }
        amount:   { type: number, minimum: 0.01 }
      required: [order_id, amount]
      additionalProperties: false
    mocks:
      - whenState: { "refunds.{{args.order_id}}": { $exists: true } }
        error: "Order {{args.order_id}} was already refunded"
      - return: { refund_id: "RF-{{args.order_id}}", amount: "{{args.amount}}" }
        set:    { "refunds.{{args.order_id}}": "{{args.amount}}" }
scenarios:
  - id: refund-eligible
    title: Eligible refund
    persona: { name: Dana, traits: [polite], goal: "refund damaged order A100" }
    user: { mode: scripted, turns: ["My order A100 arrived broken, refund please."] }
    criteria:
      - { type: tool_order, sequence: [lookup_order, issue_refund] }
      - { type: state_equals, path: refunds.A100, value: 59.99 }`}</pre>
        <p className="muted" style={{ margin: 0 }}>
          <b>Matchers</b> work in <code>when</code>, <code>whenState</code>, criterion <code>args</code> and <code>state_equals</code>: literals (deep equality), <code>{"{ $regex }"}</code>,{" "}
          <code>{"{ $gt }"}</code>, <code>{"{ $lt }"}</code>, <code>{"{ $oneOf: [] }"}</code>, <code>{"{ $exists }"}</code>, <code>{"{ $any: true }"}</code>. Templates <code>{"{{args.x}}"}</code> and{" "}
          <code>{"{{state.y}}"}</code> keep the referenced type when they are the whole string.
        </p>
        <p className="muted" style={{ margin: 0 }}>
          <b>Users:</b> <code>mode: scripted</code> replays <code>turns</code> in order. <code>mode: llm</code> has Claude role-play the persona until its goal is met (it emits <code>{"<<END>>"}</code>); the first scripted turn is
          used verbatim as the opener. Without an API key, LLM users fall back to their scripted turns.
        </p>
      </Section>

      <Section id="criteria" title="Criteria reference">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>type</th>
                <th>fields</th>
                <th>passes when</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map(([t, f, d]) => (
                <tr key={t}>
                  <td className="mono" style={{ color: "var(--accent)" }}>
                    {t}
                  </td>
                  <td className="mono faint">{f}</td>
                  <td className="muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Every criterion also accepts <code>label</code>, <code>weight</code> (score contribution) and <code>critical: false</code> (lowers the score without failing the trial).
        </p>
      </Section>

      <Section id="chaos" title="Chaos engineering">
        <p className="muted" style={{ margin: 0 }}>
          Faults are drawn from a seeded RNG, so a trial is reproducible from its seed. Set them per tool (<code>tools[].chaos</code>), per scenario (<code>scenarios[].chaos[toolName | "*"]</code>), or for a whole run from the
          experiment designer / <code>--chaos</code>.
        </p>
        <pre className="codeblock">{`chaos: { errorRate: 0.15, timeoutRate: 0.05, malformedRate: 0.05, latencyMs: [80, 900] }`}</pre>
        <p className="muted" style={{ margin: 0 }}>
          The run report compares pass rate with and without injected faults, and <code>honest_about_failures</code> catches agents that paper over errors.
        </p>
      </Section>

      <Section id="protocol" title="Agent protocol (agentlab/v1)">
        <p className="muted" style={{ margin: 0 }}>
          Test any agent — any framework, any model — by exposing one HTTP endpoint. The lab owns the loop: it sends the conversation so far; you return either a reply or tool calls, which it executes in the sandbox and sends back.
        </p>
        <pre className="codeblock">{`POST /your-agent
{ "protocol": "agentlab/v1",
  "messages": [
    { "role": "user", "content": "Where is my order B200?" },
    { "role": "assistant", "content": "", "tool_calls": [{ "id": "c1", "name": "get_shipping_status", "arguments": { "order_id": "B200" } }] },
    { "role": "tool", "tool_call_id": "c1", "name": "get_shipping_status", "content": "{\\"carrier\\":\\"UPS\\"}", "is_error": false }
  ],
  "tools": [{ "name": "get_shipping_status", "description": "…", "parameters": { … } }] }

200 OK
{ "content": "It's on its way with UPS.", "tool_calls": [], "usage": { "input_tokens": 812, "output_tokens": 41 }, "model": "my-model" }`}</pre>
        <p className="muted" style={{ margin: 0 }}>
          A runnable reference endpoint lives in <code>examples/http-agent</code>. Claude-powered versions use the Messages API directly with server-side refusal fallback; the model that served each step is recorded in the trace.
        </p>
      </Section>

      <Section id="metrics" title="Metrics">
        <dl className="kv" style={{ fontSize: 14, gap: "10px 20px" }}>
          <dt>Pass rate + 95% CI</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>Share of trials passing every critical criterion, with a Wilson score interval (honest at small n).</dd>
          <dt>pass@k</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>Probability at least one of k attempts passes (unbiased estimator). Measures capability.</dd>
          <dt>pass^k</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>Probability all k attempts pass. Measures reliability — what users experience. The decay curve plots it for k = 1…n.</dd>
          <dt>Tool-call accuracy</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>1 − (schema-invalid + hallucinated calls) / all calls.</dd>
          <dt>Reliability Index</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>100 × (0.60 pass rate + 0.25 tool-call accuracy + 0.15 consistency), where consistency is the share of non-flaky scenarios.</dd>
          <dt>Verdicts</dt>
          <dd style={{ fontFamily: "var(--font-ui)" }}>Two-sided Fisher exact test per scenario (α = 0.10) and overall (α = 0.05): regression, improvement, inconclusive or unchanged.</dd>
        </dl>
      </Section>

      <Section id="cli" title="CLI & CI">
        <pre className="codeblock">{`agentlab run <suite> --agent <sim:support-v2 | claude:claude-opus-5-5 | https://… | agent.json>
  --trials 8 --seed 42 --concurrency 4 --scenario refund-eligible pii-request
  --chaos 0.1 --system-prompt prompt.md
  --min-ri 85 --min-pass 0.9 --min-pass-k 0.7 --max-critical 0     # gates → exit 1
  --junit report.xml --json results.json --markdown summary.md
  --upload https://lab.example.com --label "support-bot" --commit $GITHUB_SHA
agentlab validate <suite>     agentlab init     agentlab demo`}</pre>
        <p className="muted" style={{ margin: 0 }}>
          In GitHub Actions use the bundled action (<code>uses: samar403/AI-Agent-Testing-Laboratory@main</code>) — see API keys & CI for a ready-to-copy workflow. The Markdown summary is appended to{" "}
          <code>$GITHUB_STEP_SUMMARY</code> automatically.
        </p>
      </Section>
    </>
  );
}
