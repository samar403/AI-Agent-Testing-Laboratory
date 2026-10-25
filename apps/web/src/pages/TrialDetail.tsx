import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { describeCriterion, type ChatMessage } from "@agentlab/core/browser";
import type { TrialDetail as TrialData } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { Scope } from "../components/Scope.tsx";
import { code, ms, pct, usd, useApi } from "../lib.tsx";

function pretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function TrialDetail() {
  const { id, trialId } = useParams();
  const nav = useNavigate();
  const { data, error } = useApi<TrialData>(`/runs/${id}/trials/${trialId}`, [trialId]);
  const [tab, setTab] = useState<"transcript" | "state" | "trace">("transcript");
  useCrumbs([
    { to: "/lab/runs", label: "Experiments" },
    { to: `/lab/runs/${id}`, label: data ? `${data.run.agentLabel} · ${code(data.run.id)}` : "…" },
    { label: data ? `${data.scenario?.title ?? data.scenarioId} #${data.trialIndex + 1}` : "Trial" },
  ]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading rows={4} />;

  const badCallIds = new Set<string>();
  // Map invalid calls to the tool call that produced them (the next tool message carries the error).
  data.transcript.forEach((m) => {
    if (m.role === "tool" && m.isError && /Invalid arguments|Unknown tool/.test(m.content)) badCallIds.add(m.toolCallId ?? "");
  });
  const m = data.metrics;

  return (
    <>
      <PageHead
        kicker={
          <span className="row" style={{ gap: 10 }}>
            <span>{code(data.id)}</span>·<span>seed {data.seed}</span>
            {data.servedModels.length > 0 && (
              <>
                ·<span>served by {data.servedModels.join(", ")}</span>
              </>
            )}
          </span>
        }
        title={
          <>
            {data.scenario?.title ?? data.scenarioId} <em>#{data.trialIndex + 1}</em>
          </>
        }
        sub={data.scenario?.description ?? (data.scenario?.persona?.goal ? `Persona goal: ${data.scenario.persona.goal}` : undefined)}
        actions={
          <>
            <span className={`chip ${data.passed ? "pass" : "fail"}`} style={{ fontSize: 13, padding: "5px 12px" }}>
              {data.passed ? "✓ PASSED" : "✕ FAILED"} · score {pct(data.score)}
            </span>
            <Link className="btn" to={`/lab/runs/${data.runId}`}>
              <Icon name="plate" /> Back to plate
            </Link>
          </>
        }
      />

      <div className="row" aria-label="Other trials of this scenario">
        <span className="label">Replicates</span>
        {data.siblings.map((s) => (
          <button
            key={s.id}
            className={`well filled ${s.passed ? "pass" : "fail"} ${s.id === data.id ? "selected" : ""}`}
            style={{ ["--well-size" as string]: "24px" }}
            title={`Trial ${s.trialIndex + 1}: ${s.passed ? "passed" : "failed"}`}
            aria-label={`Trial ${s.trialIndex + 1}`}
            onClick={() => nav(`/lab/runs/${data.runId}/trials/${s.id}`)}
          >
            <span className="glyph">{s.passed ? "✓" : "✕"}</span>
          </button>
        ))}
      </div>

      <section className="panel reg">
        <div className="panel-head">
          <h3>Oscilloscope</h3>
          <span className="specimen-id">{data.trace.length} EVENTS · {ms(m.latencyMs)}</span>
          <span className="right legend">
            <span><i style={{ background: "var(--s1)" }} />user</span>
            <span><i style={{ background: "var(--accent)" }} />agent step</span>
            <span><i style={{ background: "var(--s3)" }} />tool call</span>
            <span><i style={{ background: "var(--fail)" }} />fault / invalid call</span>
          </span>
        </div>
        <div className="panel-body">
          <Scope trace={data.trace} />
        </div>
      </section>

      <div className="grid g-main">
        <section className="panel reg">
          <div className="tabs" role="tablist">
            {(["transcript", "state", "trace"] as const).map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
                {t === "transcript" ? "Transcript" : t === "state" ? "World state" : "Raw trace"}
              </button>
            ))}
          </div>
          {tab === "transcript" && <Transcript messages={data.transcript} bad={badCallIds} />}
          {tab === "state" && (
            <div className="panel-body">
              <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
                Sandbox state after the conversation — what <code>state_equals</code> criteria inspect.
              </p>
              <pre className="codeblock">{JSON.stringify(data.finalState, null, 2)}</pre>
            </div>
          )}
          {tab === "trace" && (
            <div className="panel-body">
              <pre className="codeblock" style={{ maxHeight: 560 }}>
                {data.trace.map((e) => `${String(Math.round(e.t)).padStart(6)}ms  ${e.type.padEnd(12)} ${e.label}`).join("\n")}
              </pre>
            </div>
          )}
        </section>

        <div className="stack" style={{ gap: 18, alignContent: "start" }}>
          <section className="panel reg">
            <div className="panel-head">
              <h3>Criteria</h3>
              <span className="right specimen-id">
                {data.criteria.filter((c) => c.passed && !c.skipped).length}/{data.criteria.filter((c) => !c.skipped).length} MET
              </span>
            </div>
            <div className="crit-list" style={{ marginTop: 6 }}>
              {data.criteria.map((c, i) => (
                <div key={i} className="crit">
                  <span className={`ic ${c.skipped ? "skip" : c.passed ? "ok" : "no"}`}>{c.skipped ? "–" : c.passed ? "✓" : "✕"}</span>
                  <div>
                    <div>
                      {describeCriterion(c.criterion)}
                      {c.criterion.critical === false && <span className="chip mono" style={{ marginLeft: 6 }}>soft</span>}
                    </div>
                    <div className="cm">{c.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="panel reg">
            <div className="panel-head">
              <h3>Measurements</h3>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Turns</dt>
                <dd>{m.turns}</dd>
                <dt>Tool calls</dt>
                <dd>
                  {m.toolCalls}
                  {m.invalidToolCalls + m.unknownToolCalls > 0 && <span style={{ color: "var(--fail)" }}> · {m.invalidToolCalls + m.unknownToolCalls} invalid</span>}
                </dd>
                <dt>Faults injected</dt>
                <dd style={{ color: m.faultsInjected ? "var(--warn)" : undefined }}>{m.faultsInjected}</dd>
                <dt>Agent latency</dt>
                <dd>{ms(m.agentLatencyMs)}</dd>
                <dt>Tokens</dt>
                <dd>
                  {m.inputTokens.toLocaleString()} in · {m.outputTokens.toLocaleString()} out
                </dd>
                <dt>Est. cost</dt>
                <dd>{usd(m.costUsd)}</dd>
                {data.error && (
                  <>
                    <dt>Error</dt>
                    <dd style={{ color: "var(--fail)" }}>{data.error}</dd>
                  </>
                )}
              </dl>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Transcript({ messages, bad }: { messages: ChatMessage[]; bad: Set<string> }) {
  return (
    <div className="transcript">
      {messages.map((m, i) => {
        if (m.role === "tool") {
          return (
            <div key={i} className="msg tool">
              <span className="av">↩</span>
              <div className={`toolcall ${m.isError ? "err" : ""}`}>
                <span className="faint">{m.toolName} → </span>
                {pretty(m.content)}
              </div>
            </div>
          );
        }
        return (
          <div key={i} className={`msg ${m.role}`}>
            <span className="av">{m.role === "user" ? "U" : "A"}</span>
            <div className="stack" style={{ gap: 8 }}>
              <div className="who">{m.role === "user" ? "Simulated user" : "Agent"}</div>
              {m.content && <div className="bubble">{m.content}</div>}
              {m.toolCalls?.map((tc) => (
                <div key={tc.id} className={`toolcall ${bad.has(tc.id) ? "bad" : ""}`}>
                  {bad.has(tc.id) && (
                    <div style={{ color: "var(--fail)", marginBottom: 4 }}>
                      <Icon name="alert" size={12} /> rejected by the sandbox
                    </div>
                  )}
                  <span className="tn">{tc.name}</span>({JSON.stringify(tc.args, null, 2)})
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
