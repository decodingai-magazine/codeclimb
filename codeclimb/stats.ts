// Keep rule, thresholds, gates and guardrails. Pure functions.

export type Metrics = Record<string, number>;

export function passesGates(metrics: Metrics, gates: Record<string, number>): boolean {
  return Object.entries(gates).every(([k, cap]) => typeof metrics[k] === "number" && metrics[k] <= cap);
}

export function passesThresholds(metrics: Metrics, thresholds: Record<string, number>): boolean {
  return Object.entries(thresholds).every(([k, v]) => typeof metrics[k] === "number" && metrics[k] >= v);
}

const emptyStage = (m: string) => `${m.replace(/\.?output_bytes$/, "") || "the run"} wrote no output`;

/** The stages that wrote nothing: what still stops a branch when there is no parent's run to compare with. */
export function emptyStages(cand: Metrics): string[] {
  return Object.keys(cand).filter((m) => /(^|\.)output_bytes$/.test(m) && !cand[m]).map(emptyStage);
}

/**
 * Why a branch may not be kept, whatever its other scores: a headline metric fell further below the
 * parent's scores than its margin (or vanished), or a stage that had output now has none.
 */
export function guardrailFailures(cand: Metrics, parent: Metrics, headline: Record<string, number | "ci95">): string[] {
  const failures: string[] = [];
  for (const [m, margin] of Object.entries(headline)) {
    if (typeof parent[m] !== "number") continue;
    const allowed = margin === "ci95" ? (parent[m.replace(/\.mean$/, ".ci95_half")] ?? 0) : margin;
    if (typeof cand[m] !== "number") failures.push(`${m} is gone (parent ${parent[m].toFixed(4)})`);
    else if (cand[m] < parent[m] - allowed - 1e-12) failures.push(`${m} fell to ${cand[m].toFixed(4)} from ${parent[m].toFixed(4)} (margin ${allowed.toFixed(4)})`);
  }
  for (const m of Object.keys(parent)) {
    if (/(^|\.)output_bytes$/.test(m) && parent[m] > 0 && !cand[m]) failures.push(emptyStage(m));
  }
  return failures;
}
