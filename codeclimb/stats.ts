// Keep rule, thresholds, gates, noise floor and overfit test. Pure functions.

export type Metrics = Record<string, number>;

export function passesGates(metrics: Metrics, gates: Record<string, number>): boolean {
  return Object.entries(gates).every(([k, cap]) => typeof metrics[k] === "number" && metrics[k] <= cap);
}

export function passesThresholds(metrics: Metrics, thresholds: Record<string, number>): boolean {
  return Object.entries(thresholds).every(([k, v]) => typeof metrics[k] === "number" && metrics[k] >= v);
}

/** Keep a change only if the primary gains >= max(min_gain, 2σ) over the parent's score (gates checked separately). */
export function beatsParent(primary: number, parentScore: number, minGain: number, sigma: number): boolean {
  return primary - parentScore >= Math.max(minGain, 2 * sigma) - 1e-12;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Sample standard deviation (n − 1). */
export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Deterministic PRNG so a replayed step computes the same SE. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap SE of mean(a) − mean(b), resampling both sets' per-item scores. */
export function bootstrapGapSE(a: number[], b: number[], iterations = 2000, seed = 42): number {
  if (!a.length || !b.length) return 0;
  const rand = mulberry32(seed);
  const resampleMean = (xs: number[]) => {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)];
    return s / xs.length;
  };
  const gaps: number[] = [];
  for (let i = 0; i < iterations; i++) gaps.push(resampleMean(a) - resampleMean(b));
  return stddev(gaps);
}

export interface OverfitResult {
  gap: number;
  se: number;
  overfit: boolean;
}

/**
 * Overfit: optimization − validation primary > overfit_gap and > 2× the
 * bootstrap SE of that gap. `>=` on the SE side: with SE = 0 (a deterministic
 * program on identical items) any gap past overfit_gap counts.
 */
export function overfitTest(
  optPrimary: number,
  valPrimary: number,
  optItems: number[],
  valItems: number[],
  overfitGap: number,
): OverfitResult {
  const gap = optPrimary - valPrimary;
  const se = bootstrapGapSE(optItems, valItems);
  return { gap, se, overfit: gap > overfitGap && gap >= 2 * se };
}
