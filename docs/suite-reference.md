# Suite reference

A **suite** is a sealed world for your agent: the tools it may call (with mocks, state and chaos) and the
**scenarios** it must survive (a simulated user plus pass/fail **criteria**). Suites are YAML or JSON and are
validated by the same schema in the CLI, the API and the editor.

```yaml
name: Acme Support — Refunds & Orders      # required
description: What this suite proves.        # optional
initialState: { refunds: {} }               # world state every scenario starts from
tools: [...]                                # see below
scenarios: [...]                            # see below
```

## Tools

```yaml
tools:
  - name: issue_refund                      # [a-zA-Z0-9_-]{1,64}
    description: Issue a refund to the original payment method.
    parameters:                             # JSON Schema for the arguments
      type: object
      properties:
        order_id: { type: string, pattern: "^[A-Z]\\d{3}$" }
        amount:   { type: number, minimum: 0.01 }
        reason:   { type: string, enum: [damaged, wrong_item, other] }
      required: [order_id, amount, reason]
      additionalProperties: false
    mocks:                                  # first matching mock answers
      - whenState: { "refunds.{{args.order_id}}": { $exists: true } }
        error: "Order {{args.order_id}} was already refunded"
      - when: { amount: { $gt: 1000 } }
        error: "Amount exceeds limit"
      - return: { refund_id: "RF-{{args.order_id}}", amount: "{{args.amount}}" }
        set: { "refunds.{{args.order_id}}": "{{args.amount}}" }
    chaos: { latencyMs: [120, 420] }        # optional, see Chaos
```

What the sandbox does with every call, in order:

1. **Unknown tool** → error result, counted as a *hallucinated tool*.
2. **Schema validation** → `Invalid arguments` result with readable errors (`amount: expected number, got string`), counted as an *invalid call*.
3. **Chaos** → timeout / transient error / (after a successful mock) a truncated payload.
4. **Mocks** → first mock whose `when` (args) and `whenState` (world state) match. `return` values and `set` keys/values are templates.
5. No mock matched → `{ "ok": true }`.

### Templates

`{{args.x}}` and `{{state.a.b}}` are substituted in `return`, `error`, `set` keys and values, and `whenState` keys.
A string that is *exactly* one template keeps the referenced value's type, so `"{{args.amount}}"` stays a number.

### Matchers

Usable in `when`, `whenState`, `tool_called.args` and `state_equals.value`:

| Matcher | Matches |
|---|---|
| literal | deep equality |
| `{ $regex: "pass(word)?" }` | case-insensitive regex on strings |
| `{ $gt: 10 }` / `{ $lt: 10 }` | numbers |
| `{ $oneOf: [a, b] }` | any listed value |
| `{ $exists: true \| false }` | presence |
| `{ $any: true }` | anything |

## Scenarios

```yaml
scenarios:
  - id: refund-eligible                     # slug, unique in the suite
    title: Eligible refund
    description: optional
    tags: [happy-path, refunds]
    persona: { name: Dana, traits: [polite], goal: "refund damaged order A100" }
    user:
      mode: scripted                        # scripted | llm
      turns: ["My order A100 arrived broken, refund please."]
    maxTurns: 6                             # user↔agent exchanges (default 6)
    initialState: { ... }                   # merged over the suite's initialState
    chaos: { issue_refund: { errorRate: 1 }, "*": { latencyMs: [500, 900] } }
    criteria: [...]
```

**Users.** `scripted` sends `turns` in order and ends when they run out. `llm` has Claude role-play the persona
(name, traits, goal) — the first scripted turn, if present, is the opener; the simulator ends the conversation
when its goal is met. Without `ANTHROPIC_API_KEY`, `llm` users fall back to their scripted turns.

**The agent loop.** After each user message the agent may make tool calls; the lab executes them and calls the
agent again until it replies without tools (capped at 8 iterations per turn).

## Criteria

Every criterion accepts `label`, `weight` (default 1) and `critical` (default `true`). A trial **passes** when every
critical, non-skipped criterion passes; its **score** is the weighted share of passed criteria.

| type | fields | passes when |
|---|---|---|
| `tool_called` | `tool`, `args?`, `min?` (1), `max?` | the tool was called with matching args at least `min` and at most `max` times. `min: 0, max: 0` = "never with these args". |
| `tool_not_called` | `tool` | never called |
| `tool_order` | `sequence` | the tools occur in order and no step's first call precedes its prerequisite |
| `valid_tool_calls` | — | no schema-invalid and no hallucinated calls |
| `response_contains` | `text`, `scope?` (`any`/`final`), `caseSensitive?` | an agent reply contains the text |
| `response_not_contains` | `text`, `caseSensitive?` | no agent reply contains it |
| `response_matches` | `pattern`, `scope?` | a reply matches the regex (case-insensitive) |
| `state_equals` | `path`, `value` | world state at the dot path matches |
| `no_pii_leak` | `allow?` | no emails, card numbers, SSNs or phone numbers in agent replies |
| `honest_about_failures` | — | the agent never claims success right after a tool failed without a later successful retry |
| `max_turns` · `max_tool_calls` | `value` | efficiency budgets |
| `max_latency_ms` · `max_cost_usd` | `value` | agent latency / estimated cost per trial |
| `llm_judge` | `rubric`, `threshold?` (0.7) | Claude grades the transcript (structured output); skipped without an API key |

## Chaos

```yaml
chaos: { errorRate: 0.15, timeoutRate: 0.05, malformedRate: 0.05, latencyMs: [80, 900] }
```

Layers merge in this order (later wins): run-level `--chaos` / experiment designer → `tools[].chaos` →
`scenarios[].chaos["*"]` → `scenarios[].chaos[tool]`. Every draw comes from the trial's seeded RNG, so a trial is
reproducible from `(seed, scenario, trial index)`.
