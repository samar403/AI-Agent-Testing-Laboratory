import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CompareResult, LightRun } from "../api.ts";
import { DecayCurve } from "../components/Charts.tsx";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { code, ms, pct, useApi } from "../lib.tsx";

const VERDICT = {
  regression: { label: "▼ regression", color: "var(--fail)" },
  improvement: { label: "▲ improvement", color: "var(--pass)" },
  unchanged: { label: "= unchanged", color: "var(--ink-3)" },
  inconclusive: { label: "~ inconclusive", color: "var(--ink-2)" },
};

function fmtMetric(v: number, unit?: string) {
  if (unit === "%") return pct(v, 1);
  if (unit === "ms") return ms(v);
  if (unit === "$") return `$${v.toFixed(4)}`;
  return String(Math.round(v * 100) / 100);
}

export function Compare() {
  useCrumbs([{ label: "Compare" }]);
  const [params, setParams] = useSearchParams();
  const { data: runs } = useApi<LightRun[]>("/runs?limit=200");
  const done = useMemo(() => (runs ?? []).filter((r) => r.status === "completed"), [runs]);
  const a = params.get("a");
  const b = params.get("b");

  // Default: the two most recent runs of the same suite with different agents.
  useEffect(() => {
    if ((a && b) || done.length < 2) return;
    const latest = done[0]!;
    const other = done.find((r) => r.suiteId === latest.suiteId && r.agentLabel !== latest.agentLabel) ?? done[1]!;
    setParams({ a: other.id, b: latest.id }, { replace: true });
  }, [a, b, done, setParams]);

  const { data, error, loading } = useApi<CompareResult>(a && b ? `/compare?a=${a}&b=${b}` : null, [a, b]);

  const picker = (key: "a" | "b", value: string | null) => (
    <label className="field" style={{ minWidth: 260, flex: 1 }}>
      <span className="row" style={{ gap: 8 }}>
        <i style={{ width: 14, height: 3, borderRadius: 2, background: key === "a" ? "var(--s1)" : "var(--s2)", display: "inline-block" }} />
        {key === "a" ? "Baseline (A)" : "Candidate (B)"}
      </span>
      <select className="select" value={value ?? ""} onChange={(e) => setParams({ a: key === "a" ? e.target.value : a ?? "", b: key === "b" ? e.target.value : b ?? "" })}>
        <option value="" disabled>
          Choose a run…
        </option>
        {done.map((r) => (
          <option key={r.id} value={r.id}>
            {r.agentLabel} — {r.suiteName} · {code(r.id)} · RI {r.headline?.ri}
          </option>
        ))}
      </select>
    </label>
  );

  const findingsDiff = useMemo(() => {
    if (!data) return null;
    const ta = new Set(data.a.summary.findings.filter((f) => f.severity !== "info").map((f) => f.title));
    const tb = new Set(data.b.summary.findings.filter((f) => f.severity !== "info").map((f) => f.title));
    return {
      introduced: data.b.summary.findings.filter((f) => f.severity !== "info" && !ta.has(f.title)),
      resolved: data.a.summary.findings.filter((f) => f.severity !== "info" && !tb.has(f.title)),
    };
  }, [data]);

  return (
    <>
      <PageHead
        title={
          <>
            Spectral <em>diff</em>
          </>
        }
        sub="Put two runs side by side. Every scenario gets a Fisher exact test, so a drop from 12/12 to 9/12 is flagged as noise or as a real regression — not left to gut feel."
      />
      <div className="panel reg panel-body row" style={{ alignItems: "flex-end", gap: 16 }}>
        {picker("a", a)}
        <button className="btn icon" aria-label="Swap runs" onClick={() => setParams({ a: b ?? "", b: a ?? "" })} style={{ marginBottom: 2 }}>
          <Icon name="compare" />
        </button>
        {picker("b", b)}
      </div>

      {error && <ErrorNote error={error} />}
      {loading && !data && <Loading rows={2} />}
      {data && (
        <>
          <div className="panel reg panel-body row" style={{ gap: 24, borderColor: data.comparison.overall.verdict === "regression" ? "color-mix(in oklab, var(--fail) 45%, transparent)" : undefined }}>
            <div>
              <div className="label">Overall verdict</div>
              <div className="display" style={{ fontSize: 40, color: VERDICT[data.comparison.overall.verdict].color, marginTop: 4 }}>
                {data.comparison.overall.verdict === "regression"
                  ? "Do not ship."
                  : data.comparison.overall.verdict === "improvement"
                    ? "Safe to ship."
                    : data.comparison.overall.verdict === "unchanged"
                      ? "No change."
                      : "Not conclusive."}
              </div>
            </div>
            <div className="muted" style={{ maxWidth: 560 }}>
              Pass rate {pct(data.comparison.overall.a, 1)} → <b style={{ color: "var(--ink)" }}>{pct(data.comparison.overall.b, 1)}</b> (p = {data.comparison.overall.pValue < 0.001 ? data.comparison.overall.pValue.toExponential(1) : data.comparison.overall.pValue.toFixed(3)}).{" "}
              {data.comparison.regressions} scenario regression{data.comparison.regressions === 1 ? "" : "s"}, {data.comparison.improvements} improvement{data.comparison.improvements === 1 ? "" : "s"}.
              {data.comparison.overall.verdict === "inconclusive" && " Run more trials to tighten the confidence intervals."}
            </div>
            <span className="spacer" />
            <Link className="btn" to={`/lab/runs/${data.b.id}`}>
              Open candidate <Icon name="arrow" />
            </Link>
          </div>

          <div className="grid g-main">
            <section className="panel reg">
              <div className="panel-head">
                <h3>Scenario spectrum</h3>
                <span className="right legend">
                  <span>
                    <i style={{ background: "var(--s1)" }} />
                    A · {data.a.agentLabel}
                  </span>
                  <span>
                    <i style={{ background: "var(--s2)" }} />B · {data.b.agentLabel}
                  </span>
                </span>
              </div>
              <div style={{ marginTop: 10 }}>
                {data.comparison.scenarios.map((s) => (
                  <div key={s.scenarioId} className="spectrum-row">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</div>
                      <div className="specimen-id">
                        {s.a.passes}/{s.a.trials} → {s.b.passes}/{s.b.trials}
                      </div>
                    </div>
                    <div className="bars" aria-label={`A ${pct(s.a.passRate)}, B ${pct(s.b.passRate)}`}>
                      <div className="side a">
                        <div className="fill" style={{ width: `calc(${s.a.passRate * 100}% - 6px)` }} />
                        <span className="v">{pct(s.a.passRate)}</span>
                      </div>
                      <div className="side b">
                        <div className="fill" style={{ width: `calc(${s.b.passRate * 100}% - 6px)` }} />
                        <span className="v">{pct(s.b.passRate)}</span>
                      </div>
                    </div>
                    <div className="verdict" style={{ color: VERDICT[s.verdict].color }}>
                      {VERDICT[s.verdict].label}
                      {s.verdict !== "unchanged" && <span className="faint">p={s.pValue.toFixed(2)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel reg">
              <div className="panel-head">
                <h3>Instrument readings</h3>
              </div>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th className="r">A</th>
                      <th className="r">B</th>
                      <th className="r">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.comparison.metrics.map((mt) => {
                      const delta = mt.b - mt.a;
                      const good = mt.better === "higher" ? delta > 0 : delta < 0;
                      const tiny = Math.abs(delta) < 1e-9;
                      return (
                        <tr key={mt.name}>
                          <td>{mt.name}</td>
                          <td className="r num">{fmtMetric(mt.a, mt.unit)}</td>
                          <td className="r num">{fmtMetric(mt.b, mt.unit)}</td>
                          <td className={`r num ${tiny ? "faint" : good ? "up" : "down"}`}>
                            {tiny ? "—" : `${delta > 0 ? "+" : "−"}${fmtMetric(Math.abs(delta), mt.unit)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid g-2">
            <section className="panel reg">
              <div className="panel-head">
                <h3>Reliability decay</h3>
              </div>
              <div className="panel-body">
                <DecayCurve curves={[{ name: `A · ${data.a.agentLabel}`, decay: data.a.summary.decay }, { name: `B · ${data.b.agentLabel}`, decay: data.b.summary.decay }]} />
              </div>
            </section>
            <section className="panel reg">
              <div className="panel-head">
                <h3>Notebook diff</h3>
              </div>
              <div className="notebook" style={{ marginTop: 6 }}>
                {findingsDiff!.introduced.map((f, i) => (
                  <div key={`n${i}`} className="finding">
                    <span className={`sev ${f.severity}`} />
                    <div>
                      <div className="ft">
                        <span className="chip fail" style={{ marginRight: 6 }}>new in B</span>
                        {f.title}
                      </div>
                      <div className="fd">{f.detail}</div>
                    </div>
                  </div>
                ))}
                {findingsDiff!.resolved.map((f, i) => (
                  <div key={`r${i}`} className="finding">
                    <span className="sev info" style={{ background: "var(--pass)" }} />
                    <div>
                      <div className="ft">
                        <span className="chip pass" style={{ marginRight: 6 }}>fixed in B</span>
                        {f.title}
                      </div>
                      <div className="fd">{f.detail}</div>
                    </div>
                  </div>
                ))}
                {!findingsDiff!.introduced.length && !findingsDiff!.resolved.length && <div className="empty">Same observations in both runs.</div>}
              </div>
            </section>
          </div>
        </>
      )}
      {!a && !b && done.length < 2 && runs && <div className="panel empty">Run at least two experiments to compare them.</div>}
    </>
  );
}
