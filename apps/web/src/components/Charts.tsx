import { useMemo, useRef, useState } from "react";
import { int, pct, useTip } from "../lib.tsx";

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)"];

interface Series {
  name: string;
  color: string;
  points: Array<{ x: number; y: number; label?: string }>;
}

/**
 * Minimal responsive line chart: one y-axis, recessive grid, 2px lines, ≥8px markers,
 * direct labels at line ends, crosshair + tooltip on hover.
 */
export function LineChart({
  series,
  height = 220,
  yMax = 1,
  yFormat = (v: number) => pct(v),
  xFormat = (v: number) => String(v),
  xTicks,
  area,
}: {
  series: Series[];
  height?: number;
  yMax?: number;
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  xTicks?: number[];
  area?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const tip = useTip();
  const W = 640;
  const pad = { l: 44, r: 92, t: 14, b: 28 };
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const sx = (x: number) => pad.l + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - y / yMax) * (height - pad.t - pad.b);
  const ticks = xTicks ?? [...new Set(xs)].sort((a, b) => a - b);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const allX = [...new Set(xs)].sort((a, b) => a - b);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const nearest = allX.reduce((best, x) => (Math.abs(sx(x) - px) < Math.abs(sx(best) - px) ? x : best), allX[0]!);
    setHoverX(nearest);
    tip.show(
      e,
      <>
        <div className="t">{xFormat(nearest)}</div>
        {series.map((s) => {
          const p = s.points.find((q) => q.x === nearest);
          return p ? (
            <div className="row" key={s.name}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <i style={{ width: 10, height: 3, background: s.color, borderRadius: 2, display: "inline-block" }} />
                {s.name}
              </span>
              <b>{yFormat(p.y)}</b>
            </div>
          ) : null;
        })}
      </>,
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <svg ref={ref} className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
            <text x={pad.l - 8} y={sy(t) + 3.5} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={height - 8} textAnchor="middle">
            {xFormat(t)}
          </text>
        ))}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
        {hoverX !== null && <line x1={sx(hoverX)} x2={sx(hoverX)} y1={pad.t} y2={sy(0)} stroke="var(--line-2)" strokeDasharray="3 3" />}
        {series.map((s) => {
          const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              {area && s.points.length > 1 && (
                <path d={`${d} L${sx(last!.x)},${sy(0)} L${sx(s.points[0]!.x)},${sy(0)} Z`} fill={s.color} opacity={0.12} />
              )}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {s.points.map((p) => (
                <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r={hoverX === p.x ? 5 : 4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
              ))}
              {last && (
                <text x={sx(last.x) + 10} y={sy(last.y) + 4} style={{ fill: "var(--ink-2)" }}>
                  {s.name.length > 13 ? s.name.slice(0, 12) + "…" : s.name}
                </text>
              )}
            </g>
          );
        })}
        <rect className="hit" x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={height - pad.t - pad.b} onMouseMove={onMove} onMouseLeave={() => (setHoverX(null), tip.hide())} />
      </svg>
      {tip.node}
    </div>
  );
}

/** Reliability decay: pass^k for k = 1..K. The steeper the drop, the less a user can rely on the agent. */
export function DecayCurve({ curves, height = 220 }: { curves: Array<{ name: string; decay: number[] }>; height?: number }) {
  const series = curves.map((c, i) => ({ name: c.name, color: SERIES[i % SERIES.length]!, points: c.decay.map((y, k) => ({ x: k + 1, y })) }));
  const K = Math.max(...curves.map((c) => c.decay.length));
  const ticks = Array.from({ length: K }, (_, i) => i + 1).filter((k) => K <= 12 || k % 2 === 1 || k === K);
  return (
    <div className="stack" style={{ gap: 8 }}>
      {curves.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <LineChart series={series} height={height} area={curves.length === 1} xFormat={(k) => `k=${k}`} xTicks={ticks} />
    </div>
  );
}

/** Daily usage bars (single series). */
export function UsageBars({ daily, days, height = 160 }: { daily: Array<{ day: number; trials: number }>; days: number; height?: number }) {
  const tip = useTip();
  const W = 640;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const byDay = new Map(daily.map((d) => [d.day, d.trials]));
  const max = Math.max(10, ...daily.map((d) => d.trials));
  const bw = (W - pad.l - pad.r) / days;
  const sy = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const yTicks = useMemo(() => [0, 0.5, 1].map((f) => Math.round(f * max)), [max]);
  return (
    <div style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Trials per day this billing period">
        {yTicks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
            <text x={pad.l - 6} y={sy(t) + 3.5} textAnchor="end">
              {int(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: days }, (_, d) => {
          const v = byDay.get(d) ?? 0;
          const x = pad.l + d * bw + 1;
          const h = sy(0) - sy(v);
          return (
            <g key={d}>
              {v > 0 && <rect x={x} y={sy(v)} width={Math.max(2, bw - 2)} height={h} rx={Math.min(4, (bw - 2) / 2)} fill="var(--s1)" />}
              <rect
                className="hit"
                x={x - 1}
                y={pad.t}
                width={bw}
                height={height - pad.t - pad.b}
                onMouseMove={(e) => tip.show(e, <><div className="t">Day {d + 1}</div><div className="row">trials <b>{int(v)}</b></div></>)}
                onMouseLeave={tip.hide}
              />
              {(d === 0 || (d + 1) % 5 === 0) && (
                <text x={x + bw / 2} y={height - 7} textAnchor="middle">
                  {d + 1}
                </text>
              )}
            </g>
          );
        })}
        <line className="axis" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
      </svg>
      {tip.node}
    </div>
  );
}

/** Tiny inline sparkline for tables (no axes; the cell's number carries the value). */
export function Sparkline({ values, width = 90, height = 24, max = 100 }: { values: number[]; width?: number; height?: number; max?: number }) {
  if (values.length < 2) return <span className="faint">—</span>;
  const sx = (i: number) => 3 + (i / (values.length - 1)) * (width - 6);
  const sy = (v: number) => 3 + (1 - v / max) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${sx(i)},${sy(v)}`).join(" ");
  const last = values[values.length - 1]!;
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--s1)" strokeWidth={1.6} />
      <circle cx={sx(values.length - 1)} cy={sy(last)} r={2.6} fill="var(--s1)" />
    </svg>
  );
}

export function Ruler({ value }: { value: number }) {
  return (
    <div className="ruler" aria-label={`Reliability index ${value} of 100`}>
      <div className="track" />
      <div className="needle" style={{ left: `${Math.max(0, Math.min(100, value))}%` }} />
      <div className="ticks">
        {[0, 25, 50, 75, 100].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
