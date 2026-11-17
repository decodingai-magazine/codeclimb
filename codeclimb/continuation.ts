// A night that ended can go on: more rounds under the same id, on the same experiments and results. It
// picks up at its kept commit with its last feedback and hypothesis, its log of rounds and its rejected
// diffs, and its round numbers go on from the last. `reopenNight` runs before the start event goes out, so
// from then on the night reads as running, and a second continue is refused.
//
// A new night can instead start from an ended night's kept commit (a seed): a new id, budget and trajectory,
// with only the code and the dev scores it was kept on. What that night learned reaches the new one
// through the scenario's lessons.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import { distilledThrough, pendingRounds } from "./lessons";
import { nightPaths } from "./paths";
import { nightSpend } from "./report/data";
import { readRows, type ResultRow } from "./results";
import type { HypothesisLogEntry } from "./reviewer";
import { type Metrics, weightedScore } from "./stats";

/** The start event's `continue`. */
export interface NightStart {
  /** For every new round. */
  direction?: string;
  /** The scorers changed since the kept commit was scored: its recorded scores can't be compared. */
  rescore: boolean;
}

/** Where a seeded night starts: another night's kept commit, with the dev scores it was kept on. */
export interface Seed {
  night: string;
  /** The source night's kept experiment. */
  expId: string;
  /** The source night's last round. */
  round: number;
  /** The primary metric, as a checkpoint's score. */
  score: number;
  metrics: Metrics;
  /** The scorers changed since it was scored: the night scores it again before round 1's experiment. */
  rescore: boolean;
}

