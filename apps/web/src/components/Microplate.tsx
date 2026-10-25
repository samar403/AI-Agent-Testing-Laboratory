import type { Cell } from "../api.ts";
import { ms, pct, ROWS, useTip } from "../lib.tsx";

export function wellTone(c: Pick<Cell, "passed" | "score">): "pass" | "partial" | "fail" {
  return c.passed ? "pass" : c.score >= 0.5 ? "partial" : "fail";
}
const GLYPH = { pass: "✓", partial: "◐", fail: "✕" };

/**
 * The signature visual: every trial is a well on a microplate. Rows are scenarios (A, B, C…),
 * columns are repeated trials. A healthy agent is a solid plate of one colour; flakiness shows up
 * as a speckled row, and systematic failures as a red column or row.
 */
export function Microplate({
  scenarios,
  trials,
  cells,
  running,
  onSelect,
  selectedId,
  compact,
}: {
  scenarios: Array<{ id: string; title: string }>;
  trials: number;
  cells: Cell[];
  running?: boolean;
  onSelect?: (cell: Cell) => void;
  selectedId?: string;
  compact?: boolean;
}) {
  const tip = useTip();
  const byKey = new Map(cells.map((c) => [`${c.scenarioId}:${c.trialIndex}`, c]));
  const size = compact ? 18 : trials > 16 ? 22 : trials > 12 ? 26 : 30;
  const cols = `18px repeat(${trials}, ${size}px) ${compact ? "" : "minmax(120px, 1fr) 56px"}`;

  return (
    <div className="plate" style={{ ["--well-size" as string]: `${size}px` }}>
      <div className="plate-grid" style={{ gridTemplateColumns: cols }} role="grid" aria-label="Trial results microplate">
        <span />
        {Array.from({ length: trials }, (_, i) => (
          <span key={i} className="plate-col-label">
            {i + 1}
          </span>
        ))}
        {!compact && (
          <>
            <span className="plate-col-label" style={{ textAlign: "left", paddingLeft: 10 }}>
              SCENARIO
            </span>
            <span className="plate-col-label" style={{ textAlign: "right" }}>
              PASS
            </span>
          </>
        )}
        {scenarios.map((s, r) => {
          const row = Array.from({ length: trials }, (_, i) => byKey.get(`${s.id}:${i}`));
          const done = row.filter(Boolean) as Cell[];
          const passes = done.filter((c) => c.passed).length;
          const rate = done.length ? passes / done.length : null;
          return (
            <Row key={s.id}>
              <span className="plate-row-label">{ROWS[r % 26]}</span>
              {row.map((c, i) =>
                c ? (
                  <button
                    key={i}
                    type="button"
                    className={`well filled ${wellTone(c)} ${selectedId === c.id ? "selected" : ""}`}
                    aria-label={`${ROWS[r % 26]}${i + 1} ${s.title} trial ${i + 1}: ${c.passed ? "passed" : "failed"}`}
                    onClick={() => onSelect?.(c)}
                    onMouseMove={(e) =>
                      tip.show(
                        e,
                        <>
                          <div className="t">
                            {ROWS[r % 26]}
                            {i + 1} · {s.title}
                          </div>
                          <div className="row">
                            result <b style={{ color: `var(--${wellTone(c) === "partial" ? "warn" : wellTone(c)})` }}>{c.passed ? "PASS" : "FAIL"}</b>
                          </div>
                          <div className="row">
                            score <b>{pct(c.score)}</b>
                          </div>
                          <div className="row">
                            latency <b>{ms(c.metrics.agentLatencyMs)}</b>
                          </div>
                          <div className="row">
                            tool calls <b>{c.metrics.toolCalls}</b>
                          </div>
                          {c.metrics.invalidToolCalls + c.metrics.unknownToolCalls > 0 && (
                            <div className="row">
                              bad calls <b style={{ color: "var(--fail)" }}>{c.metrics.invalidToolCalls + c.metrics.unknownToolCalls}</b>
                            </div>
                          )}
                          {c.metrics.faultsInjected > 0 && (
                            <div className="row">
                              faults injected <b style={{ color: "var(--warn)" }}>{c.metrics.faultsInjected}</b>
                            </div>
                          )}
                        </>,
                      )
                    }
                    onMouseLeave={tip.hide}
                  >
                    <span className="glyph">{GLYPH[wellTone(c)]}</span>
                  </button>
                ) : (
                  <span key={i} className={`well ${running ? "pending" : ""}`} aria-label="pending" />
                ),
              )}
              {!compact && (
                <>
                  <span className="plate-row-title" title={s.title}>
                    {s.title}
                  </span>
                  <span className="plate-row-rate" style={{ color: rate === null ? "var(--ink-3)" : rate === 1 ? "var(--pass)" : rate === 0 ? "var(--fail)" : "var(--warn)" }}>
                    {rate === null ? "—" : pct(rate)}
                  </span>
                </>
              )}
            </Row>
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function PlateLegend() {
  return (
    <div className="plate-legend">
      <span>
        <i style={{ background: "var(--pass)" }} /> ✓ passed every critical criterion
      </span>
      <span>
        <i style={{ background: "var(--warn)" }} /> ◐ failed, but scored ≥ 50%
      </span>
      <span>
        <i style={{ background: "var(--fail)" }} /> ✕ failed
      </span>
    </div>
  );
}
