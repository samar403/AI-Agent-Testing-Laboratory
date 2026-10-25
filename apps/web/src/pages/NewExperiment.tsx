import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { post, type Agent, type LightRun, type SuiteListItem, type Usage } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs, useHealth } from "../components/Layout.tsx";
import { int, pct, useApi, useToast } from "../lib.tsx";

const PRESETS = [
  { id: "smoke", name: "Smoke", d: "3 trials, no chaos", trials: 3, error: 0, timeout: 0, malformed: 0 },
  { id: "standard", name: "Standard", d: "8 trials, no chaos", trials: 8, error: 0, timeout: 0, malformed: 0 },
  { id: "plate", name: "Full plate", d: "12 trials — a 96-well plate", trials: 12, error: 0, timeout: 0, malformed: 0 },
  { id: "stress", name: "Stress", d: "12 trials, 15% errors, 5% timeouts", trials: 12, error: 0.15, timeout: 0.05, malformed: 0.05 },
];

export function NewExperiment() {
  useCrumbs([{ to: "/lab/runs", label: "Experiments" }, { label: "New" }]);
  const nav = useNavigate();
  const toast = useToast();
  const health = useHealth();
  const [params] = useSearchParams();
  const { data: suites, error: e1 } = useApi<SuiteListItem[]>("/suites");
  const { data: agents, error: e2 } = useApi<Agent[]>("/agents");
  const { data: usage } = useApi<Usage>("/usage");

  const [suiteId, setSuiteId] = useState<string | null>(params.get("suite"));
  const [scenarioIds, setScenarioIds] = useState<string[]>([]);
  const [versionIds, setVersionIds] = useState<string[]>(params.get("version") ? [params.get("version")!] : []);
  const [preset, setPreset] = useState("standard");
  const [trials, setTrials] = useState(8);
  const [errorRate, setErrorRate] = useState(0);
  const [timeoutRate, setTimeoutRate] = useState(0);
  const [malformedRate, setMalformedRate] = useState(0);
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (suites?.length && !suiteId) setSuiteId(suites[0]!.id);
  }, [suites, suiteId]);
  useEffect(() => {
    if (agents && !versionIds.length) {
      const sims = agents.flatMap((a) => a.versions).filter((v) => v.config.kind === "mock");
      setVersionIds(sims.slice(-2).map((v) => v.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents]);

  const suite = suites?.find((s) => s.id === suiteId);
  const scenarioCount = scenarioIds.length || suite?.scenarioCount || 0;
  const total = scenarioCount * trials * versionIds.length;
  const versions = useMemo(() => agents?.flatMap((a) => a.versions.map((v) => ({ ...v, agentName: a.name }))) ?? [], [agents]);
  const remaining = usage ? usage.plan.includedTrials - usage.trials : Infinity;

  if (e1 || e2) return <ErrorNote error={(e1 ?? e2)!} />;
  if (!suites || !agents) return <Loading rows={3} />;

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setTrials(p.trials);
    setErrorRate(p.error);
    setTimeoutRate(p.timeout);
    setMalformedRate(p.malformed);
  }

  async function launch() {
    if (!suiteId || !versionIds.length) return;
    setBusy(true);
    try {
      const chaos = errorRate || timeoutRate || malformedRate ? { global: { errorRate, timeoutRate, malformedRate } } : undefined;
      const runs = await post<LightRun[]>("/runs", {
        suiteId,
        versionIds,
        options: { trials, chaos, seed: seed ? Number(seed) : undefined, scenarioIds: scenarioIds.length ? scenarioIds : undefined },
      });
      toast(`Started ${runs.length} run${runs.length > 1 ? "s" : ""} · ${int(total)} trials`);
      nav(`/lab/runs/${runs[0]!.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
      setBusy(false);
    }
  }

  const toggleVersion = (id: string) => setVersionIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : v.length >= 6 ? v : [...v, id]));
  const toggleScenario = (id: string) => setScenarioIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  return (
    <>
      <PageHead
        title={
          <>
            Design an <em>experiment</em>
          </>
        }
        sub="Pick a suite, one or more agent versions, and the conditions. Selecting several versions runs them on identical seeds so the comparison is apples to apples."
      />
      <div className="grid g-main">
        <div className="stack" style={{ gap: 18 }}>
          <section className="panel reg">
            <div className="panel-head">
              <span className="label">01</span>
              <h3>Suite</h3>
            </div>
            <div className="panel-body stack">
              {suites.map((s) => (
                <label key={s.id} className={`pick ${suiteId === s.id ? "on" : ""}`}>
                  <input type="radio" name="suite" checked={suiteId === s.id} onChange={() => (setSuiteId(s.id), setScenarioIds([]))} />
                  <div style={{ flex: 1 }}>
                    <div className="pt">{s.name}</div>
                    <div className="pd">
                      {s.scenarioCount} scenarios · {s.toolCount} tools · {s.criteriaCount} criteria
                    </div>
                  </div>
                </label>
              ))}
              {suite && (
                <details>
                  <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
                    Run a subset of scenarios ({scenarioIds.length || "all"})
                  </summary>
                  <div className="row" style={{ marginTop: 10 }}>
                    {suite.spec.scenarios.map((sc) => (
                      <button key={sc.id} className={`chip ${scenarioIds.includes(sc.id) ? "accent" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggleScenario(sc.id)}>
                        {sc.title}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>

          <section className="panel reg">
            <div className="panel-head">
              <span className="label">02</span>
              <h3>Specimens</h3>
              <span className="right faint" style={{ fontSize: 12 }}>
                {versionIds.length}/6 selected
              </span>
            </div>
            <div className="panel-body grid g-2">
              {versions.map((v) => {
                const needsKey = v.config.kind === "anthropic" && !health?.anthropic;
                return (
                  <label key={v.id} className={`pick ${versionIds.includes(v.id) ? "on" : ""}`} style={{ opacity: needsKey ? 0.55 : 1 }}>
                    <input type="checkbox" checked={versionIds.includes(v.id)} disabled={needsKey} onChange={() => toggleVersion(v.id)} />
                    <div style={{ minWidth: 0 }}>
                      <div className="pt">
                        {v.agentName} <span className="chip mono">{v.version}</span>
                      </div>
                      <div className="pd">
                        {v.config.kind === "mock" ? "simulated specimen" : v.config.kind === "anthropic" ? v.config.model : v.config.kind === "http" ? v.config.url : ""}
                        {needsKey && " · needs ANTHROPIC_API_KEY"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className="panel reg">
            <div className="panel-head">
              <span className="label">03</span>
              <h3>Conditions</h3>
            </div>
            <div className="panel-body stack" style={{ gap: 16 }}>
              <div className="seg" role="tablist" style={{ flexWrap: "wrap" }}>
                {PRESETS.map((p) => (
                  <button key={p.id} className={preset === p.id ? "on" : ""} onClick={() => applyPreset(p.id)} title={p.d}>
                    {p.name}
                  </button>
                ))}
              </div>
              <div className="dial">
                <div className="dial-top">
                  <span>Trials per scenario</span>
                  <b style={{ color: "var(--ink)" }}>{trials}</b>
                </div>
                <input type="range" min={1} max={30} value={trials} onChange={(e) => (setTrials(Number(e.target.value)), setPreset(""))} aria-label="Trials per scenario" />
                <small className="faint">More trials → tighter confidence intervals and a meaningful pass^k. 8+ recommended before shipping.</small>
              </div>
              <div className="grid g-3">
                {[
                  { label: "Tool errors", v: errorRate, set: setErrorRate, hint: "5xx from any tool" },
                  { label: "Timeouts", v: timeoutRate, set: setTimeoutRate, hint: "30s hangs" },
                  { label: "Malformed payloads", v: malformedRate, set: setMalformedRate, hint: "truncated JSON" },
                ].map((d) => (
                  <div key={d.label} className="dial">
                    <div className="dial-top">
                      <span className="row" style={{ gap: 6 }}>
                        <Icon name="chaos" size={14} /> {d.label}
                      </span>
                      <b>{pct(d.v)}</b>
                    </div>
                    <input type="range" min={0} max={0.5} step={0.01} value={d.v} onChange={(e) => (d.set(Number(e.target.value)), setPreset(""))} aria-label={d.label} />
                    <small className="faint">{d.hint}</small>
                  </div>
                ))}
              </div>
              <label className="field" style={{ maxWidth: 240 }}>
                <span>Seed (optional)</span>
                <input className="input" inputMode="numeric" placeholder="random" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} />
                <small>Same seed + same agent = the same trial outcomes for simulated specimens.</small>
              </label>
            </div>
          </section>
        </div>

        <aside className="panel reg" style={{ alignSelf: "start", position: "sticky", top: 84 }}>
          <div className="panel-head">
            <h3>Protocol summary</h3>
          </div>
          <div className="panel-body stack">
            <div className="display" style={{ fontSize: 56 }}>
              {int(total)}
              <span className="label" style={{ marginLeft: 10 }}>
                trials
              </span>
            </div>
            <dl className="kv">
              <dt>Suite</dt>
              <dd>{suite?.name ?? "—"}</dd>
              <dt>Scenarios</dt>
              <dd>{scenarioCount}</dd>
              <dt>Versions</dt>
              <dd>{versionIds.length}</dd>
              <dt>Trials each</dt>
              <dd>{trials}</dd>
              <dt>Chaos</dt>
              <dd>{errorRate || timeoutRate || malformedRate ? `${pct(errorRate)} err · ${pct(timeoutRate)} timeout · ${pct(malformedRate)} malformed` : "off"}</dd>
              {usage && (
                <>
                  <dt>Plan headroom</dt>
                  <dd style={{ color: total > remaining ? "var(--warn)" : undefined }}>
                    {remaining > 0 ? int(remaining) : 0} left on {usage.plan.name}
                    {total > remaining && usage.plan.overagePerTrial ? ` · ~$${((total - Math.max(0, remaining)) * usage.plan.overagePerTrial).toFixed(2)} overage` : ""}
                  </dd>
                </>
              )}
            </dl>
            <button className="btn primary" style={{ padding: "12px 16px" }} disabled={busy || !total} onClick={() => void launch()}>
              <Icon name="play" /> {busy ? "Starting…" : versionIds.length > 1 ? `Run ${versionIds.length} versions side by side` : "Start experiment"}
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
