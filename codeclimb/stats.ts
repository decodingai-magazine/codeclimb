// Keep rule, thresholds, gates and noise floor. Pure functions.

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

/** A lower-is-better metric dropped from `ref` to `cand` by more than `minRel` × `ref` and more than 2σ. */
export function cutsMetric(cand: number, ref: number, minRel: number, sigma: number): boolean {
  return ref - cand > Math.max(minRel * ref, 2 * sigma) + 1e-12;
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
