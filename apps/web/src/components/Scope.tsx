import type { TraceEvent } from "@agentlab/core/browser";
import { ms, useTip } from "../lib.tsx";

const LANES = [
  { key: "user", label: "USER", color: "var(--s1)" },
  { key: "agent", label: "AGENT", color: "var(--accent)" },
  { key: "tool", label: "TOOLS", color: "var(--s3)" },
] as const;

/**
 * Oscilloscope view of one trial: a phosphor trace on top (agent activity as pulses, faults as
 * spikes) and three swim-lanes below (user, agent, tools) on a shared time axis.
 */
export function Scope({ trace, onPick }: { trace: TraceEvent[]; onPick?: (i: number) => void }) {
  const tip = useTip();
  const W = 960;
  const H = 250;
  const padL = 64;
  const padR = 16;
  const end = Math.max(1, ...trace.map((e) => e.t + (e.d ?? 0)));
  const sx = (t: number) => padL + (t / end) * (W - padL - padR);
  const base = 66;

  // Phosphor trace: rectangular pulses for agent steps, smaller for tool calls, spikes for faults.
  const pts: Array<[number, number]> = [[padL, base]];
  const pulses = trace
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.type === "agent" || e.type === "tool_call")
    .sort((a, b) => a.e.t - b.e.t);
  for (const { e } of pulses) {
    const x0 = sx(e.t);
    const x1 = Math.max(x0 + 2, sx(e.t + (e.d ?? 0)));
    const h = e.type === "agent" ? 44 : 22;
    pts.push([x0, base], [x0 + 1, base - h], [x1 - 1, base - h + (e.type === "agent" ? 6 : 2)], [x1, base]);
  }
  pts.push([W - padR, base]);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

  const laneY = (k: string) => 104 + LANES.findIndex((l) => l.key === k) * 40;
  const laneOf = (e: TraceEvent) => (e.type === "user" ? "user" : e.type === "agent" ? "agent" : e.type === "tool_call" ? "tool" : null);

  const hover = (ev: React.MouseEvent, e: TraceEvent) =>
    tip.show(
      ev,
      <>
        <div className="t">{e.type.replace("_", " ")}</div>
        <div style={{ color: "var(--ink-2)", maxWidth: 290, whiteSpace: "pre-wrap" }}>{e.label.slice(0, 220)}</div>
        <div className="row" style={{ marginTop: 6 }}>
          at <b>{ms(e.t)}</b>
        </div>
        {e.d !== undefined && (
          <div className="row">
            duration <b>{ms(e.d)}</b>
          </div>
        )}
      </>,
    );

  const ticks = Array.from({ length: 6 }, (_, i) => (end * i) / 5);
  return (
    <div className="scope">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img" aria-label="Trial timeline">
        <text x={12} y={base - 18}>
          SIGNAL
        </text>
        <path className="trace-path" d={d} />
        {trace.map((e, i) =>
          e.type === "fault" || e.type === "invalid_call" ? (
            <g key={`f${i}`} onMouseMove={(ev) => hover(ev, e)} onMouseLeave={tip.hide} style={{ cursor: "help" }}>
              <line x1={sx(e.t)} x2={sx(e.t)} y1={base} y2={14} stroke="var(--fail)" strokeWidth={2} />
              <circle cx={sx(e.t)} cy={14} r={4.5} fill="var(--fail)" />
              <rect x={sx(e.t) - 7} y={6} width={14} height={base - 6} fill="transparent" />
            </g>
          ) : null,
        )}
        {LANES.map((l) => (
          <g key={l.key}>
            <line x1={padL} x2={W - padR} y1={laneY(l.key) + 12} y2={laneY(l.key) + 12} stroke="var(--line)" />
            <text x={12} y={laneY(l.key) + 16}>
              {l.label}
            </text>
          </g>
        ))}
        {trace.map((e, i) => {
          const lane = laneOf(e);
          if (!lane) return null;
          const color = LANES.find((l) => l.key === lane)!.color;
          const x = sx(e.t);
          const w = Math.max(e.type === "user" ? 8 : 4, sx(e.t + (e.d ?? 0)) - x);
          return (
            <rect
              key={i}
              x={x}
              y={laneY(lane)}
              width={w}
              height={24}
              rx={4}
              fill={color}
              opacity={0.85}
              style={{ cursor: onPick ? "pointer" : "default" }}
              onClick={() => onPick?.(i)}
              onMouseMove={(ev) => hover(ev, e)}
              onMouseLeave={tip.hide}
            />
          );
        })}
        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={H - 4} textAnchor="middle">
            {ms(t)}
          </text>
        ))}
      </svg>
      {tip.node}
    </div>
  );
}
