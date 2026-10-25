import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PLANS } from "@agentlab/core/browser";
import type { Cell } from "../api.ts";
import { BrandMark, Icon } from "../components/Icon.tsx";
import { Microplate, PlateLegend } from "../components/Microplate.tsx";
import { int, useTheme } from "../lib.tsx";

const DEMO_SCENARIOS = [
  { id: "a", title: "Eligible refund" },
  { id: "b", title: "Ineligible refund" },
  { id: "c", title: "Shipping status" },
  { id: "d", title: "Prompt injection" },
  { id: "e", title: "PII exfiltration" },
  { id: "f", title: "Refund API outage" },
  { id: "g", title: "Multi-turn refund" },
  { id: "h", title: "Unknown order" },
];
// Pass probability per row for the hero animation: a plausible "v1" agent.
const ODDS = [0.55, 0.6, 0.9, 0.3, 0.15, 0.05, 0.7, 0.6];

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function HeroPlate() {
  const cells = useMemo(() => {
    const r = rng(7);
    return DEMO_SCENARIOS.flatMap((s, row) =>
      Array.from({ length: 12 }, (_, i): Cell => {
        const passed = r() < ODDS[row]!;
        return { id: `${s.id}${i}`, scenarioId: s.id, trialIndex: i, passed, score: passed ? 1 : r() < 0.4 ? 0.66 : 0.25, metrics: { latencyMs: 0, agentLatencyMs: 600 + r() * 2400, turns: 1, toolCalls: 2, invalidToolCalls: 0, unknownToolCalls: 0, faultsInjected: row === 5 ? 1 : 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } };
      }),
    );
  }, []);
  const order = useMemo(() => {
    const r = rng(3);
    return [...cells].sort(() => r() - 0.5);
  }, [cells]);
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= order.length + 30 ? 0 : x + 1)), 55);
    return () => clearInterval(t);
  }, [order.length]);
  const shown = order.slice(0, Math.min(n, order.length));
  const pass = shown.filter((c) => c.passed).length;
  return (
    <div className="panel reg" style={{ padding: 18 }}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="label">Experiment · Acme Support v1 × 8 scenarios × 12 trials</span>
        <span className="spacer" />
        <span className="num" style={{ fontSize: 12, color: "var(--ink-2)" }}>
          {shown.length}/96 · {shown.length ? Math.round((pass / shown.length) * 100) : 0}% pass
        </span>
      </div>
      <Microplate scenarios={DEMO_SCENARIOS} trials={12} cells={shown} running={n < order.length} wellSize={23} />
      <div style={{ marginTop: 12 }}>
        <PlateLegend />
      </div>
    </div>
  );
}

const STEPS = [
  { n: "01", t: "Describe the world", d: "Declare your agent's tools as JSON Schema, mock their responses, and give the sandbox a world state it can mutate." },
  { n: "02", t: "Simulate the users", d: "Scripted turns for determinism, or Claude role-playing personas — impatient, confused, manipulative, adversarial." },
  { n: "03", t: "Inject chaos", d: "Dial in tool errors, timeouts, malformed payloads and latency. Watch whether your agent recovers or lies about it." },
  { n: "04", t: "Measure & gate", d: "Run every scenario k times. Get pass^k, Wilson intervals, tool-call accuracy and a Reliability Index you can gate CI on." },
];

const FEATURES = [
  { i: "tool", t: "Tool-call forensics", d: "Every call is schema-validated. Wrong types, bad enums, hallucinated tools and out-of-order actions are caught and counted." },
  { i: "plate", t: "Microplate reliability view", d: "Each trial is a well. A flaky scenario looks speckled; a systematic bug is a red row. You see reliability, not an average." },
  { i: "compare", t: "Version comparison with stats", d: "Fisher exact tests per scenario tell you whether v3 is really worse than v2 — or just noise — before you ship it." },
  { i: "shield", t: "Safety & privacy probes", d: "Prompt injection, PII exfiltration and policy-violation scenarios with criteria that fail loudly when the agent complies." },
  { i: "pulse", t: "Oscilloscope traces", d: "Replay any trial on a shared time axis: user turns, agent steps, tool calls and injected faults, down to the arguments." },
  { i: "ci", t: "CI gates in one line", d: "agentlab run suite.yaml --min-ri 85 exits non-zero, writes JUnit and a job summary, and uploads results to your lab." },
];

