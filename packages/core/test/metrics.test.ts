import { describe, expect, it } from "vitest";
import { compareRuns, fisherExact, passAtK, passHatK, reliabilityIndex, wilson } from "../src/metrics.ts";
import type { RunSummary } from "../src/types.ts";

describe("reliability statistics", () => {
  it("pass@k and pass^k bracket the pass rate", () => {
    expect(passAtK(10, 5, 1)).toBeCloseTo(0.5);
    expect(passHatK(10, 5, 1)).toBeCloseTo(0.5);
    expect(passAtK(10, 5, 3)).toBeGreaterThan(0.5);
    expect(passHatK(10, 5, 3)).toBeCloseTo((5 * 4 * 3) / (10 * 9 * 8));
    expect(passHatK(4, 4, 4)).toBe(1);
    expect(passAtK(4, 0, 4)).toBe(0);
  });

  it("wilson interval contains the point estimate and stays in [0,1]", () => {
    const [lo, hi] = wilson(9, 10);
    expect(lo).toBeLessThan(0.9);
    expect(hi).toBeGreaterThan(0.9);
    expect(hi).toBeLessThanOrEqual(1);
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it("fisher exact matches known values", () => {
    // Classic tea-tasting table [[3,1],[1,3]] → two-sided p ≈ 0.486
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
    expect(fisherExact(12, 0, 0, 12)).toBeLessThan(0.0001);
    expect(fisherExact(5, 5, 5, 5)).toBeCloseTo(1, 5);
  });

  it("reliability index weights pass rate, accuracy and consistency", () => {
    expect(reliabilityIndex(1, 1, 1)).toBe(100);
    expect(reliabilityIndex(0, 1, 1)).toBe(40);
  });

  it("flags a significant regression", () => {
    const mk = (passes: number): RunSummary =>
      ({
        trials: 24, passes, passRate: passes / 24, k: 12, passHatK: 0, toolCallAccuracy: 1, flakyScenarios: 0, reliabilityIndex: 0,
        latency: { p50: 0, p95: 0, mean: 0 }, costUsd: 0,
        scenarios: [{ scenarioId: "s", title: "S", trials: 24, passes, passRate: passes / 24 }],
      }) as unknown as RunSummary;
    const cmp = compareRuns(mk(23), mk(10));
    expect(cmp.overall.verdict).toBe("regression");
    expect(cmp.regressions).toBe(1);
    expect(compareRuns(mk(12), mk(12)).overall.verdict).toBe("unchanged");
  });
});
