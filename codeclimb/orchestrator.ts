// Step bodies for the night run. Each takes plain data and returns plain,
// small JSON (SHAs, metrics, file paths), so the parent's state can be rebuilt
// from memoized step outputs on replay.
import { createHash } from "node:crypto";
import type { CreditStop } from "./credits";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sweepNight } from "./cleanup";
import type { CodeResult, EvalFailure } from "./coder";
import { CODER_PART, notesDir, readSpecText, REVIEWER_PART, trainFell } from "./coder";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import { keptOf, lastReview, lastRound, type NightStart, priorLog, scoringHashes, spentBy } from "./continuation";
import type { EvalResult } from "./evaluate";
import { ExperimentRepo } from "./git";
import { isMetered, meterBaseUrl } from "./meter";
import { checkNightModels } from "./meter/backends";
import { nightPaths } from "./paths";
import { writeReport } from "./report/html";
import { appendRows, type ResultRow, rowSpend } from "./results";
import { type BranchSummary, type HypothesisLogEntry, logLine, type ReviewInput, reviewerPrompt, runReview, type ReviewOutput } from "./reviewer";
import { hostCommand, maskTerms, readProtocol, type RepoCheck, type Scan } from "./scenario";
import { TIMINGS_FILE } from "./standard-metrics";
import { emptyStages, type Metrics, passesGates, weightedMove, weightedScore } from "./stats";

/** The checkpoint: the commit the next round starts from, with the dev scores of its own evaluation. */
export interface Kept {
  expId: string;
  sha: string;
  score: number;
  /** Null for the starter, which is never run. */
  metrics: Metrics | null;
}

export interface NightInit {
  startedAt: number;
  deadlineMs: number;
  starterExpId: string;
  starterSha: string;
}

/** Writes the coder's bundle; rejected diffs stay. A replayed step writes it again. */
async function writeBundle(cfg: NightConfig, nightId: string): Promise<void> {
  const { bundleDir, nightDir } = nightPaths(cfg, nightId);
  const history = join(bundleDir, "history");
  const aside = join(nightDir, "history");
  if (existsSync(history)) renameSync(history, aside);
  rmSync(bundleDir, { recursive: true, force: true });
  await hostCommand(cfg.scenario_dir, cfg.scenario.bundle, { out: bundleDir });
  if (!existsSync(join(bundleDir, "spec"))) throw new Error(`the scenario's bundle command wrote no spec/ into ${bundleDir}`);
  if (existsSync(aside)) renameSync(aside, history);
}

export async function initNight(cfg: NightConfig, nightId: string): Promise<NightInit> {
  const paths = nightPaths(cfg, nightId);
  mkdirSync(paths.nightDir, { recursive: true });
  await writeBundle(cfg, nightId);
  const repo = new ExperimentRepo(paths.gitDir);
  await repo.ensure();
  const starterExpId = `${nightId}-r0-starter`;
  const starterSha = await repo.importDir(join(cfg.scenario_dir, "starter"), starterExpId);
  const startedAt = Date.now();
  const init: NightInit = {
    startedAt,
    deadlineMs: resolveDeadline(cfg.deadline, startedAt),
    starterExpId,
    starterSha,
  };
  writeFileSync(paths.nightJson, JSON.stringify({ night_id: nightId, ...init, config: cfg, metric_script_sha256: scoringHashes(cfg) }, null, 2));
  return init;
}

export interface StopCheck {
  stop: boolean;
  reason?: "max_rounds" | "deadline" | "budget" | "tokens" | "plateau";
  now: number;
}

/**
 * Soft stop, checked between rounds. The $ and token caps stop once the total plus the costliest round
 * so far (and, for $, the test eval) would cross them. A plateau is `plateau_rounds` rounds in a row with nothing kept.
 */
export function checkStop(args: {
  round: number;
  cfg: NightConfig;
  deadlineMs: number;
  spend: number;
  roundSpends: number[];
  /** The costliest single eval of the night so far (program model calls): the test eval's estimate. */
  maxEvalUsd?: number;
  tokens?: number;
  roundTokens?: number[];
  /** Rounds in a row, up to now, that kept nothing. */
  roundsWithoutKeep?: number;
}): StopCheck {
  const now = Date.now();
  if (args.round > args.cfg.max_rounds) return { stop: true, reason: "max_rounds", now };
  if (now >= args.deadlineMs) return { stop: true, reason: "deadline", now };
  const nextRound = args.roundSpends.length ? Math.max(...args.roundSpends) : 0;
  const testEval = args.maxEvalUsd ?? 0;
  if (args.spend + nextRound + testEval > args.cfg.budget_usd.night) return { stop: true, reason: "budget", now };
  const cap = args.cfg.max_tokens;
  const rt = args.roundTokens ?? [];
  if (cap !== null && (args.tokens ?? 0) + (rt.length ? Math.max(...rt) : 0) > cap) return { stop: true, reason: "tokens", now };
  const plateau = args.cfg.plateau_rounds;
  if (plateau > 0 && (args.roundsWithoutKeep ?? 0) >= plateau) return { stop: true, reason: "plateau", now };
  return { stop: false, now };
}

