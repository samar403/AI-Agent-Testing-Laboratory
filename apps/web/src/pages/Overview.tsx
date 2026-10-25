import { Link, useNavigate } from "react-router-dom";
import type { Overview as OverviewData } from "../api.ts";
import { LineChart, Ruler, SERIES } from "../components/Charts.tsx";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { RunStatus } from "./Runs.tsx";
import { ago, code, int, pct, riTone, useApi } from "../lib.tsx";

export function Overview() {
  useCrumbs([{ label: "Bench" }]);
  const nav = useNavigate();
  const { data, error } = useApi<OverviewData>("/overview");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading rows={4} />;

  // Reliability Index over time for the primary suite, one line per agent label (max 3 series).
  const primarySuite = data.history[0]?.suiteId;
  const hist = data.history.filter((h) => h.suiteId === primarySuite);
  const labels = [...new Set(hist.map((h) => h.label))].slice(0, 3);
  const series = labels.map((label, i) => ({
    name: label,
    color: SERIES[i]!,
    points: hist.filter((h) => h.label === label).map((h) => ({ x: h.at, y: h.ri })),
  }));
  const best = data.bestRun;

  return (
    <>
      <PageHead
        kicker={<>Bench · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</>}
        title={
          <>
            Good to see you in the <em>lab</em>.
          </>
        }
        sub={
          data.anthropic
            ? "Claude is connected: LLM-simulated users, Claude-powered agents and LLM judges are live."
            : "Simulation mode: the bundled specimens and scripted users run without an API key. Add ANTHROPIC_API_KEY to unlock Claude agents, persona users and LLM judges."
        }
        actions={
          <>
            <Link to="/lab/compare" className="btn">
              <Icon name="compare" /> Compare
            </Link>
            <Link to="/lab/experiments/new" className="btn primary">
              <Icon name="play" /> New experiment
            </Link>
          </>
        }
      />

      <div className="grid g-4">
        <div className="panel reg stat">
          <span className="label">Best reliability index</span>
          <div className="v" style={{ color: best ? `var(--${riTone(best.ri)})` : undefined }}>
            {best?.ri ?? "—"}
            <small>/100</small>
          </div>
          {best && <Ruler value={best.ri} />}
          <div className="d">{best ? `${best.label} · ${best.suite}` : "Run an experiment to get a score"}</div>
        </div>
        <div className="panel reg stat">
          <span className="label">Trials simulated</span>
          <div className="v">{int(data.totals.trials)}</div>
          <div className="d">
            across {data.counts.runs} experiments · {data.counts.suites} suites
          </div>
        </div>
        <div className="panel reg stat">
          <span className="label">Regressions caught</span>
          <div className="v" style={{ color: data.totals.regressionsCaught ? "var(--fail)" : undefined }}>
            {data.totals.regressionsCaught}
          </div>
          <div className="d">statistically significant scenario drops between versions</div>
        </div>
        <div className="panel reg stat">
          <span className="label">Open critical findings</span>
          <div className="v" style={{ color: data.totals.criticalFindings ? "var(--warn)" : "var(--pass)" }}>
            {data.totals.criticalFindings}
          </div>
          <div className="d">on the latest run of each agent × suite</div>
        </div>
      </div>

      <div className="grid g-main">
        <section className="panel reg">
          <div className="panel-head">
            <h3>Reliability over time</h3>
            <span className="specimen-id">{hist.length} RUNS</span>
          </div>
          <div className="panel-body">
            {series.length ? (
              <>
                <div className="legend" style={{ marginBottom: 8 }}>
                  {series.map((s) => (
                    <span key={s.name}>
                      <i style={{ background: s.color }} />
                      {s.name}
                    </span>
                  ))}
                </div>
                <LineChart
                  series={series}
                  yMax={100}
                  yFormat={(v) => String(Math.round(v))}
                  xFormat={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  xTicks={[...new Set(hist.map((h) => h.at))].filter((_, i, a) => a.length < 7 || i % 2 === 0)}
                />
              </>
            ) : (
              <div className="empty">No completed experiments yet.</div>
            )}
          </div>
        </section>

        <section className="panel reg">
          <div className="panel-head">
            <h3>Lab notebook</h3>
            <span className="right specimen-id">CRITICAL</span>
          </div>
          <div className="notebook" style={{ marginTop: 6 }}>
            {data.openFindings.length ? (
              data.openFindings.slice(0, 6).map((f, i) => (
                <Link key={i} to={`/lab/runs/${f.runId}`} className="finding">
                  <span className={`sev ${f.severity}`} />
                  <div>
                    <div className="ft">{f.title}</div>
                    <div className="fd">{f.detail}</div>
                    <div className="fk">
                      {f.kind.replace("_", " ")} · {f.agentLabel}
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="empty">
                <span className="display">All clear.</span>No critical findings on your latest runs.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel reg">
        <div className="panel-head">
          <h3>Recent experiments</h3>
          <Link to="/lab/runs" className="right btn ghost sm">
            View all <Icon name="arrow" />
          </Link>
        </div>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Specimen</th>
                <th>Agent</th>
                <th>Suite</th>
                <th className="r">RI</th>
                <th className="r">Pass</th>
                <th className="r">pass^k</th>
                <th>Status</th>
                <th className="r">When</th>
              </tr>
            </thead>
            <tbody>
              {data.recentRuns.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/lab/runs/${r.id}`)}>
                  <td className="specimen-id">{code(r.id)}</td>
                  <td>
                    {r.agentLabel} {r.source === "ci" && <span className="chip mono">CI</span>}
                  </td>
                  <td className="muted">{r.suiteName}</td>
                  <td className="r num" style={{ color: r.headline ? `var(--${riTone(r.headline.ri)})` : undefined }}>
                    {r.headline?.ri ?? "—"}
                  </td>
                  <td className="r num">{pct(r.headline?.passRate)}</td>
                  <td className="r num">{r.headline ? `${pct(r.headline.passHatK)}` : "—"}</td>
                  <td>
                    <RunStatus run={r} />
                  </td>
                  <td className="r faint">{ago(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
