// A new night can start from an ended night's kept commit (a seed): a new id, budget and trajectory,
// with only the code and the dev scores it was kept on. What that night learned reaches the new one
// through the scenario's lessons.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { NightConfig } from "./config";
import { distilledThrough, pendingRounds } from "./lessons";
import { nightPaths } from "./paths";
import { readRows, type ResultRow } from "./results";
import { type Metrics, weightedScore } from "./stats";

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
  if (!id) throw new Error(`no finished night under ${join(nightPaths(cfg, "").root, "nights")} to seed from`);
  return id;
}

/** Throws unless a night of `cfg` can start from `id`. */
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

/** The night's last round so far. */
export const lastRound = (cfg: NightConfig, id: string): number => Math.max(0, ...experimentRows(cfg, id).map((r) => r.round));
