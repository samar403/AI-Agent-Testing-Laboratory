import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { SUPPORT_SYSTEM_PROMPT, type AgentConfig } from "@agentlab/core/browser";
import { del, post, type Agent, type LightRun } from "../api.ts";
import { Sparkline } from "../components/Charts.tsx";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs, useHealth } from "../components/Layout.tsx";
import { RunStatus } from "./Runs.tsx";
import { ago, code, pct, riTone, useApi, useToast } from "../lib.tsx";

function describe(c: AgentConfig): string {
  if (c.kind === "mock") return `Simulated · ${c.variant}`;
  if (c.kind === "anthropic") return `Claude · ${c.model} · effort ${c.effort ?? "medium"}`;
  return `HTTP · ${c.url}`;
}

export function Agents() {
  useCrumbs([{ label: "Agents" }]);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data, error, reload } = useApi<Agent[]>("/agents");
  const { data: runs } = useApi<LightRun[]>("/runs?limit=300");
  const creating = params.get("new") === "1";
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead
        title={
          <>
            Agent <em>specimens</em>
          </>
        }
        sub="Every agent you test, with its versions. A version pins the exact configuration — prompt, model, endpoint — so results stay reproducible."
        actions={
          <button className="btn primary" onClick={() => setParams({ new: "1" })}>
            <Icon name="plus" /> New agent
          </button>
        }
      />
      {creating && (
        <section className="panel reg">
          <div className="panel-head">
            <h3>Register an agent</h3>
            <button className="right btn ghost sm" onClick={() => setParams({})}>
              Cancel
            </button>
          </div>
          <div className="panel-body">
            <NewAgentForm
              onCreated={(a) => {
                void reload();
                nav(`/lab/agents/${a.id}`);
              }}
            />
          </div>
        </section>
      )}
      <div className="grid g-2">
        {data.map((a) => {
          const history = (runs ?? []).filter((r) => a.versions.some((v) => v.id === r.versionId) && r.headline).reverse();
          const last = history[history.length - 1];
          return (
            <Link key={a.id} to={`/lab/agents/${a.id}`} className="panel reg" style={{ display: "block" }}>
              <div className="panel-head">
                <Icon name="specimen" />
                <h3>{a.name}</h3>
                <span className="right specimen-id">{code(a.id)}</span>
              </div>
              <div className="panel-body stack">
                <p className="muted" style={{ margin: 0 }}>
                  {a.description || "No description"}
                </p>
                <div className="row">
                  {a.versions.map((v) => (
                    <span key={v.id} className="chip mono">
                      {v.version}
                    </span>
                  ))}
                </div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="faint" style={{ fontSize: 12.5 }}>
                    {history.length} runs · latest RI{" "}
                    <b className="num" style={{ color: last ? `var(--${riTone(last.headline!.ri)})` : undefined }}>
                      {last?.headline?.ri ?? "—"}
                    </b>
                  </span>
                  <Sparkline values={history.map((r) => r.headline!.ri)} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

export function AgentConfigForm({ value, onChange }: { value: AgentConfig; onChange: (c: AgentConfig) => void }) {
  const health = useHealth();
  const kind = value.kind;
  const set = (patch: Partial<Record<string, unknown>>) => onChange({ ...(value as object), ...patch } as AgentConfig);
  return (
    <div className="stack">
      <div className="seg" role="tablist" aria-label="Adapter">
        {(
          [
            ["mock", "Simulated"],
            ["anthropic", "Claude"],
            ["http", "HTTP endpoint"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={kind === k ? "on" : ""}
            onClick={() =>
              onChange(
                k === "mock"
                  ? { kind: "mock", variant: "support-v2" }
                  : k === "anthropic"
                    ? { kind: "anthropic", model: "claude-opus-5-5", systemPrompt: SUPPORT_SYSTEM_PROMPT, effort: "medium", allowFallback: true }
                    : { kind: "http", url: "http://localhost:4100/agent" },
              )
            }
          >
            {label}
          </button>
        ))}
      </div>
      {value.kind === "mock" && (
        <label className="field">
          <span>Specimen</span>
          <select className="select" value={value.variant} onChange={(e) => set({ variant: e.target.value })}>
            {Object.entries(health?.variants ?? {}).map(([k, v]) => (
              <option key={k} value={k}>
                {v.name} — {v.description}
              </option>
            ))}
          </select>
          <small>Simulated agents for the bundled Acme Support suites. Great for learning the lab without an API key.</small>
        </label>
      )}
      {value.kind === "anthropic" && (
        <>
          {!health?.anthropic && (
            <div className="chip warn" style={{ justifySelf: "start" }}>
              <Icon name="alert" size={12} /> Set ANTHROPIC_API_KEY on the server to run this version
            </div>
          )}
          <div className="grid g-2">
            <label className="field">
              <span>Model</span>
              <select className="select" value={value.model} onChange={(e) => set({ model: e.target.value })}>
                {(health?.models ?? ["claude-opus-5-5"]).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Effort</span>
              <select className="select" value={value.effort ?? "medium"} onChange={(e) => set({ effort: e.target.value })}>
                {["low", "medium", "high", "xhigh", "max"].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>System prompt</span>
            <textarea className="textarea" rows={9} value={value.systemPrompt} onChange={(e) => set({ systemPrompt: e.target.value })} />
          </label>
          <label className="row" style={{ fontSize: 13 }}>
            <input type="checkbox" checked={value.allowFallback !== false} onChange={(e) => set({ allowFallback: e.target.checked })} />
            Server-side refusal fallback (the model that served each step is recorded in the trace)
          </label>
        </>
      )}
      {value.kind === "http" && (
        <>
          <label className="field">
            <span>Endpoint URL</span>
            <input className="input" value={value.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://staging.example.com/agentlab" />
            <small>
              Receives <code>{"{ messages, tools }"}</code> and returns <code>{"{ content, tool_calls }"}</code>. See Docs → Agent protocol.
            </small>
          </label>
          <label className="field">
            <span>Authorization header (optional)</span>
            <input
              className="input"
              type="password"
              value={value.headers?.authorization ?? ""}
              onChange={(e) => set({ headers: e.target.value ? { authorization: e.target.value } : undefined })}
              placeholder="Bearer …"
            />
          </label>
        </>
      )}
    </div>
  );
}

function NewAgentForm({ onCreated }: { onCreated: (a: Agent) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<AgentConfig>({ kind: "http", url: "http://localhost:4100/agent" });
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          onCreated(await post<Agent>("/agents", { name, description, version: "v1", config }));
        } catch (err) {
          toast((err as Error).message, "error");
        }
      }}
    >
      <div className="grid g-2">
        <label className="field">
          <span>Name</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Billing assistant" />
        </label>
        <label className="field">
          <span>Description</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this agent do?" />
        </label>
      </div>
      <AgentConfigForm value={config} onChange={setConfig} />
      <div>
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          <Icon name="plus" /> Create agent with v1
        </button>
      </div>
    </form>
  );
}

export function AgentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useApi<Agent>(`/agents/${id}`, [id]);
  const { data: runs } = useApi<LightRun[]>("/runs?limit=300");
  const [draft, setDraft] = useState<{ version: string; notes: string; config: AgentConfig } | null>(null);
  useCrumbs([{ to: "/lab/agents", label: "Agents" }, { label: data?.name ?? "…" }]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const latest = data.versions[data.versions.length - 1];
  const versionRuns = (vid: string) => (runs ?? []).filter((r) => r.versionId === vid);

  return (
    <>
      <PageHead
        kicker={code(data.id)}
        title={data.name}
        sub={data.description}
        actions={
          <>
            <button className="btn" onClick={() => setDraft({ version: `v${data.versions.length + 1}`, notes: "", config: latest?.config ?? { kind: "mock", variant: "support-v2" } })}>
              <Icon name="plus" /> New version
            </button>
            <button
              className="btn ghost"
              aria-label="Delete agent"
              onClick={async () => {
                if (!confirm(`Delete ${data.name} and all its versions? Past runs are kept.`)) return;
                await del(`/agents/${data.id}`);
                nav("/lab/agents");
              }}
            >
              <Icon name="trash" />
            </button>
          </>
        }
      />
      {draft && (
        <section className="panel reg">
          <div className="panel-head">
            <h3>New version</h3>
            <button className="right btn ghost sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
          <div className="panel-body stack">
            <div className="grid g-2">
              <label className="field">
                <span>Version label</span>
                <input className="input" value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} />
              </label>
              <label className="field">
                <span>Change notes</span>
                <input className="input" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="What changed and why?" />
              </label>
            </div>
            <AgentConfigForm value={draft.config} onChange={(config) => setDraft({ ...draft, config })} />
            <div>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await post(`/agents/${data.id}/versions`, draft);
                    setDraft(null);
                    toast(`Created ${draft.version}`);
                    void reload();
                  } catch (e) {
                    toast((e as Error).message, "error");
                  }
                }}
              >
                Save version
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="stack" style={{ gap: 18 }}>
        {[...data.versions].reverse().map((v) => {
          const vr = versionRuns(v.id);
          const best = vr.find((r) => r.headline);
          return (
            <section key={v.id} className="panel reg">
              <div className="panel-head">
                <span className="chip mono accent">{v.version}</span>
                <h3>{describe(v.config)}</h3>
                <span className="right row">
                  <span className="faint" style={{ fontSize: 12 }}>
                    created {ago(v.created_at)}
                  </span>
                  <Link className="btn sm primary" to={`/lab/experiments/new?version=${v.id}`}>
                    <Icon name="play" /> Test this version
                  </Link>
                </span>
              </div>
              <div className="panel-body stack">
                {v.notes && <p className="muted" style={{ margin: 0 }}>{v.notes}</p>}
                {v.config.kind === "anthropic" && (
                  <details>
                    <summary className="faint" style={{ cursor: "pointer", fontSize: 13 }}>
                      System prompt
                    </summary>
                    <pre className="codeblock" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
                      {v.config.systemPrompt}
                    </pre>
                  </details>
                )}
                {vr.length ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Run</th>
                          <th>Suite</th>
                          <th className="r">RI</th>
                          <th className="r">Pass</th>
                          <th>Status</th>
                          <th className="r">When</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vr.slice(0, 6).map((r) => (
                          <tr key={r.id} className="click" onClick={() => nav(`/lab/runs/${r.id}`)}>
                            <td className="specimen-id">{code(r.id)}</td>
                            <td className="muted">
                              {r.suiteName}
                              {r.options.chaos?.global?.errorRate ? <span className="chip warn mono" style={{ marginLeft: 6 }}>chaos</span> : null}
                            </td>
                            <td className="r num" style={{ color: r.headline ? `var(--${riTone(r.headline.ri)})` : undefined }}>{r.headline?.ri ?? "—"}</td>
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
                ) : (
                  <div className="faint" style={{ fontSize: 13 }}>
                    Not tested yet{best ? "" : "."}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
