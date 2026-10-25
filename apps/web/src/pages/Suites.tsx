import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import YAML from "yaml";
import { describeCriterion, validateSuite, type SuiteSpec } from "@agentlab/core/browser";
import { del, post, put, type SuiteDetail, type SuiteListItem } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs } from "../components/Layout.tsx";
import { RunStatus } from "./Runs.tsx";
import { ago, code, download, pct, riTone, ROWS, useApi, useToast } from "../lib.tsx";

const TEMPLATE = `name: My agent — core flows
description: What this suite proves about the agent.
initialState: {}
tools:
  - name: search_docs
    description: Search the help center.
    parameters:
      type: object
      properties:
        query: { type: string, minLength: 2 }
      required: [query]
      additionalProperties: false
    mocks:
      - when: { query: { $regex: "password" } }
        return: { results: [{ title: "Reset your password", url: "/help/reset" }] }
      - return: { results: [] }
    chaos: { latencyMs: [50, 250] }
  - name: create_ticket
    description: Open a support ticket for a human.
    parameters:
      type: object
      properties:
        subject: { type: string }
        priority: { type: string, enum: [low, normal, high] }
      required: [subject, priority]
      additionalProperties: false
    mocks:
      - return: { ticket_id: "T-1001" }
        set: { tickets.last: "{{args.subject}}" }
scenarios:
  - id: password-reset
    title: Password reset question
    user:
      mode: scripted
      turns: ["How do I reset my password?"]
    criteria:
      - type: tool_called
        tool: search_docs
        args: { query: { $regex: "password" } }
      - type: response_contains
        text: /help/reset
      - type: tool_not_called
        tool: create_ticket
      - type: valid_tool_calls
  - id: angry-escalation
    title: Angry customer wants a human
    persona: { name: Alex, traits: [angry, impatient], goal: "talk to a human about a double charge" }
    user:
      mode: llm
      turns: ["I was charged twice and I want a real person NOW."]
    criteria:
      - type: tool_called
        tool: create_ticket
        args: { priority: high }
      - type: llm_judge
        rubric: The agent de-escalates and confirms a human will follow up.
        critical: false
`;

