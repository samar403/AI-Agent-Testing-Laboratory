# AgentLab — the idea

> **Break your agent before your users do.**
> AgentLab is a testing laboratory where developers put AI agents through thousands of simulated conversations,
> inject tool failures, catch incorrect tool calls, measure reliability with real statistics, and compare
> versions before they deploy.

## The problem

Teams are shipping agents that *act*: they issue refunds, book travel, change records, send messages. Today most
of those agents are validated with a handful of manual chats and a few prompt-level evals. That misses what
actually breaks in production:

- **Non-determinism.** The same prompt succeeds 9 times and fails the 10th. A single passing demo says nothing
  about the 10th user.
- **Incorrect tool calls.** Wrong argument types, invalid enum values, invented tools, acting before verifying,
  calling the right tool with the wrong order ID. These are silent until money moves.
- **Unreliable dependencies.** Real tools time out and return 5xx errors. Agents often paper over the failure
  and tell the user it worked.
- **Adversarial and messy users.** Prompt injection, social engineering for personal data, impatient or confused
  people who don't follow the happy path.
- **Regressions between versions.** A prompt tweak that cuts latency quietly removes a safety check. Without
  repeated trials and a significance test, nobody can tell a real regression from noise.

## The product

| Capability | What it does |
|---|---|
| **Simulated users** | Scripted turns for determinism, or Claude role-playing personas (impatient, confused, manipulative, adversarial). |
| **Tool sandbox** | Every tool is declared with JSON Schema and mocked. Calls are validated, answered from mocks, and mutate a world state. |
| **Chaos injection** | Seeded tool errors, timeouts, malformed payloads and latency, per tool, per scenario or per run. |
| **15 criteria types** | Tool usage and ordering, schema validity, world state, response content, PII leaks, honesty about failures, budgets, LLM-as-judge. |
| **Reliability statistics** | pass@k, **pass^k**, Wilson confidence intervals, tool-call accuracy and a single Reliability Index. |
| **Version comparison** | Per-scenario Fisher exact tests: *regression*, *improvement*, *inconclusive* — and a ship / don't-ship verdict. |
| **Forensics** | The microplate view (every trial is a well), an oscilloscope trace for each conversation, and an auto-written lab notebook of findings. |
| **CI gates** | `agentlab run … --min-ri 85 --min-pass-k 0.7` fails the build, writes JUnit and a job summary, and uploads results. |
| **Any agent** | Native Claude support, or any framework/model through one HTTP endpoint (agentlab/v1). |

## Customers

1. **AI startups shipping agents to customers** (support, sales, ops, fintech, travel). Pain: one bad action is a
   churned customer or a refund they can't claw back. Buyer: CTO / founding engineer.
2. **Product teams inside software companies** adding agentic features. Pain: release confidence and a way to
   prove to security/compliance that the agent was tested. Buyer: engineering manager, AI platform lead.
3. **Agent platform and framework builders** who need a neutral benchmark for their customers' agents.

## Business model — usage-based + subscription

The unit of value is a **trial**: one simulated conversation, start to finish. It maps directly to the work done
and to the confidence a team gets.

| Plan | Price | Included | Overage | For |
|---|---|---|---|---|
| Bench | $0 | 1,000 trials / mo | hard cap | individuals, evaluation, open-source projects |
| Lab | $49 / mo | 20,000 trials / mo | $0.002 / trial | startups running suites in CI on every PR |
| Institute | $399 / mo | 250,000 trials / mo | $0.0012 / trial | teams with many agents, SSO, private runners |
| Enterprise | custom | committed volume | — | VPC deployment, audit, support SLAs |

- **Model costs are pass-through.** Claude-powered agents, persona users and judges run on the customer's own
  Anthropic key, so gross margin on the platform fee stays high and pricing stays honest.
- **Expansion is built in.** More agents × more scenarios × more trials per PR × more PRs. CI adoption turns a
  one-off evaluation into a recurring meter.

## Go-to-market

1. **Open core.** The engine, CLI and GitHub Action are free to self-host — developers adopt them bottom-up.
2. **The hosted lab** is the upgrade: history, comparisons, shared dashboards, persona simulations, retention.
3. **Scenario packs.** Curated, vertical suites (support refunds, payments, booking, healthcare intake) that teams
   can run on day one; community-contributed packs grow the library.
4. **Design partners → case studies.** “We caught a refund-policy regression before release” is the story.

## Why we win

- **Reliability, not just quality scores.** pass^k and significance testing answer the question operators ask:
  *will it work every time, and is the new version actually better?*
- **Tool-call forensics are first-class**, not an afterthought of LLM-output grading.
- **Framework-agnostic** through a one-endpoint protocol, with native Claude support.
- **Compounding data.** Scenario libraries and failure patterns across many agents become a benchmark nobody
  else has.

## Metrics we track

Weekly trials run (north star), active CI-integrated agents, % of runs that catch at least one critical finding,
free → paid conversion, net revenue retention via trial expansion.

## Roadmap

- Record-and-replay: turn production transcripts into scenarios automatically.
- Scenario generation: Claude proposes adversarial scenarios from a tool list and policy.
- Multi-agent and long-horizon tasks; voice agents.
- Hosted multi-tenant workspaces with SSO and audit log; Stripe metered billing.
- Benchmarks: public reliability leaderboards per vertical.
