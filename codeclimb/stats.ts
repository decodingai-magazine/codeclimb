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