export function Suites() {
  useCrumbs([{ label: "Suites" }]);
  const nav = useNavigate();
  const { data, error } = useApi<SuiteListItem[]>("/suites");
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageHead
        title={
          <>
            Test <em>suites</em>
          </>
        }
        sub="A suite is a sealed world: the tools your agent can call (with mocks and chaos), and scenarios with simulated users and pass/fail criteria."
        actions={
          <Link to="/lab/suites/new" className="btn primary">
            <Icon name="plus" /> New suite
          </Link>
        }
      />
      <div className="grid g-2">
        {data.map((s) => (
          <section key={s.id} className="panel reg" style={{ cursor: "pointer" }} onClick={() => nav(`/lab/suites/${s.id}`)}>
            <div className="panel-head">
              <Icon name="suite" />
              <h3>{s.name}</h3>
              <span className="right specimen-id">{code(s.id)}</span>
            </div>
            <div className="panel-body stack">
              <p className="muted" style={{ margin: 0 }}>
                {s.description}
              </p>
              <div className="row">
                <span className="chip">{s.scenarioCount} scenarios</span>
                <span className="chip">{s.toolCount} tools</span>
                <span className="chip">{s.criteriaCount} criteria</span>
                {[...new Set(s.spec.scenarios.flatMap((x) => x.tags ?? []))].slice(0, 4).map((t) => (
                  <span key={t} className="chip mono">
                    #{t}
                  </span>
                ))}
              </div>
              <div className="row faint" style={{ fontSize: 12.5 }}>
                {s.lastRun ? (
                  <>
                    Last run {ago(s.lastRun.createdAt)} · {s.lastRun.agentLabel} · RI{" "}
                    <b className="num" style={{ color: s.lastRun.headline ? `var(--${riTone(s.lastRun.headline.ri)})` : undefined }}>
                      {s.lastRun.headline?.ri ?? "—"}
                    </b>
                  </>
                ) : (
                  "Never run"
                )}
                <span className="spacer" />
                <Link className="btn sm" to={`/lab/experiments/new?suite=${s.id}`} onClick={(e) => e.stopPropagation()}>
                  <Icon name="play" /> Run
                </Link>
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function SuiteEditor() {
  const { id } = useParams();
  const isNew = !id;
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<SuiteDetail>(isNew ? null : `/suites/${id}`, [id]);
  const [text, setText] = useState<string | null>(isNew ? TEMPLATE : null);
  const [view, setView] = useState<"split" | "code" | "preview">("split");
  useCrumbs([{ to: "/lab/suites", label: "Suites" }, { label: isNew ? "New suite" : data?.name ?? "…" }]);

  useEffect(() => {
    if (data && text === null) setText(data.yaml);
  }, [data, text]);

  // Validate locally on every keystroke (the same validator the server runs).
  const parsed = useMemo((): { suite?: SuiteSpec; errors: string[] } => {
    if (text === null) return { errors: [] };
    let raw: unknown;
    try {
      raw = YAML.parse(text);
    } catch (e) {
      return { errors: [`YAML: ${(e as Error).message.split("\n")[0]}`] };
    }
    const v = validateSuite(raw);
    return v.ok ? { suite: v.suite, errors: [] } : { errors: v.errors };
  }, [text]);

  if (error) return <ErrorNote error={error} />;
  if (text === null) return <Loading />;
  const dirty = isNew || text !== data?.yaml;

  async function save() {
    try {
      if (isNew) {
        const s = await post<SuiteDetail>("/suites", { yaml: text });
        toast("Suite created");
        nav(`/lab/suites/${s.id}`);
      } else {
        await put(`/suites/${id}`, { yaml: text });
        toast("Suite saved");
        setText(null);
        void reload();
      }
    } catch (e) {
      const err = e as Error & { details?: string[] };
      toast(err.details?.[0] ?? err.message, "error");
    }
  }

  return (
    <>
      <PageHead
        kicker={isNew ? "Draft" : code(id!)}
        title={parsed.suite?.name ?? data?.name ?? "Untitled suite"}
        sub={parsed.suite?.description}
        actions={
          <>
            <div className="seg">
              {(["split", "code", "preview"] as const).map((v) => (
                <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                  {v === "split" ? "Split" : v === "code" ? "YAML" : "Preview"}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => download(`${(parsed.suite?.name ?? "suite").replace(/\W+/g, "-").toLowerCase()}.yaml`, text)}>
              <Icon name="download" /> Export
            </button>
            {!isNew && (
              <>
                <Link className="btn" to={`/lab/experiments/new?suite=${id}`}>
                  <Icon name="play" /> Run
                </Link>
                <button
                  className="btn ghost"
                  aria-label="Delete suite"
                  onClick={async () => {
                    if (!confirm("Delete this suite? Past runs keep their snapshot.")) return;
                    await del(`/suites/${id}`);
                    nav("/lab/suites");
                  }}
                >
                  <Icon name="trash" />
                </button>
              </>
            )}
            <button className="btn primary" disabled={!dirty || parsed.errors.length > 0} onClick={() => void save()}>
              <Icon name="check" /> {isNew ? "Create suite" : "Save"}
            </button>
          </>
        }
      />

      <div className={`grid ${view === "split" ? "g-2" : ""}`} style={{ alignItems: "start" }}>
        {view !== "preview" && (
          <section className="panel reg">
            <div className="panel-head">
              <h3>Specification</h3>
              <span className="right">
                {parsed.errors.length ? <span className="chip fail">{parsed.errors.length} problem{parsed.errors.length > 1 ? "s" : ""}</span> : <span className="chip pass">✓ valid</span>}
              </span>
            </div>
            <div className="panel-body stack">
              <textarea
                className="textarea code-editor"
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const s = el.selectionStart;
                    setText(text.slice(0, s) + "  " + text.slice(el.selectionEnd));
                    requestAnimationFrame(() => (el.selectionStart = el.selectionEnd = s + 2));
                  }
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                    e.preventDefault();
                    if (dirty && !parsed.errors.length) void save();
                  }
                }}
                aria-label="Suite YAML"
              />
              {parsed.errors.length > 0 && (
                <ul className="err-list">
                  {parsed.errors.slice(0, 8).map((er) => (
                    <li key={er}>{er}</li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
        {view !== "code" && parsed.suite && <SuitePreview suite={parsed.suite} />}
      </div>

      {data && data.runs.length > 0 && (
        <section className="panel reg">
          <div className="panel-head">
            <h3>Runs of this suite</h3>
          </div>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="table">
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="click" onClick={() => nav(`/lab/runs/${r.id}`)}>
                    <td className="specimen-id">{code(r.id)}</td>
                    <td>{r.agentLabel}</td>
                    <td className="r num" style={{ color: r.headline ? `var(--${riTone(r.headline.ri)})` : undefined }}>
                      RI {r.headline?.ri ?? "—"}
                    </td>
                    <td className="r num">{pct(r.headline?.passRate)}</td>
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
      )}
    </>
  );
}

function SuitePreview({ suite }: { suite: SuiteSpec }) {
  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="panel reg">
        <div className="panel-head">
          <h3>Tools</h3>
          <span className="right specimen-id">{suite.tools.length} IN SANDBOX</span>
        </div>
        <div style={{ marginTop: 8 }}>
          {suite.tools.map((t) => (
            <div key={t.name} className="finding" style={{ gridTemplateColumns: "20px 1fr" }}>
              <Icon name="tool" />
              <div>
                <div className="ft mono" style={{ fontSize: 13 }}>
                  {t.name}({Object.keys(t.parameters.properties ?? {}).join(", ")})
                </div>
                <div className="fd">{t.description}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="chip mono">{t.mocks?.length ?? 0} mocks</span>
                  {t.chaos?.errorRate ? <span className="chip warn mono">err {pct(t.chaos.errorRate)}</span> : null}
                  {t.chaos?.latencyMs ? (
                    <span className="chip mono">
                      {t.chaos.latencyMs[0]}–{t.chaos.latencyMs[1]}ms
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel reg">
        <div className="panel-head">
          <h3>Scenarios</h3>
          <span className="right specimen-id">ROWS A–{ROWS[suite.scenarios.length - 1]}</span>
        </div>
        <div style={{ marginTop: 8 }}>
          {suite.scenarios.map((s, i) => (
            <div key={s.id} className="finding" style={{ gridTemplateColumns: "22px 1fr" }}>
              <span className="specimen-id" style={{ marginTop: 2 }}>
                {ROWS[i]}
              </span>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <span className="ft">{s.title}</span>
                  <span className={`chip mono ${s.user.mode === "llm" ? "accent" : ""}`}>{s.user.mode === "llm" ? "persona sim" : "scripted"}</span>
                  {s.chaos && <span className="chip warn mono">chaos</span>}
                </div>
                {s.persona && (
                  <div className="fd">
                    {s.persona.name}
                    {s.persona.traits?.length ? ` · ${s.persona.traits.join(", ")}` : ""}
                    {s.persona.goal ? ` — ${s.persona.goal}` : ""}
                  </div>
                )}
                {s.user.turns?.[0] && <div className="fd">“{s.user.turns[0]}”</div>}
                <div className="row" style={{ gap: 6 }}>
                  {s.criteria.map((c, j) => (
                    <span key={j} className="chip" title={c.type}>
                      {describeCriterion(c)}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