interface NightFile {
  startedAt: number;
  config: NightConfig;
  metric_script_sha256: Record<string, string | null>;
  /** The night's budget for one run: a continuation adds it to what the night has spent. */
  run_budget_usd?: number;
  /** The round-0 commit; nights before seeds always had `<id>-r0-starter`. */
  starterExpId?: string;
  seed?: Seed | null;
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

const sameScoring = (now: Record<string, string | null>, then: Record<string, string | null>): boolean =>
  Object.keys({ ...now, ...then }).every((f) => now[f] === then[f]);

/** It ran and ended: a running night's commit could still change. */
function ended(cfg: NightConfig, id: string): boolean {
  const p = nightPaths(cfg, id);
  return existsSync(p.nightJson) && (existsSync(p.doneJson) || existsSync(p.stopJson));
}

/** The nights that ended, among the nights sharing `cfg`'s results, newest first. */
function endedNights(cfg: NightConfig): string[] {
  const dir = join(nightPaths(cfg, "").root, "nights");
  const ids = (existsSync(dir) ? readdirSync(dir) : []).filter((id) => ended(cfg, id));
  return ids.map((id) => ({ id, at: readNight(cfg, id).startedAt })).sort((a, b) => b.at - a.at).map((n) => n.id);
}

/** The newest night that ended, among the nights sharing `cfg`'s results. */
export function latestNight(cfg: NightConfig): string {
  const id = endedNights(cfg)[0];
  if (!id) throw new Error(`no finished night under ${join(nightPaths(cfg, "").root, "nights")} to continue`);
  return id;
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

/** The night's checkpoint: its last keep, else its round-0 commit: the starter, which has no scores, or its seed. */
export function keptOf(cfg: NightConfig, id: string): { expId: string; score: number; metrics: Metrics | null } {
  const row = experimentRows(cfg, id).filter((r) => r.decision === "keep").at(-1);
  if (row) return { expId: row.exp_id, score: row.metrics[cfg.primary_metric] ?? 0, metrics: row.metrics };
  const night = existsSync(nightPaths(cfg, id).nightJson) ? readNight(cfg, id) : null;
  return { expId: night?.starterExpId ?? `${id}-r0-starter`, score: night?.seed?.score ?? 0, metrics: night?.seed?.metrics ?? null };
}

/**
 * The night a new night starts from: an id, `latest` (the newest that ended) or `best` (the highest
 * weighted dev score among the nights scored as the scenario scores now). Test scores never count.
 */
export function resolveSeed(cfg: NightConfig, wanted: string): string {
  if (wanted === "latest") return latestNight(cfg);
  if (wanted !== "best") return wanted;
  const hashes = scoringHashes(cfg);
  const scored = endedNights(cfg)
    .filter((id) => readNight(cfg, id).config.scenario.name === cfg.scenario.name && sameScoring(hashes, readNight(cfg, id).metric_script_sha256))
    .flatMap((id) => {
      const { metrics } = keptOf(cfg, id);
      return metrics ? [{ id, score: weightedScore(metrics, cfg.thresholds, cfg.weights) }] : [];
    });
  if (!scored.length) throw new Error("seed best: no ended night kept a commit under the scenario's current evaluation");
  // Newest first, so a tie goes to the newer night.
  return scored.reduce((a, b) => (b.score > a.score ? b : a)).id;
}

/**
 * The seed from night `id`: its kept commit and the dev scores it was kept on. Refused while the night's
 * lessons are due in lessons.md (it applies them) but not there yet: the new night would start without them.
 */
export function seedFrom(cfg: NightConfig, id: string): Seed {
  checkSource(cfg, id);
  const night = readNight(cfg, id);
  const { expId, score, metrics } = keptOf(cfg, id);
  if (!metrics) throw new Error(`night ${id} kept nothing: seeding from it would start from the starter`);
  const src = night.config;
  if (src.lessons === "apply" && !src.mock && src.scenario.lessons && pendingRounds(cfg, id) > 0) {
    throw new Error(
      `night ${id}'s lessons are not in lessons.md yet (applied through round ${distilledThrough(cfg, id)}): ` +
        `wait for distill-lessons to finish, or apply its proposal with npm run lessons -- apply --night ${id}`,
    );
  }
  return { night: id, expId, round: lastRound(cfg, id), score, metrics, rescore: !sameScoring(scoringHashes(cfg), night.metric_script_sha256) };
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

/** The round a night file belongs to: `<id>-r5-e0`, `<id>-r5-e0-eval` and `r5.json` to 5, a noise run `<id>-r4-e0-noise-r5` to the round it ran in. */
function fileRound(id: string, name: string): number | null {
  const m = /-noise-r(\d+)$/.exec(name) ?? (name.startsWith(`${id}-`) ? /^-r(\d+)-/.exec(name.slice(id.length)) : /^r(\d+)\./.exec(name));
  return m ? Number(m[1]) : null;
}

/**
 * Moves the files of rounds past `last` to `unfinished/after-r<last>-<time>/`. A night that fails between a
 * round's work and its row leaves them behind, and the round's rerun would pick them up: its coder resumed the
 * old clock and stopped at once on `timeout`, recorded as "no code change".
 */
function setAsideUnfinished(nightDir: string, id: string, last: number): void {
  const aside = join(nightDir, "unfinished", `after-r${last}-${Date.now()}`);
  for (const sub of ["exps", "evals", "reviews"]) {
    const dir = join(nightDir, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const round = fileRound(id, name);
      if (round === null || round <= last) continue;
      mkdirSync(join(aside, sub), { recursive: true });
      renameSync(join(dir, name), join(aside, sub, name));
    }
  }
}

/**
 * Makes an ended night a running one again, with `rounds` more rounds and the budget of one more run.
 * Returns the config to start it with. Its done or stop file stays beside the night, under its last round,
 * and the files of a round that never got its row are set aside, so the round reruns from scratch.
 */
export function reopenNight(cfg: NightConfig, id: string, rounds: number = cfg.max_rounds): { config: NightConfig; rescore: boolean } {
  checkSource(cfg, id);
  const paths = nightPaths(cfg, id);
  const night = readNight(cfg, id);
  const last = lastRound(cfg, id);
  setAsideUnfinished(paths.nightDir, id, last);
  const hashes = scoringHashes(cfg);
  const rescore = !sameScoring(hashes, night.metric_script_sha256) && keptOf(cfg, id).metrics !== null;
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
  // A seeded night's first round moved from its seed's scores.
  const seed = readNight(cfg, id).seed;
  let parent: Metrics | null = seed?.metrics ?? null;
  let parentScore = seed ? weightedScore(seed.metrics, cfg.thresholds, cfg.weights) : 0;
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
