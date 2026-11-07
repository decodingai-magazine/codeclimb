// Everything the report shows, read from what a night leaves on disk:
// results.jsonl (all nights), nights/<id>/{night,done}.json, the persisted
// reviews, and per-experiment diffs from experiments.git. Derived views
// (kept lineage, convergence, heatmaps) are computed in the page itself.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { efficiencyMetrics, type NightConfig } from "../config";
import { ExperimentRepo } from "../git";
import { readRows, type ResultRow, rowSpend } from "../results";

export type ReportReview = { round: number; model?: string; feedback: string; hypothesis?: string };

export type ReportNight = {
  id: string;
  startedAt: number | null;
  finishedAt: string | null;
  config: Pick<NightConfig, "primary_metric" | "thresholds" | "gates" | "max_rounds" | "model" | "reviewer_model" | "budget_usd"> & {
    /** Optimized standard metrics (lower is better); empty for nights before they existed. */
    objectives: string[];
    /** The scenario's headline metrics and stage names; empty for nights before stages. */
    headline: string[];
    stages: string[];
  } | null;
  done: {
    stop_reason: string;
    rounds: number;
    kept: { exp_id: string; commit: string; dev_score: number };
    spend_usd: number;
  } | null;
  /** Night spend: done.json's figure, else coder + program per row plus each round's reviewer cost once. */
  spend_usd: number;
  reviews: ReportReview[];
  rows: ResultRow[];
};

export type ReportData = {
  generatedAt: string;
  title: string;
  resultsPath: string;
  primaryMetric: string;
  nights: ReportNight[];
  /** exp_id → `git diff --stat -p` against its parent (capped). */
  diffs: Record<string, string>;
};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** `reviewer_usd` is the round's review repeated on each of its rows: count it once per round. */
export function nightSpend(rows: ResultRow[]): number {
  const reviewer = new Map<number, number>();
  let total = 0;
  for (const r of rows) {
    total += rowSpend(r);
    reviewer.set(r.round, Math.max(reviewer.get(r.round) ?? 0, r.reviewer_usd));
  }
  for (const v of reviewer.values()) total += v;
  return Math.round(total * 10_000) / 10_000;
}

export async function buildReportData(resultsPath: string, opts: { title?: string; diffs?: boolean } = {}): Promise<ReportData> {
  const root = dirname(resultsPath);
  const rows = readRows(resultsPath);
  const nightIds = [...new Set(rows.map((r) => r.night_id))];
  const nights: ReportNight[] = nightIds.map((id) => {
    const dir = join(root, "nights", id);
    const night = readJson<{ startedAt?: number; config?: NightConfig }>(join(dir, "night.json"));
    const done = readJson<ReportNight["done"] & { finished_at?: string }>(join(dir, "done.json"));
    const reviewsDir = join(dir, "reviews");
    const reviews = existsSync(reviewsDir)
      ? readdirSync(reviewsDir)
          .filter((f) => /^r\d+\.json$/.test(f))
          .map((f) => readJson<ReportReview>(join(reviewsDir, f)))
          .filter((r): r is ReportReview => !!r)
          .sort((a, b) => a.round - b.round)
      : [];
    const nightRows = rows.filter((r) => r.night_id === id);
    const c = night?.config;
    return {
      id,
      startedAt: night?.startedAt ?? null,
      finishedAt: done?.finished_at ?? null,
      config: c
        ? {
            primary_metric: c.primary_metric, thresholds: c.thresholds, gates: c.gates,
            max_rounds: c.max_rounds, model: c.model, reviewer_model: c.reviewer_model, budget_usd: c.budget_usd,
            // Nights before standard metrics have no `standard_metrics`: nothing was optimized besides the primary.
            objectives: c.standard_metrics ? efficiencyMetrics(c) : [],
            // Nights before the weighted score kept a map of metric to drop margin.
            headline: Array.isArray(c.scenario?.headline) ? c.scenario.headline : Object.keys(c.scenario?.headline ?? {}),
            stages: c.scenario?.stages?.map((s) => s.name) ?? [],
          }
        : null,
      done: done
        ? { stop_reason: done.stop_reason, rounds: done.rounds, kept: done.kept, spend_usd: done.spend_usd }
        : null,
      spend_usd: done?.spend_usd ?? nightSpend(nightRows),
      reviews: reviews.map(({ round, model, feedback, hypothesis }) => ({ round, model, feedback, hypothesis })),
      rows: nightRows,
    };
  });
  nights.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

  const diffs: Record<string, string> = {};
  const gitDir = join(root, "experiments.git");
  if (opts.diffs !== false && existsSync(gitDir)) {
    const repo = new ExperimentRepo(gitDir);
    for (const r of rows) {
      if (r.kind !== "experiment" || !r.commit || !r.parent_id || diffs[r.exp_id] !== undefined) continue;
      diffs[r.exp_id] = await repo.diff(r.parent_id, r.exp_id).catch(() => "");
    }
  }

  const primaryMetric = nights.findLast((n) => n.config)?.config?.primary_metric ?? "accuracy";
  return {
    generatedAt: new Date().toISOString(),
    title: opts.title ?? basename(root),
    resultsPath,
    primaryMetric,
    nights,
    diffs,
  };
}
