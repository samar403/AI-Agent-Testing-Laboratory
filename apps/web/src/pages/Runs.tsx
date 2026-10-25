import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, del, eventsUrl, post, reportUrl, type Cell, type LightRun, type RunDetail as RunDetailData } from "../api.ts";
import { DecayCurve, Ruler } from "../components/Charts.tsx";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { Microplate, PlateLegend } from "../components/Microplate.tsx";
import { ago, code, ms, pct, riTone, ROWS, usd, useApi, useToast } from "../lib.tsx";


export function RunStatus({ run }: { run: Pick<LightRun, "status" | "done" | "total" | "headline"> }) {
  if (run.status === "running" || run.status === "queued")
    return (
      <span className="chip accent">
        <span className="dot on" style={{ background: "var(--accent)", boxShadow: "0 0 0 3px var(--accent-glow)" }} /> {run.done}/{run.total}
      </span>
    );
  if (run.status === "failed") return <span className="chip fail">failed</span>;
  if (run.status === "cancelled") return <span className="chip">cancelled</span>;
  const crit = run.headline?.critical ?? 0;
  return crit ? <span className="chip warn">{crit} critical</span> : <span className="chip pass">clean</span>;
}

export function Runs() {
  useCrumbs([{ label: "Experiments" }]);
  const nav = useNavigate();
  const { data, error } = useApi<LightRun[]>("/runs?limit=200");
  const [filter, setFilter] = useState<"all" | "lab" | "ci">("all");
  const [picked, setPicked] = useState<string[]>([]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const rows = data.filter((r) => filter === "all" || r.source === filter);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  return (
    <>
      <PageHead
        title={
          <>
            <em>Experiments</em>
          </>
        }
        sub="Every run of a suite against an agent version — from the lab or from CI. Tick two to compare them."
        actions={
          <>
            <div className="seg" role="tablist">
              {(["all", "lab", "ci"] as const).map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "lab" ? "Lab" : "CI"}
                </button>
              ))}
            </div>
            <button className="btn" disabled={picked.length !== 2} onClick={() => nav(`/lab/compare?a=${picked[0]}&b=${picked[1]}`)}>
              <Icon name="compare" /> Compare {picked.length === 2 ? "2" : ""}
            </button>
            <Link to="/lab/experiments/new" className="btn primary">
              <Icon name="play" /> New experiment
            </Link>
          </>
        }
      />
      <section className="panel reg">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>Specimen</th>
                <th>Agent</th>
                <th>Suite</th>
                <th className="r">Trials</th>
                <th className="r">RI</th>
                <th className="r">Pass</th>
                <th className="r">pass^k</th>
                <th className="r">Tool acc.</th>
                <th>Status</th>
                <th className="r">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/lab/runs/${r.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${r.agentLabel} for comparison`} checked={picked.includes(r.id)} onChange={() => toggle(r.id)} disabled={r.status !== "completed"} />
                  </td>
                  <td className="specimen-id">{code(r.id)}</td>
                  <td>
                    {r.agentLabel} {r.source === "ci" && <span className="chip mono">CI</span>}
                    {r.options.chaos?.global?.errorRate ? <span className="chip warn mono" style={{ marginLeft: 6 }}>chaos {pct(r.options.chaos.global.errorRate)}</span> : null}
                  </td>
                  <td className="muted">{r.suiteName}</td>
                  <td className="r num">{r.total}</td>
                  <td className="r num" style={{ color: r.headline ? `var(--${riTone(r.headline.ri)})` : undefined }}>{r.headline?.ri ?? "—"}</td>
                  <td className="r num">{pct(r.headline?.passRate)}</td>
                  <td className="r num">{pct(r.headline?.passHatK)}</td>
                  <td className="r num">{pct(r.headline?.toolCallAccuracy)}</td>
                  <td>
                    <RunStatus run={r} />
                  </td>
                  <td className="r faint">{ago(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <div className="empty">No experiments here yet.</div>}
        </div>
      </section>
    </>
  );
}

export function RunDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload, setData } = useApi<RunDetailData>(`/runs/${id}`, [id]);
  const [live, setLive] = useState(false);

  useCrumbs([{ to: "/lab/runs", label: "Experiments" }, { label: data ? `${data.agent_label} · ${code(data.id)}` : "…" }]);

  // Stream wells into the plate while the run is executing.
  useEffect(() => {
    if (!data || (data.status !== "running" && data.status !== "queued")) return;
    const es = new EventSource(eventsUrl(data.id));
    setLive(true);
    es.addEventListener("trial", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as Cell & { trialId: string; done: number };
      setData((d) => (d ? { ...d, done: e.done, cells: [...d.cells.filter((c) => c.id !== e.trialId), { ...e, id: e.trialId }] } : d));
    });
    es.addEventListener("status", (ev) => {
      const e = JSON.parse((ev as MessageEvent).data) as { status: string; error?: string };
      if (e.status !== "running") {
        es.close();
        setLive(false);
        if (e.status === "failed") toast(`Run failed: ${e.error}`, "error");
        void reload();
      }
    });
    es.onerror = () => {
      es.close();
      setLive(false);
      setTimeout(() => void reload(), 800);
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id, data?.status]);

  const scenarios = data?.suite.scenarios ?? [];
  const s = data?.summary;
  const scenarioIndex = useMemo(() => Object.fromEntries(scenarios.map((x, i) => [x.id, i])), [scenarios]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading rows={4} />;
  const running = data.status === "running" || data.status === "queued";
  const chaos = data.options.chaos?.global;

  async function rerun() {
    if (!data?.suite_id || !data.agent_version_id) return;
    try {
      const [r] = await post<LightRun[]>("/runs", { suiteId: data.suite_id, versionIds: [data.agent_version_id], options: { ...data.options, seed: undefined } });
      nav(`/lab/runs/${r!.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <PageHead
        kicker={
          <span className="row" style={{ gap: 10 }}>
            <span>{code(data.id)}</span>
            <span>·</span>
            <span>{data.suite_name}</span>
            <span>·</span>
            <span>seed {data.options.seed ?? 42}</span>
            {data.source === "ci" && <span className="chip mono">CI</span>}
          </span>
        }
        title={
          <>
            {data.agent_label} <em>under test</em>
          </>
        }
        sub={
          running
            ? `Running ${data.total} trials — wells fill as conversations finish.`
            : `${data.total} trials across ${scenarios.length} scenarios${chaos?.errorRate ? `, with ${pct(chaos.errorRate)} injected tool errors` : ""}. Finished ${data.finished_at ? ago(data.finished_at) : ""}.`
        }
        actions={
          <>
            {running ? (
              <button className="btn danger" onClick={() => void api(`/runs/${data.id}/cancel`, { method: "POST" }).then(() => toast("Cancelling…"))}>
                <Icon name="stop" /> Cancel
              </button>
            ) : (
              <>
                {data.agent_version_id && (
                  <button className="btn" onClick={() => void rerun()}>
                    <Icon name="play" /> Re-run
                  </button>
                )}
                {data.siblings[0] && (
                  <Link className="btn" to={`/lab/compare?a=${data.siblings[0].id}&b=${data.id}`}>
                    <Icon name="compare" /> Compare with {data.siblings[0].agentLabel}
                  </Link>
                )}
                <a className="btn" href={reportUrl(data.id, "junit")}>
                  <Icon name="download" /> JUnit
                </a>
                <a className="btn" href={reportUrl(data.id, "json")}>
                  <Icon name="download" /> JSON
                </a>
                <button
                  className="btn ghost"
                  aria-label="Delete run"
                  onClick={async () => {
                    if (!confirm("Delete this experiment and all of its trials?")) return;
                    await del(`/runs/${data.id}`);
                    nav("/lab/runs");
                  }}
                >
                  <Icon name="trash" />
                </button>
              </>
            )}
          </>
        }
      />

      {running && (
        <div className="progress" aria-label="progress">
          <span style={{ width: `${(data.done / Math.max(1, data.total)) * 100}%` }} />
        </div>
      )}
      {data.status === "failed" && <ErrorNote error={{ message: data.error ?? "Run failed" }} />}

      {s && (
        <div className="grid g-4">
          <div className="panel reg stat">
            <span className="label">Reliability index</span>
            <div className="v" style={{ color: `var(--${riTone(s.reliabilityIndex)})` }}>
              {s.reliabilityIndex}
              <small>/100</small>
            </div>
            <Ruler value={s.reliabilityIndex} />
          </div>
          <div className="panel reg stat">
            <span className="label">Pass rate</span>
            <div className="v">{pct(s.passRate, 1)}</div>
            <div className="d">
              95% CI {pct(s.ci[0])}–{pct(s.ci[1])} · {s.passes}/{s.trials} trials
            </div>
          </div>
          <div className="panel reg stat">
            <span className="label">pass^{s.k} · consistency</span>
            <div className="v">{pct(s.passHatK)}</div>
            <div className="d">
              chance all {s.k} attempts succeed · pass@{s.k} {pct(s.passAtK)} · {s.flakyScenarios} flaky
            </div>
          </div>
          <div className="panel reg stat">
            <span className="label">Tool-call accuracy</span>
            <div className="v" style={{ color: s.toolCallAccuracy < 0.95 ? "var(--warn)" : undefined }}>{pct(s.toolCallAccuracy, 1)}</div>
            <div className="d">
              p95 {ms(s.latency.p95)} · {usd(s.costUsd)} est. cost
            </div>
          </div>
        </div>
      )}

      <div className="grid g-main">
        <section className="panel reg">
          <div className="panel-head">
            <h3>Microplate</h3>
            <span className="specimen-id">
              {scenarios.length}×{data.options.trials} WELLS {live && "· LIVE"}
            </span>
            <span className="right faint" style={{ fontSize: 12 }}>
              Click a well to inspect its trace
            </span>
          </div>
          <div className="panel-body stack">
            <Microplate scenarios={scenarios} trials={data.options.trials} cells={data.cells} running={running} onSelect={(c) => nav(`/lab/runs/${data.id}/trials/${c.id}`)} />
            <PlateLegend />
          </div>
        </section>

        <section className="panel reg">
          <div className="panel-head">
            <h3>Lab notebook</h3>
            <span className="right specimen-id">{s ? `${s.findings.length} OBSERVATIONS` : "PENDING"}</span>
          </div>
          <div className="notebook" style={{ marginTop: 6, maxHeight: 520, overflowY: "auto" }}>
            {s ? (
              s.findings.map((f, i) => (
                <div key={i} className="finding">
                  <span className={`sev ${f.severity}`} />
                  <div>
                    <div className="ft">
                      {f.scenarioId !== undefined && scenarioIndex[f.scenarioId] !== undefined && <span className="specimen-id" style={{ marginRight: 6 }}>{ROWS[scenarioIndex[f.scenarioId]!]}</span>}
                      {f.title}
                    </div>
                    <div className="fd">{f.detail}</div>
                    <div className="fk">{f.kind.replace("_", " ")}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">Observations appear when the run finishes.</div>
            )}
          </div>
        </section>
      </div>

      {s && (
        <div className="grid g-2">
          <section className="panel reg">
            <div className="panel-head">
              <h3>Reliability decay</h3>
              <span className="right specimen-id">pass^k, k = 1…{s.k}</span>
            </div>
            <div className="panel-body">
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Probability that a user who runs the same task <b>k</b> times succeeds every time. A reliable agent stays flat; a flaky one decays —
                at k={s.k} this agent holds {pct(s.decay[s.decay.length - 1])}.
              </p>
              <DecayCurve curves={[{ name: data.agent_label, decay: s.decay }]} />
            </div>
          </section>
          <section className="panel reg">
            <div className="panel-head">
              <h3>Fault sensitivity</h3>
              <span className="right specimen-id">{s.faultsInjected} FAULTS INJECTED</span>
            </div>
            <div className="panel-body stack">
              {s.faultsInjected ? (
                <>
                  <FaultBar label="Trials without faults" value={s.passRateWithoutFaults} />
                  <FaultBar label="Trials with injected faults" value={s.passRateUnderFaults} tone="warn" />
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {s.passRateUnderFaults !== null && s.passRateWithoutFaults !== null && s.passRateWithoutFaults - s.passRateUnderFaults > 0.15
                      ? "The agent degrades sharply when its tools misbehave. Check that it retries, escalates and never claims success after an error."
                      : "The agent holds up when tools fail — errors are retried or escalated rather than hidden."}
                  </p>
                </>
              ) : (
                <div className="empty" style={{ padding: 24 }}>
                  No faults were injected in this run.
                  <Link to="/lab/experiments/new" className="btn sm">
                    <Icon name="chaos" /> Run with chaos
                  </Link>
                </div>
              )}
              <div className="divider" />
              <dl className="kv">
                <dt>Agent</dt>
                <dd>{data.agent.kind === "mock" ? `simulated · ${data.agent.variant}` : data.agent.kind === "anthropic" ? `${data.agent.model} · effort ${data.agent.effort}` : data.agent.kind === "http" ? data.agent.url : "external (CI)"}</dd>
                <dt>Tokens</dt>
                <dd>
                  {s.tokens.input.toLocaleString()} in · {s.tokens.output.toLocaleString()} out
                </dd>
                <dt>Latency</dt>
                <dd>
                  p50 {ms(s.latency.p50)} · p95 {ms(s.latency.p95)}
                </dd>
              </dl>
            </div>
          </section>
        </div>
      )}

      {s && (
        <section className="panel reg">
          <div className="panel-head">
            <h3>Scenarios</h3>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Scenario</th>
                  <th className="r">Passed</th>
                  <th className="r">95% CI</th>
                  <th className="r">pass^k</th>
                  <th className="r">Mean latency</th>
                  <th>Most frequent failure</th>
                </tr>
              </thead>
              <tbody>
                {s.scenarios.map((sc) => {
                  const top = Object.entries(sc.failingCriteria).sort((a, b) => b[1] - a[1])[0];
                  const first = data.cells.find((c) => c.scenarioId === sc.scenarioId && !c.passed) ?? data.cells.find((c) => c.scenarioId === sc.scenarioId);
                  return (
                    <tr key={sc.scenarioId} className="click" onClick={() => first && nav(`/lab/runs/${data.id}/trials/${first.id}`)}>
                      <td className="specimen-id">{ROWS[scenarioIndex[sc.scenarioId] ?? 0]}</td>
                      <td>
                        {sc.title} {sc.flaky && <span className="chip warn">flaky</span>}
                      </td>
                      <td className="r num" style={{ color: sc.passes === sc.trials ? "var(--pass)" : sc.passes === 0 ? "var(--fail)" : "var(--warn)" }}>
                        {sc.passes}/{sc.trials}
                      </td>
                      <td className="r num faint">
                        {pct(sc.ci[0])}–{pct(sc.ci[1])}
                      </td>
                      <td className="r num">{pct(sc.passHatK)}</td>
                      <td className="r num">{ms(sc.meanLatencyMs)}</td>
                      <td className="muted">{top ? `${top[0]} (${top[1]}×)` : <span className="faint">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function FaultBar({ label, value, tone = "pass" }: { label: string; value: number | null; tone?: "pass" | "warn" }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {label}
        </span>
        <span className="num">{pct(value)}</span>
      </div>
      <div className="meter" style={{ height: 10 }}>
        <span style={{ width: `${(value ?? 0) * 100}%`, background: `var(--${tone})` }} />
      </div>
    </div>
  );
}
