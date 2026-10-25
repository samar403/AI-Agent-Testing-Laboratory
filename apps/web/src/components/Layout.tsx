import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, setAuthHandler, setToken, type Agent, type Health, type LightRun, type SuiteListItem, type Usage } from "../api.ts";
import { code, int, useApi, useTheme } from "../lib.tsx";
import { BrandMark, Icon } from "./Icon.tsx";

const HealthCtx = createContext<Health | null>(null);
export const useHealth = () => useContext(HealthCtx);

const CrumbCtx = createContext<(c: Array<{ to?: string; label: string }>) => void>(() => {});
/** Pages call this to set the breadcrumb trail shown in the top bar. */
export function useCrumbs(crumbs: Array<{ to?: string; label: string }>) {
  const set = useContext(CrumbCtx);
  const key = JSON.stringify(crumbs);
  useEffect(() => set(crumbs), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

const NAV = [
  { to: "/lab", icon: "bench", label: "Bench", end: true },
  { to: "/lab/experiments/new", icon: "play", label: "New experiment" },
  { to: "/lab/runs", icon: "plate", label: "Experiments" },
  { to: "/lab/compare", icon: "compare", label: "Compare" },
  { section: "Library" },
  { to: "/lab/agents", icon: "specimen", label: "Agents" },
  { to: "/lab/suites", icon: "suite", label: "Suites" },
  { section: "Workspace" },
  { to: "/lab/billing", icon: "meter", label: "Usage & billing" },
  { to: "/lab/settings", icon: "key", label: "API keys & CI" },
  { to: "/docs", icon: "book", label: "Docs" },
] as const;

export function Layout() {
  const { data: health } = useApi<Health>("/health");
  const { data: usage } = useApi<Usage>("/usage");
  const [crumbs, setCrumbs] = useState<Array<{ to?: string; label: string }>>([]);
  const [palette, setPalette] = useState(false);
  const [needsToken, setNeedsToken] = useState(false);
  const { theme, toggle } = useTheme();
  const loc = useLocation();

  useEffect(() => setAuthHandler(() => setNeedsToken(true)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setPalette(false), [loc.pathname]);

  const used = usage ? usage.trials / usage.plan.includedTrials : 0;

  return (
    <HealthCtx.Provider value={health}>
      <CrumbCtx.Provider value={setCrumbs}>
        <div className="shell">
          <aside className="rail" aria-label="Primary">
            <Link to="/" className="brand" aria-label="AgentLab home">
              <BrandMark />
              <span className="brand-name">
                Agent<i>Lab</i>
              </span>
            </Link>
            {NAV.map((n, i) =>
              "section" in n ? (
                <div key={i} className="rail-section label">
                  {n.section}
                </div>
              ) : (
                <NavLink key={n.to} to={n.to} end={"end" in n ? n.end : false} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
                  <Icon name={n.icon} />
                  <span>{n.label}</span>
                </NavLink>
              ),
            )}
            <div className="rail-foot">
              {usage && (
                <Link to="/lab/billing" className="stack" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span className="label">{usage.plan.name} plan</span>
                    <span className="num faint" style={{ fontSize: 11 }}>
                      {int(usage.trials)} / {int(usage.plan.includedTrials)}
                    </span>
                  </div>
                  <div className="meter" role="progressbar" aria-valuenow={Math.round(used * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ width: `${Math.min(100, used * 100)}%` }} />
                  </div>
                </Link>
              )}
              <div className="row faint" style={{ fontSize: 12 }}>
                <span className={`dot ${health?.anthropic ? "on" : "sim"}`} />
                {health?.anthropic ? "Claude connected" : "Simulation mode"}
              </div>
            </div>
          </aside>
          <div className="main">
            <header className="topbar">
              <nav className="crumbs" aria-label="Breadcrumb">
                <Link to="/lab">Lab</Link>
                {crumbs.map((c, i) => (
                  <span key={i} className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span>/</span>
                    {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="here">{c.label}</span>}
                  </span>
                ))}
              </nav>
              <div className="top-actions">
                <button className="search-btn" onClick={() => setPalette(true)} aria-label="Open command palette">
                  <Icon name="search" />
                  <span>Search agents, suites, runs…</span>
                  <kbd>⌘K</kbd>
                </button>
                <button className="btn icon ghost" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title="Toggle theme">
                  <Icon name={theme === "dark" ? "sun" : "moon"} />
                </button>
                <Link to="/lab/experiments/new" className="btn primary sm">
                  <Icon name="play" /> Run experiment
                </Link>
              </div>
            </header>
            <main className="content">
              <Outlet />
            </main>
          </div>
        </div>
        {palette && <CommandPalette onClose={() => setPalette(false)} />}
        {needsToken && <TokenGate onDone={() => (setNeedsToken(false), window.location.reload())} />}
      </CrumbCtx.Provider>
    </HealthCtx.Provider>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<Array<{ label: string; hint: string; to: string; icon: string }>>([]);

  useEffect(() => {
    void Promise.all([api<Agent[]>("/agents"), api<SuiteListItem[]>("/suites"), api<LightRun[]>("/runs?limit=40")]).then(([agents, suites, runs]) => {
      setItems([
        { label: "New experiment", hint: "action", to: "/lab/experiments/new", icon: "play" },
        { label: "New suite", hint: "action", to: "/lab/suites/new", icon: "plus" },
        { label: "New agent", hint: "action", to: "/lab/agents?new=1", icon: "plus" },
        { label: "Compare versions", hint: "action", to: "/lab/compare", icon: "compare" },
        ...agents.map((a) => ({ label: a.name, hint: `agent · ${a.versions.length} versions`, to: `/lab/agents/${a.id}`, icon: "specimen" })),
        ...suites.map((s) => ({ label: s.name, hint: `suite · ${s.scenarioCount} scenarios`, to: `/lab/suites/${s.id}`, icon: "suite" })),
        ...runs.map((r) => ({ label: `${r.agentLabel} — ${r.suiteName}`, hint: `${code(r.id)}${r.headline ? ` · RI ${r.headline.ri}` : ""}`, to: `/lab/runs/${r.id}`, icon: "plate" })),
        { label: "Usage & billing", hint: "page", to: "/lab/billing", icon: "meter" },
        { label: "API keys & CI", hint: "page", to: "/lab/settings", icon: "key" },
        { label: "Docs", hint: "page", to: "/docs", icon: "book" },
      ]);
    });
  }, []);

  const filtered = useMemo(() => {
    const t = q.toLowerCase().trim();
    return (t ? items.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(t)) : items).slice(0, 12);
  }, [q, items]);

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Jump to…"
          value={q}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(filtered.length - 1, s + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            if (e.key === "Enter" && filtered[sel]) nav(filtered[sel]!.to);
          }}
        />
        <ul role="listbox">
          {filtered.map((i, idx) => (
            <li key={i.to + i.label} className={idx === sel ? "on" : ""} onMouseEnter={() => setSel(idx)} onClick={() => nav(i.to)} role="option" aria-selected={idx === sel}>
              <Icon name={i.icon} />
              {i.label}
              <span className="label">{i.hint}</span>
            </li>
          ))}
          {!filtered.length && <li className="faint">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

function TokenGate({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState("");
  return (
    <div className="palette-backdrop">
      <form
        className="palette panel-body stack"
        style={{ padding: 24 }}
        onSubmit={(e) => {
          e.preventDefault();
          setToken(t.trim());
          onDone();
        }}
      >
        <h3 className="display" style={{ fontSize: 30 }}>
          This lab is <em>locked</em>
        </h3>
        <p className="muted" style={{ margin: 0 }}>
          Enter the workspace token (<code>AGENTLAB_ADMIN_TOKEN</code>) configured on the server.
        </p>
        <input className="input" autoFocus type="password" value={t} onChange={(e) => setT(e.target.value)} placeholder="workspace token" />
        <button className="btn primary" type="submit" disabled={!t.trim()}>
          Unlock
        </button>
      </form>
    </div>
  );
}

export function PageHead({ title, sub, actions, kicker }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {kicker && <div className="label" style={{ marginBottom: 10 }}>{kicker}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="stack" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: i === 0 ? 48 : 120 }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: { message: string; details?: string[] } }) {
  return (
    <div className="panel panel-body" role="alert">
      <div className="row" style={{ color: "var(--fail)" }}>
        <Icon name="alert" /> {error.message}
      </div>
      {!!error.details?.length && (
        <ul className="err-list" style={{ marginTop: 10 }}>
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
