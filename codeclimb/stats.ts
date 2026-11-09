// Keep rule, thresholds, gates and the weighted score. Pure functions.

export type Metrics = Record<string, number>;

export function passesGates(metrics: Metrics, gates: Record<string, number>): boolean {
  return Object.entries(gates).every(([k, cap]) => typeof metrics[k] === "number" && metrics[k] <= cap);
}

export function passesThresholds(metrics: Metrics, thresholds: Record<string, number>): boolean {
  return Object.entries(thresholds).every(([k, v]) => typeof metrics[k] === "number" && metrics[k] >= v);
}

const emptyStage = (m: string) => `${m.replace(/\.?output_bytes$/, "") || "the run"} wrote no output`;

/** The stages that wrote nothing: an experiment with one can't be kept, whatever it scores. */
export function emptyStages(cand: Metrics): string[] {
  return Object.keys(cand).filter((m) => /(^|\.)output_bytes$/.test(m) && !cand[m]).map(emptyStage);
}

/**
 * The score that decides a keep: each threshold metric as its share of its threshold, capped at 1,
 * averaged with `weights` (1 where unset). A metric past its threshold adds no more; a missing one adds 0.
 * Null metrics (the starter, never run) score 0.
 */
/**
 * How far two runs' threshold metrics moved apart, each by its weighted share of its threshold: the sum
 * of every metric's move, so moves in opposite directions add up instead of cancelling.
 */
export function weightedMove(a: Metrics | null, b: Metrics | null, thresholds: Record<string, number>, weights: Record<string, number> = {}): number {
  const keys = Object.keys(thresholds);
  if (!keys.length) return 0;
  const share = (m: Metrics | null, k: string) => (typeof m?.[k] === "number" ? Math.min(Math.max(m[k], 0) / thresholds[k], 1) : 0);
  let sum = 0;
  let total = 0;
  for (const k of keys) {
    const w = weights[k] ?? 1;
    sum += w * Math.abs(share(a, k) - share(b, k));
    total += w;
  }
  return sum / total;
}

export function weightedScore(metrics: Metrics | null, thresholds: Record<string, number>, weights: Record<string, number> = {}): number {
  const keys = Object.keys(thresholds);
  if (!metrics || !keys.length) return 0;
  let sum = 0;
  let total = 0;
  for (const k of keys) {
    const w = weights[k] ?? 1;
    const v = metrics[k];
    sum += w * (typeof v === "number" ? Math.min(Math.max(v, 0) / thresholds[k], 1) : 0);
    total += w;
  }
  return sum / total;
}
