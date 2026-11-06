// Step bodies for the night run. Each takes plain data and returns plain,
// small JSON (SHAs, metrics, file paths), so the parent's state can be rebuilt
// from memoized step outputs on replay.
import type { CreditStop } from "./credits";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { sweepNight } from "./cleanup";
import type { CodeResult, EvalFailure } from "./coder";
import { readSpecText } from "./coder";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import type { EvalResult } from "./evaluate";
import { ExperimentRepo } from "./git";
import { nightPaths } from "./paths";
import { writeReport } from "./report/html";
import { appendRows, type ResultRow, rowSpend } from "./results";
import { type BranchSummary, type HypothesisLogEntry, type ReviewInput, reviewerPrompt, runReview, type ReviewOutput } from "./reviewer";
import { hostCommand, maskTerms, readProtocol, type RepoCheck, type Scan } from "./scenario";
import { beatsParent, emptyStages, guardrailFailures, type Metrics, passesGates } from "./stats";

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

export async function initNight(cfg: NightConfig, nightId: string): Promise<NightInit> {
  const paths = nightPaths(cfg, nightId);
  mkdirSync(paths.nightDir, { recursive: true });
  // The coder's bundle, rebuilt on every start (a replayed step overwrites it).
  rmSync(paths.bundleDir, { recursive: true, force: true });
  await hostCommand(cfg.scenario_dir, cfg.scenario.bundle, { out: paths.bundleDir });
  if (!existsSync(join(paths.bundleDir, "spec"))) throw new Error(`the scenario's bundle command wrote no spec/ into ${paths.bundleDir}`);
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
  // What scores the night must stay unchanged across it: the scenario's evaluators, gold and scenario.yaml.
  const scored = ["scenario.yaml", ...["evaluators", "gold"].flatMap((d) => filesUnder(join(cfg.scenario_dir, d)).map((f) => join(d, f)))];
  const hashes = Object.fromEntries(scored.map((f) => [relative(cfg.base_dir, join(cfg.scenario_dir, f)), sha256(join(cfg.scenario_dir, f))]));
  writeFileSync(paths.nightJson, JSON.stringify({ night_id: nightId, ...init, config: cfg, metric_script_sha256: hashes }, null, 2));
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

/** Errors as the next coders may read them. */
export async function maskFailures(cfg: NightConfig, failures: EvalFailure[]): Promise<EvalFailure[]> {
  const found = await scanText(cfg, failures.flatMap((f) => f.errors).join("\n"));
  return failures.map((f) => ({ ...f, errors: f.errors.map((e) => maskTerms(e, found)) }));
}

export type ExperimentOutcome =
  | { ok: true; expId: string; model: string; code: CodeResult; eval: EvalResult | null }
  | { ok: false; expId: string; model: string; error: string };

export type EvalOutcome = { ok: true; evalId: string; result: EvalResult } | { ok: false; evalId: string; error: string; credits?: CreditStop };

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

// A stage's per-item errors the reviewer reads; graphrag's extraction writes about 120k.
const MAX_DETAILS_CHARS = 200_000;

export type KeepReason = "primary" | "reviewer";

export interface RoundDecision {
  row: ResultRow;
  /** The mechanical keep, which stands when no review came back. */
  keep: { expId: string; sha: string; score: number; metrics: Metrics; reason: KeepReason } | null;
  /** What it could be kept as: it passed the gates and guardrails. The reviewer decides; null: it is reverted. */
  candidate: { expId: string; sha: string; score: number; metrics: Metrics } | null;
  summary: Omit<BranchSummary, "diff" | "details"> & { metricsPath: string | null };
  spend: number;
}

function readCodeState(cfg: NightConfig, nightId: string, expId: string): { coderUsd: number; devUsd?: number; tokens: number } {
  const f = join(nightPaths(cfg, nightId).expDir(expId), "code-state.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { coderUsd: 0, tokens: 0 };
}

/**
 * The mechanical pass over a round's one experiment, against the checkpoint's stored dev scores. It is a
 * candidate if it passes the gates and the guardrails: no headline regression past its margin, no stage
 * gone empty. Against the starter, which has no scores, only an empty stage stops it. The reviewer then
 * keeps or reverts a candidate (`applyReview`); when no review comes back the rule is a primary gain of
 * at least min_gain. Anything else is reverted, and the next round starts from the checkpoint again.
 */
export function decideRound(args: RowBase & { parent: Kept; experiment: ExperimentOutcome; hypothesis: string | null }): RoundDecision {
  const { cfg, parent, experiment: x } = args;
  const P = cfg.primary_metric;
  if (!x.ok) {
    const st = readCodeState(cfg, args.nightId, x.expId);
    const row = baseRow(args, {
      exp_id: x.expId, parent_id: parent.expId, model: x.model, eval_id: `${x.expId}-eval`,
      hypothesis: args.hypothesis ?? `(failed: ${x.error.slice(0, 200)})`, metrics: { [P]: 0 },
      coder_usd: st.coderUsd, ...(st.devUsd ? { dev_usd: st.devUsd } : {}), tokens: st.tokens, decision: "error", infra_errors: 1,
    });
    const summary = { expId: x.expId, model: x.model, hypothesis: args.hypothesis ?? "(unknown)", decision: "error", primary: 0, metrics: {}, guardrails: [], notes: [], metricsPath: null };
    return { row, keep: null, candidate: null, summary, spend: rowSpend(row) };
  }
  const ev = x.eval;
  const evalOk = !!(x.code.sha && ev?.ok);
  const metrics = evalOk ? ev!.metrics : { [P]: 0 };
  const primary = metrics[P] ?? 0;
  const failedCheck = x.code.check?.errors ?? [];
  const errors = [...failedCheck, ...(ev?.error ? [ev.error] : [])];
  const guardrails = !evalOk ? errors : parent.metrics ? guardrailFailures(metrics, parent.metrics, cfg.scenario.headline) : emptyStages(metrics);
  const eligible = evalOk && passesGates(metrics, cfg.gates) && !guardrails.length;
  const candidate = eligible ? { expId: x.expId, sha: x.code.sha!, score: primary, metrics } : null;
  const keep = candidate && beatsParent(primary, parent.score, cfg.min_gain) ? { ...candidate, reason: "primary" as const } : null;
  const row = baseRow(args, {
    exp_id: x.expId, parent_id: parent.expId, model: x.model, hypothesis: x.code.hypothesis, commit: x.code.sha ?? "",
    eval_id: `${x.expId}-eval`, metrics, coder_usd: x.code.coder_usd, program_usd: ev?.program_usd ?? 0,
    ...(x.code.dev_usd ? { dev_usd: x.code.dev_usd } : {}),
    tokens: x.code.tokens,
    wall_s: Math.round((x.code.t_provision + x.code.t_code + x.code.t_teardown + (ev?.wall_s ?? 0)) * 100) / 100,
    decision: keep ? "keep" : evalOk ? "revert" : "error",
    ...(keep ? { keep_reason: keep.reason } : {}),
    t_provision: x.code.t_provision + (ev?.t_provision ?? 0), t_code: x.code.t_code, t_eval: ev?.t_eval ?? 0,
    t_teardown: x.code.t_teardown + (ev?.t_teardown ?? 0),
    infra_errors: x.code.infra_errors + (ev?.infra_errors ?? 0) + (x.code.sha && !ev && !failedCheck.length ? 1 : 0),
    ...(ev ? { evaluator_instance: ev.evaluator_instance } : {}),
  });
  const summary = {
    expId: x.expId, model: x.model, hypothesis: x.code.hypothesis, decision: row.decision, primary, metrics, guardrails,
    ...(errors.length ? { errors } : {}), notes: x.code.check?.notes ?? [], metricsPath: ev?.metricsPath ?? null,
  };
  return { row, keep, candidate, summary, spend: rowSpend(row) };
}

/** The round with the reviewer's call in place of the mechanical one; it can only keep a candidate. */
export function applyReview(d: RoundDecision, keep: boolean): RoundDecision {
  if (!d.candidate) return d;
  const { keep_reason: _, ...row } = d.row;
  const decision = keep ? "keep" : "revert";
  return {
    ...d,
    keep: keep ? { ...d.candidate, reason: "reviewer" } : null,
    row: keep ? { ...row, decision, keep_reason: "reviewer" } : { ...row, decision },
    summary: { ...d.summary, decision },
  };
}

/** `details` as text, at most `maxChars`: past that every item keeps an equal share, so no item crowds out the rest. */
export function spreadDetails(details: unknown, maxChars: number): string {
  const whole = JSON.stringify(details);
  if (whole.length <= maxChars || typeof details !== "object" || details === null) return whole.slice(0, maxChars);
  const items = Object.entries(details);
  const share = Math.floor(maxChars / items.length);
  return items.map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, share)}`).join("\n");
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

export async function reviewRound(args: {
  cfg: NightConfig;
  nightId: string;
  round: number;
  parentExpId: string;
  parentScore: number;
  parentMetrics: Metrics | null;
  summary: RoundDecision["summary"];
  /** Whether the guardrails let it be kept, and what the mechanical rule would do. */
  canKeep: boolean;
  mechanicalKeep: boolean;
  log: HypothesisLogEntry[];
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
    gates: args.cfg.gates,
    parentScore: args.parentScore,
    parentMetrics: args.parentMetrics,
    objectives: efficiencyMetrics(args.cfg),
    minEfficiencyGain: args.cfg.standard_metrics.min_efficiency_gain,
    result: { ...summary, diff, details: readDetails(args.cfg, metricsPath) },
    log: args.log,
    canKeep: args.canKeep,
    mechanicalKeep: args.mechanicalKeep,
    headline: Object.keys(args.cfg.scenario.headline),
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
