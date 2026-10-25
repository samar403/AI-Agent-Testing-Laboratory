import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api.ts";

// ── Data fetching ───────────────────────────────────────────────────────────────────────────────
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e as ApiError);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}

// ── Toasts ──────────────────────────────────────────────────────────────────────────────────────
interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}
const ToastCtx = createContext<(text: string, kind?: Toast["kind"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ── Tooltip ─────────────────────────────────────────────────────────────────────────────────────
export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }), []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div className="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 330), top: Math.min(tip.y + 14, window.innerHeight - 160) }}>
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────────
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
export const usd = (v: number) => (v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
export const int = (v: number) => v.toLocaleString("en-US");

export function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Short specimen code from an id, e.g. run_x7Q2fA → RUN·X7Q2 */
export function code(id: string): string {
  const i = id.indexOf("_");
  const rest = id.slice(i + 1).replace(/[^A-Za-z0-9]/g, "");
  return `${id.slice(0, i).toUpperCase()}·${rest.slice(0, 4).toUpperCase()}`;
}

export function riTone(ri: number): "pass" | "warn" | "fail" {
  return ri >= 85 ? "pass" : ri >= 65 ? "warn" : "fail";
}

export const ROWS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const t = document.documentElement.dataset.theme;
    if (t === "light" || t === "dark") return t;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("agentlab.theme", next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  };
  return { theme, toggle };
}

export function download(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