export function Landing() {
  const { theme, toggle } = useTheme();
  return (
    <div className="landing">
      <nav className="l-nav" aria-label="Site">
        <Link to="/" className="row" style={{ gap: 10 }}>
          <BrandMark />
          <span className="brand-name">
            Agent<i style={{ color: "var(--accent)" }}>Lab</i>
          </span>
        </Link>
        <a className="link hide-sm" href="#how">How it works</a>
        <a className="link hide-sm" href="#features">Features</a>
        <a className="link hide-sm" href="#pricing">Pricing</a>
        <Link className="link hide-sm" to="/docs">Docs</Link>
        <span className="spacer" />
        <button className="btn icon ghost" onClick={toggle} aria-label="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <Link to="/lab" className="btn primary">
          Open the lab <Icon name="arrow" />
        </Link>
      </nav>

      <header className="hero">
        <div>
          <div className="badge-yc">
            <b>NEW</b> The crash-test lab for AI agents
          </div>
          <h1>
            Break your agent <em>before</em> your users do.
          </h1>
          <p className="lead">
            AgentLab simulates thousands of real conversations against your agent, injects tool failures, catches every incorrect tool call, and tells you —
            with statistics — whether the new version is safe to ship.
          </p>
          <div className="cta">
            <Link to="/lab" className="btn primary">
              <Icon name="play" /> Explore the live lab
            </Link>
            <Link to="/docs" className="btn">
              <Icon name="code" /> Quickstart
            </Link>
          </div>
          <div className="row faint" style={{ marginTop: 22, fontSize: 13, gap: 18 }}>
            <span className="row" style={{ gap: 6 }}><Icon name="check" /> Works with any agent over HTTP</span>
            <span className="row" style={{ gap: 6 }}><Icon name="check" /> Native Claude support</span>
            <span className="row" style={{ gap: 6 }}><Icon name="check" /> No API key needed to try</span>
          </div>
        </div>
        <HeroPlate />
      </header>

      <section className="section" id="how">
        <div className="label">Protocol</div>
        <h2 style={{ marginTop: 10 }}>
          An experiment, <em>not</em> a vibe check.
        </h2>
        <p className="sub">One demo conversation that works proves nothing. Agents are stochastic, tools fail, and users are creative. AgentLab runs the same scenario many times under controlled conditions and measures the spread.</p>
        <div className="steps">
          {STEPS.map((s) => (
            <div key={s.n} className="panel reg step">
              <div className="n">{s.n}</div>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="features">
        <div className="label">Instruments</div>
        <h2 style={{ marginTop: 10 }}>
          Everything you need to trust an <em>autonomous</em> system.
        </h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.t} className="panel feature">
              <div className="fi">
                <Icon name={f.i} size={18} />
              </div>
              <h4>{f.t}</h4>
              <p>{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="grid g-2" style={{ alignItems: "center", gap: 40 }}>
          <div>
            <div className="label">In your pipeline</div>
            <h2 style={{ marginTop: 10 }}>
              Gate every deploy on <em>pass^k</em>.
            </h2>
            <p className="sub">
              pass@k asks “can the agent ever do this?”. pass^k asks “will it do it every time?” — the question your users actually care about. AgentLab reports both, and fails the build when reliability regresses.
            </p>
          </div>
          <pre className="codeblock">
            <span className="c"># .github/workflows/agent.yml</span>
            {"\n"}- run: agentlab run suites/support.yaml \{"\n"}
            {"    "}--agent <span className="s">https://staging.acme.dev/agent</span> \{"\n"}
            {"    "}--trials <span className="k">8</span> --chaos <span className="k">0.1</span> \{"\n"}
            {"    "}--min-ri <span className="k">85</span> --min-pass-k <span className="k">0.7</span> \{"\n"}
            {"    "}--junit agentlab.xml --upload <span className="s">$AGENTLAB_URL</span>
            {"\n\n"}
            <span className="c">  A  ● ● ● ● ● ● ● ●   100%  Eligible refund</span>
            {"\n"}
            <span className="c">  D  ● ● ● ● ● ● ● ●   100%  Prompt injection</span>
            {"\n"}
            <span className="c">  G  ● ● ● ◐ ● ● ● ●  87.5%  Multi-turn refund ~flaky</span>
            {"\n\n"}  Reliability Index <span className="s">93</span>/100 · <span className="s">✔ all gates passed</span>
          </pre>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="label">Pricing</div>
        <h2 style={{ marginTop: 10 }}>
          Pay for <em>trials</em>, not seats.
        </h2>
        <p className="sub">A trial is one simulated conversation, start to finish. Model tokens for Claude-powered agents, simulated users and judges are billed by your own Anthropic account at cost.</p>
        <div className="price-grid">
          {PLANS.map((p) => (
            <div key={p.id} className={`panel reg price ${p.id === "lab" ? "hot" : ""}`}>
              <div className="row">
                <h3 style={{ fontSize: 18 }}>{p.name}</h3>
                {p.id === "lab" && <span className="chip accent">most teams</span>}
              </div>
              <div className="amt">
                ${p.price}
                <small> / month</small>
              </div>
              <div className="muted" style={{ fontSize: 13.5 }}>
                {int(p.includedTrials)} trials included{p.overagePerTrial ? ` · then $${p.overagePerTrial}/trial` : " · hard cap"}
              </div>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link to="/lab" className={`btn ${p.id === "lab" ? "primary" : ""}`}>
                {p.price === 0 ? "Start free" : "Start 14-day trial"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>© {new Date().getFullYear()} AgentLab</span>
        <span className="spacer" />
        <Link to="/docs">Docs</Link>
        <a href="https://github.com/samar403/AI-Agent-Testing-Laboratory">GitHub</a>
        <Link to="/lab">Open the lab</Link>
      </footer>
    </div>
  );
}
