// Views derived from one night's report data: experiments in order, the kept lineage per round,
// the test row, and the counts the KPI tiles show. Ported from codeclimb/report/client.js.
import type { ReportNight } from "../../../../codeclimb/report/data";
import type { ResultRow } from "../../../../codeclimb/results";

export type Row = ResultRow;
export type LineageStep = { round: number; exp: Row | null; keptThisRound: boolean };

export const branchOf = (id: string) => Number(/-b(\d+)$/.exec(id)?.[1] ?? 0);
export const shortId = (id: string, night: string) => id.replace(`${night}-`, "");

export function derive(night: ReportNight, primary: string) {
  const rows = night.rows;
  const exps = rows
    .filter((r) => r.kind === "experiment")
    .sort((a, b) => a.round - b.round || branchOf(a.exp_id) - branchOf(b.exp_id));
  const byId = new Map(exps.map((e) => [e.exp_id, e]));
  const rounds = exps.reduce((m, e) => Math.max(m, e.round), 0);
  const lineage: LineageStep[] = [];
  let cur: Row | null = null;
  for (let r = 1; r <= rounds; r++) {
    const k = exps.find((e) => e.round === r && e.decision === "keep");
    if (k) cur = k;
    lineage.push({ round: r, exp: cur, keptThisRound: !!k });
  }
  const test = rows.filter((r) => r.kind === "test");
  const score = (e: Row | null | undefined): number | null => (e?.metrics ? e.metrics[primary] ?? null : null);
  const parentScore = (e: Row): number | null => {
    const p = e.parent_id ? byId.get(e.parent_id) : undefined;
    return p ? score(p) : null;
  };
  const threshold = night.config?.thresholds?.[primary] ?? null;
  const bestId = night.done?.kept?.exp_id ?? cur?.exp_id ?? exps[0]?.exp_id ?? null;
  const counts = { keep: 0, revert: 0, error: 0 };
  for (const e of exps) counts[e.decision] += 1;
  const durS = night.startedAt && night.finishedAt ? (Date.parse(night.finishedAt) - night.startedAt) / 1000 : null;
  return {
    rows, exps, byId, rounds, lineage, score, parentScore, threshold, bestId, counts, durS, cur,
    keptRounds: lineage.filter((l) => l.keptThisRound).length,
    lastTest: test.at(-1) ?? null,
  };
}
export type Derived = ReturnType<typeof derive>;

/** Per-family accuracy metrics (`acc_<family>`) present in any row. */
export function families(v: Derived): string[] {
  const fams: string[] = [];
  for (const r of v.rows) for (const k of Object.keys(r.metrics ?? {})) if (k.startsWith("acc_") && !fams.includes(k)) fams.push(k);
  return fams;
}

/** Round axis ticks at 1, 2, 2.5 or 5 times a power of ten. */
export function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(span / n)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= n) ?? 10 * mag;
  const out: number[] = [];
  for (let x = Math.ceil(lo / step - 1e-9) * step; x <= hi + 1e-9; x += step) out.push(Number(x.toFixed(6)));
  return out;
}