/** Runs the scenario's `check` on an experiment's commit, on the host. A rule broken shows in `errors`; a crash throws. */
export async function checkRepo(cfg: NightConfig, nightId: string, expId: string): Promise<RepoCheck> {
  const paths = nightPaths(cfg, nightId);
  const repoDir = mkdtempSync(join(tmpdir(), "cc-check-"));
  const report = join(paths.expDir(expId), "check.json");
  try {
    await new ExperimentRepo(paths.gitDir).checkout(expId, repoDir);
    await hostCommand(cfg.scenario_dir, cfg.scenario.check!, { repo: repoDir, report });
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
  return JSON.parse(readFileSync(report, "utf8")) as RepoCheck;
}

/** Runs the scenario's `scan` on `text`, on the host: the held-out names in it, for what a coder would read. */
export async function scanText(cfg: NightConfig, text: string): Promise<string[]> {
  if (!cfg.scenario.scan || !text.trim()) return [];
  const dir = mkdtempSync(join(tmpdir(), "cc-scan-"));
  try {
    const [file, report] = [join(dir, "text"), join(dir, "report.json")];
    writeFileSync(file, text);
    await hostCommand(cfg.scenario_dir, cfg.scenario.scan, { text: file, report });
    return (JSON.parse(readFileSync(report, "utf8")) as Scan).found;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `text` as a coder may read it. */
export async function maskText(cfg: NightConfig, text: string): Promise<string> {
  return maskTerms(text, await scanText(cfg, text));
}

/** One round of the log as a coder reads it. */
export async function historyLine(cfg: NightConfig, entry: HypothesisLogEntry): Promise<string> {
  // Masked before `logLine` cuts the reason, which could split a name past recognition.
  const found = await scanText(cfg, `${entry.hypothesis}\n${entry.reason ?? ""}`);
  const masked = { ...entry, hypothesis: maskTerms(entry.hypothesis, found), reason: entry.reason && maskTerms(entry.reason, found) };
  return logLine(masked, cfg.scenario.headline.length ? null : cfg.primary_metric);
}

/** Puts a rejected experiment's diff in the bundle, masked: /spec/history/r<round>.diff in every later sandbox. */
export async function saveRejected(cfg: NightConfig, nightId: string, round: number, parentExpId: string, expId: string): Promise<void> {
  const paths = nightPaths(cfg, nightId);
  // Whole: a coder reads the part it needs with grep or sed, and a cut diff hid what a round changed.
  const diff = await maskText(cfg, await new ExperimentRepo(paths.gitDir).diff(parentExpId, expId, Infinity));
  mkdirSync(join(paths.bundleDir, "history"), { recursive: true });
  // git output comes back trimmed; a patch without its final newline is "corrupt" to `git apply`.
  writeFileSync(join(paths.bundleDir, "history", `r${round}.diff`), diff.endsWith("\n") ? diff : `${diff}\n`);
}

/** Errors as the next coders may read them. */
export async function maskFailures(cfg: NightConfig, failures: EvalFailure[]): Promise<EvalFailure[]> {
  const found = await scanText(cfg, failures.flatMap((f) => f.errors).join("\n"));
  return failures.map((f) => ({ ...f, errors: f.errors.map((e) => maskTerms(e, found)) }));
}

/** Where a night's rounds start: nothing for a new night, what it learned for a continued one. */
export interface NightState {
  deadlineMs: number;
  /** The operator's direction for every new round, held-out names masked; empty without one. */
  direction: string;
  kept: Kept;
  feedback: string;
  hypothesis: string | null;
  log: HypothesisLogEntry[];
  /** `log` as coders read it. */
  history: string[];
  /** The last round so far. */
  round: number;
  spend: number;
  /** The evaluation's measured noise, once a kept commit was scored twice. */
  noise: Noise | null;
}

export const freshNight = (init: NightInit): NightState => ({
  deadlineMs: init.deadlineMs, direction: "", kept: { expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null },
  feedback: "", hypothesis: null, log: [], history: [], round: 0, spend: 0, noise: null,
});

/** Picks a reopened night up at its checkpoint, on the bundle as the scenario stands now. */
export async function continueNight(cfg: NightConfig, nightId: string, start: NightStart): Promise<NightState> {
  const paths = nightPaths(cfg, nightId);
  await writeBundle(cfg, nightId);
  const { expId, score, metrics } = keptOf(cfg, nightId);
  const sha = await new ExperimentRepo(paths.gitDir).sha(expId);
  const log = priorLog(cfg, nightId);
  const history = await Promise.all(log.map((entry) => historyLine(cfg, entry)));
  const direction = start.direction?.trim() ? await maskText(cfg, start.direction.trim()) : "";
  const { deadlineMs } = JSON.parse(readFileSync(paths.nightJson, "utf8")) as { deadlineMs: number };
  // New scorers make new noise: the rescored commit is measured again.
  const noise = start.rescore || !existsSync(paths.noiseJson) ? null : (JSON.parse(readFileSync(paths.noiseJson, "utf8")) as Noise);
  return {
    deadlineMs, direction, kept: { expId, sha, score, metrics }, ...lastReview(cfg, nightId), log, history, round: lastRound(cfg, nightId), spend: spentBy(cfg, nightId), noise,
  };
}

/**
 * The evaluation's noise, from an A/A run: the kept commit scored again with no replayed model calls.
 * Its threshold metrics moved by `margin` with no code change (`weightedMove`: each metric's move counts,
 * so two that move apart don't cancel). It is the base of the margin an experiment must beat, which
 * `noiseMargin` scales by the experiment's replayed calls.
 */
export interface Noise {
  margin: number;
  expId: string;
  first: number;
  second: number;
  /** Each threshold metric in the first run and the second, for the review. */
  moves?: Record<string, [number, number]>;
}

/**
 * The margin an experiment's score must beat the checkpoint's by. `base` is the A/A move (or the
 * config's `fixed`; 0 before either exists). The A/A run is fully fresh: its two scores differ by every
 * call's noise. An experiment replays the checkpoint's answers for every unchanged call, so only its
 * fresh share `f` of calls differs: the variance scales with `f`, the margin with sqrt(f). Example: an
 * A/A move of 0.022 and 9 of 83 calls fresh give 0.022 * sqrt(9/83) = 0.0072. `min` floors it, `max` caps it.
 */
export function noiseMargin(cfg: NightConfig, base: number, metrics: Metrics | null): { margin: number; fresh: number | null } {
  const nm = cfg.noise_margin;
  const b = nm.fixed ?? base;
  const calls = metrics?.model_calls ?? 0;
  const fresh = nm.scale_by_replay && calls > 0 ? (calls - (metrics?.model_calls_replayed ?? 0)) / calls : null;
  return { margin: Math.min(Math.max(b * Math.sqrt(fresh ?? 1), nm.min), nm.max), fresh };
}

/** Records the A/A run of `kept`, and returns the noise it measured; null when it failed. */
export function recordNoise(b: RowBase, kept: Kept, outcome: EvalOutcome): Noise | null {
  const scored = outcome.ok && outcome.result.ok ? outcome.result.metrics : null;
  const second = scored ? scoreOf(b.cfg, scored) : undefined;
  const hypothesis = "the kept commit, scored again without replayed model calls: the evaluation's noise";
  appendRows(b.cfg.results_path, [evalRow(b, kept, outcome, { kind: "noise", hypothesis, ...(second === undefined ? {} : { score: second }) })]);
  if (second === undefined) return null;
  const first = scoreOf(b.cfg, kept.metrics);
  const move = weightedMove(kept.metrics, scored, b.cfg.thresholds, b.cfg.weights);
  const moves = Object.fromEntries(Object.keys(b.cfg.thresholds ?? {}).flatMap((m) =>
    typeof kept.metrics?.[m] === "number" && typeof scored?.[m] === "number" ? [[m, [kept.metrics[m], scored[m]] as [number, number]]] : []));
  const noise = { margin: move, expId: kept.expId, first, second, moves };
  writeFileSync(nightPaths(b.cfg, b.nightId).noiseJson, JSON.stringify(noise, null, 2));
  return noise;
}

/** Null when the night can run a round: the models answer, and a metered program reaches the proxy. Else why not. */
export async function smokeTest(cfg: NightConfig): Promise<string | null> {
  if (cfg.mock) return null;
  try {
    await checkNightModels(cfg);
    if (isMetered(cfg)) await meterBaseUrl(cfg);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The held-out names in the lines a commit adds, by the scenario's `scan`: code fitted to evaluation items. */
export async function diffLeaks(cfg: NightConfig, nightId: string, parentExpId: string, expId: string): Promise<string[]> {
  const diff = await new ExperimentRepo(nightPaths(cfg, nightId).gitDir).diff(parentExpId, expId, Infinity);
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1));
  return scanText(cfg, added.join("\n"));
}

/** A note's heading after the id: the decision and why, cut to a line. */
export const noteOutcome = (decision: string, reason: string): string => {
  const why = reason.replace(/\s+/g, " ").trim();
  return why ? `${decision}: ${why.length > 300 ? `${why.slice(0, 300)}...` : why}` : decision;
};

/**
 * One experiment's note, /spec/history/notes/<exp>.md in every later sandbox: the loop's outcome, the
 * coder's notes from before its evaluation, and the reviewer's verdict after it; held-out names masked.
 */
export async function writeNote(
  cfg: NightConfig,
  nightId: string,
  expId: string,
  note: { outcome: string; coder?: string; reviewer?: string },
): Promise<void> {
  const id = expId.replace(`${nightId}-`, "");
  const parts = [`## ${id} · ${note.outcome.trim()}`];
  if (note.coder?.trim()) parts.push(`${CODER_PART}\n${note.coder.trim()}`);
  if (note.reviewer?.trim()) parts.push(`${REVIEWER_PART}\n${note.reviewer.trim()}`);
  const dir = notesDir(nightPaths(cfg, nightId).bundleDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.md`), `${await maskText(cfg, parts.join("\n"))}\n`);
}

/** A new name for the kept commit, for the round that scores it again. */
export async function renameKept(cfg: NightConfig, nightId: string, kept: Kept, expId: string): Promise<Kept> {
  await new ExperimentRepo(nightPaths(cfg, nightId).gitDir).alias(kept.expId, expId);
  return { ...kept, expId };
}

export type ExperimentOutcome =
  | { ok: true; expId: string; model: string; code: CodeResult; eval: EvalResult | null; /** Why it has no evaluation, past retries. */ evalError?: string }
  | { ok: false; expId: string; model: string; error: string };

export type EvalOutcome = { ok: true; evalId: string; result: EvalResult } | { ok: false; evalId: string; error: string; credits?: CreditStop };

/** It has a commit that failed before it was scored, by a program or check error: a coder can fix that. */
export const repairable = (x: ExperimentOutcome): boolean =>
  x.ok && !!x.code.sha && !x.code.unchanged && !!(x.code.check?.errors.length || (x.eval && !x.eval.ok && !x.eval.credits));

/** The out-of-credits stop of an evaluation, if it hit one. */
export const creditStopOf = (o: EvalOutcome): CreditStop | undefined => (o.ok ? o.result.credits : o.credits);

/** One thing that couldn't go on: `where` is the step of the night it stopped at. */
export type PausedAt = CreditStop & { where: string };

/** Marks the night paused, for the CLI and the app. */
export function markPaused(cfg: NightConfig, nightId: string, round: number, stops: PausedAt[]): number {
  const at = Date.now();
  writeFileSync(nightPaths(cfg, nightId).pauseJson, JSON.stringify({ at, round, stops }, null, 2));
  console.log(`[night ${nightId}] paused, out of credits: ${stops.map((s) => `${s.where} (${s.model})`).join(", ")}`);
  return at;
}

/** Ends a pause: logs it, and moves the deadline by its length, since nothing ran. Returns that length. */
export function endPause(cfg: NightConfig, nightId: string, pausedAt: number): number {
  const paths = nightPaths(cfg, nightId);
  const ms = Date.now() - pausedAt;
  const pause = JSON.parse(readFileSync(paths.pauseJson, "utf8")) as object;
  appendFileSync(paths.pausesLog, `${JSON.stringify({ ...pause, resumed_at: Date.now() })}\n`);
  rmSync(paths.pauseJson);
  const night = JSON.parse(readFileSync(paths.nightJson, "utf8")) as { deadlineMs: number };
  writeFileSync(paths.nightJson, JSON.stringify({ ...night, deadlineMs: night.deadlineMs + ms }, null, 2));
  return ms;
}

interface RowBase {
  cfg: NightConfig;
  nightId: string;
  round: number;
}

function baseRow(b: RowBase, fields: Partial<ResultRow>): ResultRow {
  return {
    exp_id: "", parent_id: null, round: b.round, stack: "inngest", split: "dev", model: null,
    reviewer_model: b.cfg.reviewer_model, hypothesis: null, commit: "", metrics: {}, coder_usd: 0, program_usd: 0,
    reviewer_usd: 0, tokens: 0, wall_s: 0, decision: "keep", backend: b.cfg.sandbox, t_provision: 0, t_code: 0,
    t_eval: 0, t_review: 0, t_teardown: 0, infra_errors: 0, kind: "experiment", eval_id: "", night_id: b.nightId,
    ...fields,
  };
}

/** Row for the test eval of the final commit. */
export function evalRow(b: RowBase, kept: Pick<Kept, "expId" | "sha">, outcome: EvalOutcome, extra: Partial<ResultRow>): ResultRow {
  const r = outcome.ok ? outcome.result : null;
  const ok = !!r?.ok;
  return baseRow(b, {
    exp_id: kept.expId, commit: kept.sha, eval_id: outcome.evalId,
    metrics: r?.ok ? r.metrics : { [b.cfg.primary_metric]: 0 },
    program_usd: r?.program_usd ?? 0, wall_s: r?.wall_s ?? 0, t_provision: r?.t_provision ?? 0,
    t_eval: r?.t_eval ?? 0, t_teardown: r?.t_teardown ?? 0, infra_errors: (r?.infra_errors ?? 0) + (outcome.ok ? 0 : 1),
    decision: ok ? "keep" : "error",
    ...(r ? { evaluator_instance: r.evaluator_instance } : {}),
    ...extra,
  });
}

/**
 * The row of a kept commit scored again because the scorers changed. It stays the checkpoint if that
 * evaluation failed, with the scores it came with: a later continuation finds it here either way.
 */
export function rescoreRow(b: RowBase, kept: Kept, outcome: EvalOutcome): ResultRow {
  const scored = outcome.ok && outcome.result.ok;
  return evalRow(b, kept, outcome, { hypothesis: "the kept commit, scored again: the evaluation changed", decision: "keep", ...(scored ? {} : { metrics: kept.metrics ?? {} }) });
}

// A stage's per-item errors the reviewer reads; graphrag's extraction errors take about 70k, its matches 25k more.
const MAX_DETAILS_CHARS = 70_000;

type Candidate = { expId: string; sha: string; score: number; metrics: Metrics };

/** Held-out names in a diff's added lines past which it is fitted to them, not general knowledge. */
export const LEAK_LIMIT = 2;

export interface RoundDecision {
  row: ResultRow;
  /** The new checkpoint, or null: the round reverts. */
  keep: Candidate | null;
  summary: Omit<BranchSummary, "diff" | "details"> & { metricsPath: string | null };
  spend: number;
}

/** The weighted score of `metrics` under the night's thresholds and weights. */
export const scoreOf = (cfg: Pick<NightConfig, "thresholds" | "weights">, metrics: Metrics | null): number => weightedScore(metrics, cfg.thresholds, cfg.weights);

const fmtScore = (v: number) => v.toFixed(4);

function readCodeState(cfg: NightConfig, nightId: string, expId: string): { coderUsd: number; devUsd?: number; tokens: number } {
  const f = join(nightPaths(cfg, nightId).expDir(expId), "code-state.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { coderUsd: 0, tokens: 0 };
}

/**
 * A round's one experiment against the checkpoint's stored dev scores. It is kept when its weighted score
 * (`scoreOf`) beats the checkpoint's by more than the noise margin (`noiseMargin` of `margin`, the A/A
 * move, scaled by the experiment's replayed calls), and nothing
 * blocks it: a failed gate, a stage gone empty, or a diff that names held-out items. Anything else
 * reverts, and the next round starts from the checkpoint again. An experiment that changed no code was
 * not evaluated: it reverts with the parent's scores, and the review reads what the coder reported.
 */
export function decideRound(args: RowBase & { parent: Kept; experiment: ExperimentOutcome; hypothesis: string | null; margin: number }): RoundDecision {
  const { cfg, parent, experiment: x } = args;
  let margin = noiseMargin(cfg, args.margin, null).margin;
  const P = cfg.primary_metric;
  const parentScore = scoreOf(cfg, parent.metrics);
  if (!x.ok) {
    const st = readCodeState(cfg, args.nightId, x.expId);
    const row = baseRow(args, {
      exp_id: x.expId, parent_id: parent.expId, model: x.model, eval_id: `${x.expId}-eval`,
      hypothesis: args.hypothesis ?? `(failed: ${x.error.slice(0, 200)})`, metrics: { [P]: 0 },
      coder_usd: st.coderUsd, ...(st.devUsd ? { dev_usd: st.devUsd } : {}), tokens: st.tokens, decision: "error", infra_errors: 1,
      decision_reason: "the experiment failed",
    });
    const summary = {
      expId: x.expId, model: x.model, hypothesis: args.hypothesis ?? "(unknown)", decision: "error", primary: 0, metrics: {}, guardrails: [], notes: [], metricsPath: null,
      score: 0, parentScore, margin, reason: "the experiment failed",
    };
    return { row, keep: null, summary, spend: rowSpend(row) };
  }
  const ev = x.eval;
  const evalOk = !!(x.code.sha && ev?.ok);
  // The same files have the parent's scores: nothing moved, and nothing was run to say otherwise.
  const unchanged = x.code.unchanged !== undefined;
  const metrics = unchanged ? (parent.metrics ?? { [P]: 0 }) : evalOk ? ev!.metrics : { [P]: 0 };
  const primary = unchanged ? parent.score : (metrics[P] ?? 0);
  const score = unchanged ? parentScore : evalOk ? scoreOf(cfg, metrics) : 0;
  const failedCheck = x.code.check?.errors ?? [];
  const errors = [...failedCheck, ...(ev?.error ? [ev.error] : []), ...(x.evalError ? [x.evalError] : [])];
  const leaks = x.code.leaks ?? [];
  const guardrails = !evalOk || unchanged ? [] : [
    ...(passesGates(metrics, cfg.gates) ? [] : [`a gate failed: ${Object.entries(cfg.gates).filter(([k, cap]) => !(metrics[k] <= cap)).map(([k, cap]) => `${k}=${metrics[k] ?? "missing"} (cap ${cap})`).join(", ")}`]),
    ...emptyStages(metrics),
    ...(leaks.length >= LEAK_LIMIT ? [`the diff's added lines name ${leaks.length} held-out evaluation items`] : []),
  ];
  const scaled = noiseMargin(cfg, args.margin, evalOk && !unchanged ? metrics : null);
  margin = scaled.margin;
  const base = cfg.noise_margin.fixed ?? args.margin;
  const fresh = scaled.fresh === null ? "" : ` (${metrics.model_calls - (metrics.model_calls_replayed ?? 0)} of ${metrics.model_calls} model calls fresh${base ? `, A/A ${fmtScore(base)}` : ""})`;
  const beats = score > parentScore + margin + 1e-12;
  const kept = evalOk && !unchanged && !guardrails.length && beats;
  const reason = unchanged
    ? "no code change"
    : !evalOk
      ? "not scored"
      : guardrails.length
        ? `blocked: ${guardrails.join("; ")}`
        : `weighted score ${fmtScore(score)} ${beats ? ">" : "<="} checkpoint ${fmtScore(parentScore)}${margin ? ` + noise margin ${fmtScore(margin)}${fresh}` : ""}`;
  const row = baseRow(args, {
    exp_id: x.expId, parent_id: parent.expId, model: x.model, hypothesis: x.code.hypothesis, commit: x.code.sha ?? "",
    eval_id: `${x.expId}-eval`, metrics, coder_usd: x.code.coder_usd, program_usd: ev?.program_usd ?? 0,
    ...(x.code.dev_usd ? { dev_usd: x.code.dev_usd } : {}),
    tokens: x.code.tokens,
    wall_s: Math.round((x.code.t_provision + x.code.t_code + x.code.t_teardown + (ev?.wall_s ?? 0)) * 100) / 100,
    decision: kept ? "keep" : evalOk || unchanged ? "revert" : "error",
    t_provision: x.code.t_provision + (ev?.t_provision ?? 0), t_code: x.code.t_code, t_eval: ev?.t_eval ?? 0,
    t_teardown: x.code.t_teardown + (ev?.t_teardown ?? 0),
    infra_errors: x.code.infra_errors + (ev?.infra_errors ?? 0) + (x.code.sha && !ev && !failedCheck.length && !unchanged ? 1 : 0),
    ...(ev ? { evaluator_instance: ev.evaluator_instance } : {}),
    ...(unchanged ? { unchanged: true } : {}),
    ...(evalOk || unchanged ? { score } : {}),
    decision_reason: reason,
  });
  const summary = {
    expId: x.expId, model: x.model, hypothesis: x.code.hypothesis, decision: row.decision, primary, metrics, guardrails,
    ...(errors.length ? { errors } : {}),
    notes: [...(x.code.check?.notes ?? []), ...(leaks.length && leaks.length < LEAK_LIMIT ? [`the diff's added lines name ${leaks.length} held-out item`] : [])],
    metricsPath: ev?.metricsPath ?? null,
    ...(unchanged ? { unchanged: x.code.unchanged } : {}),
    score, parentScore, margin, reason,
  };
  return { row, keep: kept ? { expId: x.expId, sha: x.code.sha!, score: primary, metrics } : null, summary, spend: rowSpend(row) };
}

/**
 * `details` as text, at most `maxChars`: past that the long items share what the short ones left, so no
 * item crowds out the rest.
 */
export function spreadDetails(details: unknown, maxChars: number): string {
  const whole = JSON.stringify(details);
  if (whole.length <= maxChars || typeof details !== "object" || details === null) return whole.slice(0, maxChars);
  const items = Object.entries(details).map(([k, v]) => [k, JSON.stringify(v)] as const);
  let left = maxChars;
  let share = 0;
  for (const [i, n] of items.map(([, v]) => v.length).sort((a, b) => a - b).entries()) {
    share = Math.floor(left / (items.length - i));
    if (n > share) break; // this one and the longer ones are cut at `share`
    left -= n;
  }
  return items.map(([k, v]) => `${k}: ${v.slice(0, share)}`).join("\n");
}

/** Per-item errors of a branch's dev eval, per stage: what `details` in a stage report holds. */
function readDetails(cfg: NightConfig, metricsPath: string | null): string {
  if (!metricsPath) return "";
  const parts = cfg.scenario.stages.flatMap((stage) => {
    const file = join(dirname(metricsPath), stage.name, "report.json");
    if (!stage.details || !existsSync(file)) return [];
    const { details } = JSON.parse(readFileSync(file, "utf8")) as { details?: unknown };
    return details === undefined ? [] : [`### ${stage.name}\n${spreadDetails(details, MAX_DETAILS_CHARS)}`];
  });
  return parts.join("\n\n");
}

/** A stage's log as the review reads it: the program's own warnings and errors, then the end of the log. */
const MAX_LOG_CHARS = 4_000;
/** Lines that only say a request went out: the bulk of a model-calling program's log. */
const LOG_NOISE = /HTTP Request:|^\s*$/;
const LOG_FLAGGED = /\b(warn(ing)?|error|critical|exception|traceback|failed)\b/i;

/**
 * The part of a run log a reviewer needs, at most `maxChars`: every line without request noise when it
 * fits; else the warning and error lines first (each distinct line once, with a count), then the end of
 * the log, where a program writes its totals.
 */
export function logExcerpt(log: string, maxChars = MAX_LOG_CHARS): string {
  const lines = log.split("\n").filter((l) => !LOG_NOISE.test(l));
  const whole = lines.join("\n");
  if (whole.length <= maxChars) return whole;
  const counts = new Map<string, number>();
  for (const l of lines.filter((l) => LOG_FLAGGED.test(l))) counts.set(l, (counts.get(l) ?? 0) + 1);
  const flagged = [...counts].map(([l, n]) => (n > 1 ? `${l}  [x${n}]` : l)).join("\n").slice(0, Math.floor(maxChars / 2));
  const room = maxChars - flagged.length;
  const tail: string[] = [];
  let used = 0;
  for (const l of [...lines].reverse()) {
    if (used + l.length + 1 > room) break;
    tail.unshift(l);
    used += l.length + 1;
  }
  return `${flagged}${flagged ? "\n...\n" : ""}${tail.join("\n")}`;
}

/** Each stage's dev run log, cut by `logExcerpt`: what the program said on stderr, which no score shows. */
function readRunLogs(cfg: NightConfig, metricsPath: string | null): string {
  if (!metricsPath) return "";
  return cfg.scenario.stages
    .flatMap((stage) => {
      const file = join(dirname(metricsPath), stage.name, "run.log");
      const text = existsSync(file) ? logExcerpt(readFileSync(file, "utf8")) : "";
      return text ? [`### ${stage.name}\n${text}`] : [];
    })
    .join("\n\n");
}

/** A stage's predictions, as one hash: every output file but the timings, which differ on every run. */
function outputDigest(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => !f.endsWith(TIMINGS_FILE)).sort();
  const hash = createHash("sha256");
  for (const f of files) {
    const p = join(dir, f);
    try {
      hash.update(f).update("\0").update(readFileSync(p)).update("\0");
    } catch {
      // a directory
    }
  }
  return hash.digest("hex");
}

/**
 * The stages whose dev predictions are byte for byte the checkpoint's: the change never reached their
 * output, so their metrics say nothing about it. Empty when the checkpoint was never evaluated.
 */
export function sameOutputStages(cfg: NightConfig, metricsPath: string | null, parentEvalDir: string): string[] {
  if (!metricsPath || !existsSync(parentEvalDir)) return [];
  return cfg.scenario.stages
    .filter((stage) => {
      const mine = outputDigest(join(dirname(metricsPath), stage.name, "outputs"));
      return mine !== null && mine === outputDigest(join(parentEvalDir, stage.name, "outputs"));
    })
    .map((stage) => stage.name);
}

/** What the coder left in its experiment's dir: the task list and train measurements, for the review. */
export function coderWork(cfg: NightConfig, nightId: string, expId: string): { coderWork?: string } {
  const dir = nightPaths(cfg, nightId).expDir(expId);
  const parts = [["Tasks (tasks.json)", "tasks.json"], ["Train measurements (train-score.json)", "train-score.json"]]
    .filter(([, f]) => existsSync(join(dir, f)))
    .map(([title, f]) => `${title}:\n${readFileSync(join(dir, f), "utf8").trim().slice(0, 4_000)}`);
  // The coder's last send-back may come before its last train measurement, so nothing else checks that one.
  const trainFile = join(dir, "train-score.json");
  const fell = existsSync(trainFile) ? trainFell(readFileSync(trainFile, "utf8")) : [];
  if (fell.length) parts.push(`The coder's own train measurement shows its change lowered ${fell.join(", ")}, and it gave no "why": weigh that part of the diff.`);
  return parts.length ? { coderWork: parts.join("\n") } : {};
}

export async function reviewRound(args: {
  cfg: NightConfig;
  nightId: string;
  round: number;
  parentExpId: string;
  parentScore: number;
  parentMetrics: Metrics | null;
  summary: RoundDecision["summary"];
  log: HypothesisLogEntry[];
  direction: string;
  /** What the coder wrote before the evaluation, for the verdict to confirm or contradict. */
  coderNotes?: string;
  /** The A/A run, when one scored. */
  noise?: Noise | null;
}): Promise<ReviewOutput> {
  const repo = new ExperimentRepo(nightPaths(args.cfg, args.nightId).gitDir);
  const { metricsPath, ...summary } = args.summary;
  const diff = await repo.diff(args.parentExpId, summary.expId).catch(() => "(no commit)");
  const input: ReviewInput = {
    model: args.cfg.reviewer_model,
    thinkingLevel: args.cfg.reviewer_thinking,
    mock: args.cfg.mock,
    spec: readSpecText(nightPaths(args.cfg, args.nightId).bundleDir),
    round: args.round,
    primaryMetric: args.cfg.primary_metric,
    thresholds: args.cfg.thresholds,
    weights: args.cfg.weights,
    gates: args.cfg.gates,
    parentScore: args.parentScore,
    parentMetrics: args.parentMetrics,
    objectives: efficiencyMetrics(args.cfg),
    minEfficiencyGain: args.cfg.standard_metrics.min_efficiency_gain,
    result: {
      ...summary, diff, details: readDetails(args.cfg, metricsPath), logs: readRunLogs(args.cfg, metricsPath),
      sameOutput: sameOutputStages(args.cfg, metricsPath, nightPaths(args.cfg, args.nightId).evalDir(`${args.parentExpId}-eval`)),
    },
    log: args.log,
    direction: args.direction,
    ...(args.coderNotes?.trim() ? { coderNotes: args.coderNotes } : {}),
    ...coderWork(args.cfg, args.nightId, summary.expId),
    ...(args.noise ? { noise: args.noise } : {}),
    headline: args.cfg.scenario.headline,
    diagnostics: args.cfg.scenario.diagnostics ?? [],
    protocol: readProtocol(args.cfg.scenario_dir, args.cfg.scenario.protocol),
    parentSource: await repo.source(args.parentExpId),
  };
  const paths = nightPaths(args.cfg, args.nightId);
  const file = paths.reviewJson(args.round);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(paths.reviewPrompt(args.round), reviewerPrompt(input)); // before the call, so a failed review leaves it too
  const review = await runReview(input, (text) => scanText(args.cfg, text));
  writeFileSync(file, JSON.stringify({ round: args.round, model: args.cfg.reviewer_model, ...review }, null, 2));
  return review;
}

export function recordRows(cfg: NightConfig, rows: ResultRow[]): number {
  appendRows(cfg.results_path, rows);
  return rows.length;
}

export async function finishNight(b: RowBase & {
  kept: Kept;
  test: EvalOutcome;
  stopReason: string;
  rounds: number;
  spend: number;
}) {
  appendRows(b.cfg.results_path, [evalRow(b, b.kept, b.test, { split: "test", kind: "test" })]);
  const swept = await sweepNight(b.nightId);
  const summary = {
    night_id: b.nightId,
    stop_reason: b.stopReason,
    rounds: b.rounds,
    kept: { exp_id: b.kept.expId, commit: b.kept.sha, dev_score: b.kept.score },
    test_metrics: b.test.ok && b.test.result.ok ? b.test.result.metrics : null,
    spend_usd: Math.round(b.spend * 10_000) / 10_000,
    leftover_sandboxes_destroyed: swept,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(nightPaths(b.cfg, b.nightId).doneJson, JSON.stringify(summary, null, 2));
  await writeReport(b.cfg);
  return summary;
}
