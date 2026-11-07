// A night that ended can go on: more rounds under the same id, on the same experiments and results. It
// picks up at its kept commit with its last feedback and hypothesis, its log of rounds and its rejected
// diffs, and its round numbers go on from the last. `reopenNight` runs before the start event goes out, so
// from then on the night reads as running, and a second continue is refused.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import { nightPaths } from "./paths";
import { nightSpend } from "./report/data";
import { readRows, type ResultRow } from "./results";
import type { HypothesisLogEntry } from "./reviewer";
import type { Metrics } from "./stats";

/** The start event's `continue`. */
export interface NightStart {
  /** For every new round. */
  direction?: string;
  /** The scorers changed since the kept commit was scored: its recorded scores can't be compared. */
  rescore: boolean;
}

interface NightFile {
  startedAt: number;
  config: NightConfig;
  metric_script_sha256: Record<string, string | null>;
  /** The night's budget for one run: a continuation adds it to what the night has spent. */
  run_budget_usd?: number;
}

const readNight = (cfg: NightConfig, id: string) => JSON.parse(readFileSync(nightPaths(cfg, id).nightJson, "utf8")) as NightFile;

function sha256(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

/** Every file under `dir`, relative to it, sorted. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => !f.split("/").includes("__pycache__") && statSync(join(dir, f)).isFile())
    .sort();
}

/** What scores a night, by hash: the scenario's evaluators, gold and scenario.yaml. */
export function scoringHashes(cfg: NightConfig): Record<string, string | null> {
  const scored = ["scenario.yaml", ...["evaluators", "gold"].flatMap((d) => filesUnder(join(cfg.scenario_dir, d)).map((f) => join(d, f)))];
  return Object.fromEntries(scored.map((f) => [relative(cfg.base_dir, join(cfg.scenario_dir, f)), sha256(join(cfg.scenario_dir, f))]));
}

/** It ran and ended: a running night's commit could still change. */
function ended(cfg: NightConfig, id: string): boolean {
  const p = nightPaths(cfg, id);
  return existsSync(p.nightJson) && (existsSync(p.doneJson) || existsSync(p.stopJson));
}

/** The newest night that ended, among the nights sharing `cfg`'s results. */
export function latestNight(cfg: NightConfig): string {
  const dir = join(nightPaths(cfg, "").root, "nights");
  const ids = (existsSync(dir) ? readdirSync(dir) : []).filter((id) => ended(cfg, id));
  if (!ids.length) throw new Error(`no finished night under ${dir} to continue`);
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

/** The night's last round so far. */
export const lastRound = (cfg: NightConfig, id: string): number => Math.max(0, ...experimentRows(cfg, id).map((r) => r.round));

/** What the night has spent so far. */
export const spentBy = (cfg: NightConfig, id: string): number => nightSpend(readRows(cfg.results_path).filter((r) => r.night_id === id));

/**
 * Makes an ended night a running one again, with `rounds` more rounds and the budget of one more run.
 * Returns the config to start it with. Its done or stop file stays beside the night, under its last round.
 */
export function reopenNight(cfg: NightConfig, id: string, rounds: number = cfg.max_rounds): { config: NightConfig; rescore: boolean } {
  checkSource(cfg, id);
  const paths = nightPaths(cfg, id);
  const night = readNight(cfg, id);
  const last = lastRound(cfg, id);
  const hashes = scoringHashes(cfg);
  const same = Object.keys({ ...hashes, ...night.metric_script_sha256 }).every((f) => hashes[f] === night.metric_script_sha256[f]);
  const rescore = !same && keptOf(cfg, id).metrics !== null;
  const runBudget = night.run_budget_usd ?? cfg.budget_usd.night;
  const config: NightConfig = {
    ...cfg, max_rounds: last + rounds + (rescore ? 1 : 0), budget_usd: { ...cfg.budget_usd, night: spentBy(cfg, id) + runBudget },
  };
  for (const [file, name] of [[paths.doneJson, "done"], [paths.stopJson, "stop"]]) {
    if (existsSync(file)) renameSync(file, join(paths.nightDir, `${name}-r${last}.json`));
  }
  const deadlineMs = resolveDeadline(cfg.deadline, Date.now());
  writeFileSync(paths.nightJson, JSON.stringify({ ...night, deadlineMs, config, metric_script_sha256: hashes, run_budget_usd: runBudget }, null, 2));
  return { config, rescore };
}

/** Every round of night `id`, rebuilt from its rows: a night keeps its log only in memory. */
export function priorLog(cfg: NightConfig, id: string): HypothesisLogEntry[] {
  const metricNames = [...efficiencyMetrics(cfg), ...cfg.scenario.headline];
  const { reviewJson } = nightPaths(cfg, id);
  const rows = experimentRows(cfg, id);
  // A repaired round has two rows: the last stands.
  const rounds = [...new Map(rows.map((r) => [r.round, r])).values()].sort((a, b) => a.round - b.round);
  let parent: Metrics | null = null;
  let parentScore = 0;
  return rounds.map((r): HypothesisLogEntry => {
    const before: Metrics | null = parent;
    const scoreBefore = parentScore;
    const scored = metricNames.filter((m) => r.decision !== "error" && typeof r.metrics[m] === "number");
    const moved = before
      ? { deltas: Object.fromEntries(scored.flatMap((m) => (typeof before[m] === "number" ? [[m, r.metrics[m] - before[m]]] : []))) }
      : { scores: Object.fromEntries(scored.map((m) => [m, r.metrics[m]])) };
    const review = existsSync(reviewJson(r.round)) ? (JSON.parse(readFileSync(reviewJson(r.round), "utf8")) as { keep_reason?: string }) : {};
    if (r.decision === "keep") {
      parent = r.metrics;
      parentScore = r.score ?? 0;
    }
    const P = cfg.primary_metric;
    return {
      round: r.round, hypothesis: r.hypothesis ?? "(unknown)", deltaPrimary: (r.metrics[P] ?? 0) - (before?.[P] ?? 0),
      ...(r.score === undefined || r.unchanged ? {} : { deltaScore: r.score - scoreBefore }), ...moved, decision: r.decision,
      // Nights before the weighted score kept the reviewer's reason.
      reason: r.unchanged ? "no code change" : r.decision_reason ?? review.keep_reason ?? "",
    };
  });
}
