import { useState } from "react";
import { del, post } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { ErrorNote, Loading, PageHead, useCrumbs, useHealth } from "../components/Layout.tsx";
import { ago, useApi, useToast } from "../lib.tsx";

interface Key {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

export function Settings() {
  useCrumbs([{ label: "API keys & CI" }]);
  const toast = useToast();
  const health = useHealth();
  const { data, error, reload } = useApi<Key[]>("/keys");
  const [name, setName] = useState("GitHub Actions");
  const [fresh, setFresh] = useState<string | null>(null);
  const origin = window.location.origin;

  const workflow = `name: agent-reliability
on: [pull_request]
jobs:
  agentlab:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: samar403/AI-Agent-Testing-Laboratory@main
        with:
          suite: suites/support.yaml
          agent: \${{ vars.AGENT_URL }}
          trials: 8
          args: --chaos 0.1 --min-ri 85 --min-pass-k 0.7 --max-critical 0
          upload-url: ${origin}
        env:
          AGENTLAB_API_KEY: \${{ secrets.AGENTLAB_API_KEY }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}`;

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead
        title={
          <>
            API keys & <em>CI</em>
          </>
        }
        sub="Keys let the CLI upload results from your pipeline into this lab. Gate merges on reliability, not on a single happy-path demo."
      />
      <div className="grid g-main">
        <section className="panel reg">
          <div className="panel-head">
            <h3>API keys</h3>
          </div>
          <div className="panel-body stack">
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                const k = await post<{ key: string }>("/keys", { name });
                setFresh(k.key);
                void reload();
              }}
            >
              <input className="input" style={{ flex: 1, minWidth: 200 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Key name" />
              <button className="btn primary" type="submit">
                <Icon name="key" /> Create key
              </button>
            </form>
            {fresh && (
              <div className="dial" style={{ borderColor: "var(--accent)" }}>
                <span className="label">Copy now — it won’t be shown again</span>
                <div className="row">
                  <code style={{ flex: 1, wordBreak: "break-all" }}>{fresh}</code>
                  <button
                    className="btn sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(fresh);
                      toast("Copied");
                    }}
                  >
                    <Icon name="copy" /> Copy
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Created</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="mono faint">{k.prefix}…</td>
                    <td className="faint">{ago(k.created_at)}</td>
                    <td className="faint">{k.last_used_at ? ago(k.last_used_at) : "never"}</td>
                    <td className="r">
                      <button
                        className="btn ghost sm danger"
                        onClick={async () => {
                          if (!confirm(`Revoke “${k.name}”? Pipelines using it will stop uploading.`)) return;
                          await del(`/keys/${k.id}`);
                          void reload();
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && <div className="empty">No keys yet.</div>}
          </div>
        </section>

        <section className="panel reg">
          <div className="panel-head">
            <h3>Environment</h3>
          </div>
          <div className="panel-body stack">
            <div className="row">
              <span className={`dot ${health?.anthropic ? "on" : "sim"}`} />
              <b>{health?.anthropic ? "Claude connected" : "Simulation mode"}</b>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {health?.anthropic
                ? "Claude-powered agents, LLM persona users and LLM-as-judge criteria are enabled."
                : "Set ANTHROPIC_API_KEY in the server environment (or .env) and restart to enable Claude agents, persona users and judges. Simulated specimens and scripted users work without it."}
            </p>
            <div className="divider" />
            <div className="row">
              <span className={`dot ${health?.locked ? "on" : "sim"}`} />
              <b>{health?.locked ? "Workspace locked" : "Workspace open"}</b>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              {health?.locked ? "The dashboard requires the workspace token." : "Anyone who can reach this server can use the lab. Set AGENTLAB_ADMIN_TOKEN before exposing it publicly."}
            </p>
            <div className="divider" />
            <dl className="kv">
              <dt>Server</dt>
              <dd>v{health?.version}</dd>
              <dt>Ingest URL</dt>
              <dd>{origin}/api/ingest</dd>
            </dl>
          </div>
        </section>
      </div>

      <section className="panel reg">
        <div className="panel-head">
          <h3>GitHub Actions</h3>
          <button
            className="right btn sm"
            onClick={() => {
              void navigator.clipboard?.writeText(workflow);
              toast("Workflow copied");
            }}
          >
            <Icon name="copy" /> Copy
          </button>
        </div>
        <div className="panel-body stack">
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Save as <code>.github/workflows/agentlab.yml</code>. The job fails when a gate is missed, writes a Markdown summary to the job page, publishes JUnit, and uploads every trial here.
          </p>
          <pre className="codeblock">{workflow}</pre>
        </div>
      </section>
    </>
  );
}
