// A night can go on from an earlier one: same experiment repo, same scenario. It starts from that night's
// kept commit and carries what the night learned: the last feedback and hypothesis, the log of its rounds
// and its rejected diffs. An earlier night's rounds are labeled `<night>-r<round>`, so they read apart from
// the new night's own, which count from 1 again.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { efficiencyMetrics, type NightConfig } from "./config";
import { nightPaths } from "./paths";
import { readRows, type ResultRow } from "./results";
import type { HypothesisLogEntry } from "./reviewer";
import type { Metrics } from "./stats";

/** The start event's `continue`: which night, and an optional direction for every round. */
export interface NightStart {
  from: string;
  direction?: string;
}

interface NightFile {
  startedAt: number;
  config: NightConfig;
  continued?: { from: string; direction: string; prior: HypothesisLogEntry[] };
}

const readNight = (cfg: NightConfig, id: string) => JSON.parse(readFileSync(nightPaths(cfg, id).nightJson, "utf8")) as NightFile;

/** It ran and ended: a running night's commit could still change. */
function ended(cfg: NightConfig, id: string): boolean {
  const p = nightPaths(cfg, id);
  return existsSync(p.nightJson) && (existsSync(p.doneJson) || existsSync(p.stopJson));
}

/** The newest night that ended, among the nights sharing `cfg`'s results. */
export function latestNight(cfg: NightConfig): string {
  const dir = join(nightPaths(cfg, "").root, "nights");
  const ids = (existsSync(dir) ? readdirSync(dir) : []).filter((id) => ended(cfg, id));
  if (!ids.length) throw new Error(`no finished night under ${dir} to continue from`);
  return ids.map((id) => ({ id, at: readNight(cfg, id).startedAt })).sort((a, b) => b.at - a.at)[0].id;
}

/** Throws unless a night of `cfg` can continue from `id`. */
export function checkSource(cfg: NightConfig, id: string): void {
  const p = nightPaths(cfg, id);
  if (!existsSync(p.nightJson)) throw new Error(`no night ${id} under ${p.root}`);
  if (!ended(cfg, id)) throw new Error(`night ${id} hasn't ended: stop it or wait for it first`);
  const scenario = readNight(cfg, id).config.scenario.name;
  if (scenario !== cfg.scenario.name) throw new Error(`night ${id} ran scenario ${scenario}, not ${cfg.scenario.name}`);
}

const experimentRows = (cfg: NightConfig, id: string): ResultRow[] => readRows(cfg.results_path).filter((r) => r.night_id === id && r.kind === "experiment");

/** The night's checkpoint: its last keep, else its starter, which has no scores. */
export function keptOf(cfg: NightConfig, id: string): { expId: string; score: number; metrics: Metrics | null } {
  const row = experimentRows(cfg, id).filter((r) => r.decision === "keep").at(-1);
  return row ? { expId: row.exp_id, score: row.metrics[cfg.primary_metric] ?? 0, metrics: row.metrics } : { expId: `${id}-r0-starter`, score: 0, metrics: null };
}

/** The night's last review: what its next round would have started with. */
export function lastReview(cfg: NightConfig, id: string): { feedback: string; hypothesis: string | null } {
  const { reviewJson } = nightPaths(cfg, id);
  const rounds = [...new Set(experimentRows(cfg, id).map((r) => r.round))].sort((a, b) => b - a);
  const round = rounds.find((r) => existsSync(reviewJson(r)));
  if (round === undefined) return { feedback: "", hypothesis: null };
  const { feedback, hypothesis } = JSON.parse(readFileSync(reviewJson(round), "utf8")) as { feedback: string; hypothesis: string };
  return { feedback, hypothesis: hypothesis || null };
}

/** Every round up to and including night `id`, rebuilt from its rows: a night keeps its log only in memory. */
export function priorLog(cfg: NightConfig, id: string): HypothesisLogEntry[] {
  const metricNames = [...efficiencyMetrics(cfg), ...Object.keys(cfg.scenario.headline)];
  const { reviewJson } = nightPaths(cfg, id);
  const rows = experimentRows(cfg, id);
  // A baseline row (round 0) holds the commit the night started from, a repaired round has two rows: the last stands.
  const rounds = [...new Map(rows.map((r) => [r.round, r])).values()].sort((a, b) => a.round - b.round);
  let parent: Metrics | null = null;
  const entries = rounds.flatMap((r): HypothesisLogEntry[] => {
    if (r.round === 0) {
      parent = r.metrics;
      return [];
    }
    const before: Metrics | null = parent;
    const scored = metricNames.filter((m) => r.decision !== "error" && typeof r.metrics[m] === "number");
    const moved = before
      ? { deltas: Object.fromEntries(scored.flatMap((m) => (typeof before[m] === "number" ? [[m, r.metrics[m] - before[m]]] : []))) }
      : { scores: Object.fromEntries(scored.map((m) => [m, r.metrics[m]])) };
    const review = existsSync(reviewJson(r.round)) ? (JSON.parse(readFileSync(reviewJson(r.round), "utf8")) as { keep_reason?: string }) : {};
    if (r.decision === "keep") parent = r.metrics;
    const P = cfg.primary_metric;
    return [{
      round: r.round, label: `${id}-r${r.round}`, hypothesis: r.hypothesis ?? "(unknown)",
      deltaPrimary: (r.metrics[P] ?? 0) - (before?.[P] ?? 0), ...moved, decision: r.decision,
      reason: r.unchanged ? "no code change" : review.keep_reason ?? "",
    }];
  });
  return [...(readNight(cfg, id).continued?.prior ?? []), ...entries];
}

/** Copies night `from`'s rejected diffs into `nightId`'s bundle, under the labels `priorLog` gives them. */
export function carryRejected(cfg: NightConfig, from: string, nightId: string): void {
  const source = join(nightPaths(cfg, from).bundleDir, "history");
  if (!existsSync(source)) return;
  const target = join(nightPaths(cfg, nightId).bundleDir, "history");
  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(source)) copyFileSync(join(source, f), join(target, /^r\d+\.diff$/.test(f) ? `${from}-${f}` : f));
}
