// Step bodies for the night run. Each takes plain data and returns plain,
// small JSON (SHAs, metrics, file paths), so the parent's state can be rebuilt
// from memoized step outputs on replay.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sweepNight } from "./cleanup";
import type { CodeResult } from "./coder";
import { readSpecText } from "./coder";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import { type EvalResult, readPerItem, trainFolds } from "./evaluate";
import { ExperimentRepo } from "./git";
import { nightPaths } from "./paths";
import { writeReport } from "./report/html";
import { appendRows, readRows, type ResultRow, rowSpend } from "./results";
import { type BranchSummary, type HypothesisLogEntry, runReview, type ReviewOutput } from "./reviewer";
import { beatsParent, cutsMetric, type Metrics, mean, overfitTest, passesGates, stddev } from "./stats";

/** What the parent tracks about the commit the next round starts from. */
export interface Kept {
  expId: string;
  sha: string;
  /** Score used by the keep rule: re-score (or noise mean) when `rescored`, else the raw best-of-N score. */
  score: number;
  metrics: Metrics | null;
  /** metrics.json of the latest optimization-fold re-score (per-item scores for the overfit SE). */
  metricsPath: string | null;
  rescored: boolean;
  /** Folds this commit was validated on (each fold validates at most once per commit). */
  validatedFolds: number[];
}

export interface NightInit {
  startedAt: number;
  deadlineMs: number;
  folds: number[];
  starterExpId: string;
  starterSha: string;
  sigma: number;
  /** σ of each optimized standard metric (`efficiencyMetrics`), from the same noise runs. */
  effSigma: Metrics;
  sigmaMeasured: boolean;
}

function sha256(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

/** σ of the primary and of each optimized metric over a set of noise evals, or null if any is missing. */
function noiseSigmas(cfg: NightConfig, metrics: Metrics[]): { sigma: number; effSigma: Metrics } | null {
  if (metrics.length < 2) return null;
  const effSigma: Metrics = {};
  for (const m of efficiencyMetrics(cfg)) {
    const xs = metrics.map((x) => x[m]);
    if (xs.some((x) => typeof x !== "number")) return null;
    effSigma[m] = stddev(xs);
  }
  return { sigma: stddev(metrics.map((x) => x[cfg.primary_metric])), effSigma };
}

/**
 * σs from the most recent earlier night that measured a noise floor. Null when it lacks an optimized
 * metric (measured before that metric existed or was optimized), so this night measures again.
 */
function previousNoise(cfg: NightConfig, nightId: string): { sigma: number; effSigma: Metrics } | null {
  const noise = readRows(cfg.results_path).filter((r) => r.split === "noise" && r.night_id !== nightId);
  if (!noise.length) return null;
  const last = noise[noise.length - 1].night_id;
  return noiseSigmas(cfg, noise.filter((r) => r.night_id === last && r.decision !== "error").map((r) => r.metrics));
}

export async function initNight(cfg: NightConfig, nightId: string): Promise<NightInit> {
  const paths = nightPaths(cfg, nightId);
  mkdirSync(paths.nightDir, { recursive: true });
  const repo = new ExperimentRepo(paths.gitDir);
  await repo.ensure();
  const starterExpId = `${nightId}-r0-starter`;
  const starterSha = await repo.importDir(join(cfg.spec_dir, "starter"), starterExpId);
  const startedAt = Date.now();
  const noise = previousNoise(cfg, nightId);
  const init: NightInit = {
    startedAt,
    deadlineMs: resolveDeadline(cfg.deadline, startedAt),
    folds: trainFolds(cfg),
    starterExpId,
    starterSha,
    sigma: noise?.sigma ?? 0,
    effSigma: noise?.effSigma ?? {},
    sigmaMeasured: noise !== null,
  };
  // Metric-script hashes: run_cmd + score_cmd must stay unchanged across the night.
  const scoreFiles = cfg.score_cmd.split(/\s+/).map((t) => join(cfg.base_dir, t)).filter((p) => existsSync(p) && p.endsWith(".py"));
  const hashes = Object.fromEntries([...cfg.run_files, ...scoreFiles].map((f) => [f, sha256(f)]));
  writeFileSync(paths.nightJson, JSON.stringify({ night_id: nightId, ...init, config: cfg, metric_script_sha256: hashes }, null, 2));
  return init;
}

export interface StopCheck {
  stop: boolean;
  reason?: "max_rounds" | "deadline" | "budget";
  now: number;
}

/** Soft stop, checked between rounds. The $ cap stops once spend + one round + the test eval would cross it. */
export function checkStop(args: {
  round: number;
  cfg: NightConfig;
  deadlineMs: number;
  spend: number;
  roundSpends: number[];
  /** The costliest single eval of the night so far (program model calls): the test eval's estimate. */
  maxEvalUsd?: number;
}): StopCheck {
  const now = Date.now();
  if (args.round > args.cfg.max_rounds) return { stop: true, reason: "max_rounds", now };
  if (now >= args.deadlineMs) return { stop: true, reason: "deadline", now };
  const nextRound = args.roundSpends.length ? Math.max(...args.roundSpends) : 0;
  const testEval = args.maxEvalUsd ?? 0;
  if (args.spend + nextRound + testEval > args.cfg.budget_usd.night) return { stop: true, reason: "budget", now };
  return { stop: false, now };
}

/** `xs` rotated left by `k`: the round's evaluation order, so no candidate always runs first. Replay-stable. */
export function rotate<T>(xs: T[], k: number): T[] {
  if (!xs.length) return xs;
  const i = ((k % xs.length) + xs.length) % xs.length;
  return [...xs.slice(i), ...xs.slice(0, i)];
}

export type BranchOutcome =
  | { ok: true; expId: string; branch: number; model: string; code: CodeResult; eval: EvalResult | null }
  | { ok: false; expId: string; branch: number; model: string; error: string };

export type EvalOutcome = { ok: true; evalId: string; result: EvalResult } | { ok: false; evalId: string; error: string };

interface RowBase {
  cfg: NightConfig;
  nightId: string;
  round: number;
  valFold: number;
}

function baseRow(b: RowBase, fields: Partial<ResultRow>): ResultRow {
  return {
    exp_id: "", parent_id: null, round: b.round, stack: "inngest", split: "opt", val_fold: b.valFold, model: null,
    reviewer_model: b.cfg.reviewer_model, hypothesis: null, commit: "", metrics: {}, coder_usd: 0, program_usd: 0,
    reviewer_usd: 0, tokens: 0, wall_s: 0, decision: "keep", backend: b.cfg.sandbox, t_provision: 0, t_code: 0,
    t_eval: 0, t_review: 0, t_teardown: 0, infra_errors: 0, kind: "experiment", eval_id: "", night_id: b.nightId,
    ...fields,
  };
}

/** Row for an extra eval (re-score, noise, validation, test) of an existing commit. */
export function evalRow(b: RowBase, kept: Pick<Kept, "expId" | "sha">, outcome: EvalOutcome, extra: Partial<ResultRow>): ResultRow {
  const r = outcome.ok ? outcome.result : null;
  const ok = !!r?.ok;
  return baseRow(b, {
    exp_id: kept.expId, commit: kept.sha, eval_id: outcome.evalId,
    metrics: r?.ok ? r.metrics : { [b.cfg.primary_metric]: 0 },
    program_usd: r?.program_usd ?? 0, wall_s: r?.wall_s ?? 0, t_provision: r?.t_provision ?? 0,
    t_eval: r?.t_eval ?? 0, t_teardown: r?.t_teardown ?? 0, infra_errors: (r?.infra_errors ?? 0) + (outcome.ok ? 0 : 1),
    decision: ok ? "keep" : "error",
    ...(r ? { evaluator_instance: r.evaluator_instance, eval_order: r.eval_order } : {}),
    ...extra,
  });
}

export type KeepReason = "primary" | "efficiency";

export interface RoundDecision {
  rows: ResultRow[];
  /** The kept commit after this round's re-score, before any new keep. */
  parentAfter: Pick<Kept, "score" | "metrics" | "metricsPath" | "rescored">;
  /** The parent's metrics from this round's evaluator (re-score or baseline), what the branches compare against. */
  parentRun: Metrics | null;
  keep: { expId: string; sha: string; score: number; metrics: Metrics; reason: KeepReason } | null;
  summaries: Omit<BranchSummary, "diff">[];
  spend: number;
}

function readCodeState(cfg: NightConfig, nightId: string, expId: string): { coderUsd: number; devUsd?: number; tokens: number } {
  const f = join(nightPaths(cfg, nightId).expDir(expId), "code-state.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { coderUsd: 0, tokens: 0 };
}

/**
 * Keep rule, over the gate-passing branches:
 * - Primary: a branch whose primary gains >= max(min_gain, 2σ) over the parent's score. Of those within
 *   2σ of the best primary, the cheaper, then faster one wins (by the efficiency cut below).
 * - Efficiency, only when no branch gains on the primary: a branch whose primary stays within 2σ of
 *   both the parent's score and the night's best kept score, and that cuts an optimized metric by
 *   > max(min_efficiency_gain × parent, 2σ) without raising another one by that much.
 * Latency is compared only between evals on the same evaluator instance. Otherwise the round stays on the parent.
 */
export function decideRound(args: RowBase & {
  parent: Kept;
  sigma: number;
  /** σ of each optimized standard metric; 0 until measured. */
  effSigma?: Metrics;
  /** Highest re-scored primary the night has kept: an efficiency keep may not drift below it. */
  bestPrimary?: number;
  branches: BranchOutcome[];
  rescore: EvalOutcome | null;
  /** The parent's eval in the round's evaluator when it is already re-scored: recorded, its score unchanged. */
  baseline?: EvalOutcome | null;
  hypotheses: (string | null)[];
}): RoundDecision {
  const { cfg, parent } = args;
  const P = cfg.primary_metric;
  const rows: ResultRow[] = [];
  const parentAfter = { score: parent.score, metrics: parent.metrics, metricsPath: parent.metricsPath, rescored: parent.rescored };
  if (args.rescore) {
    rows.push(evalRow(args, parent, args.rescore, { kind: "rescore", parent_id: null }));
    if (args.rescore.ok && args.rescore.result.ok) {
      parentAfter.score = args.rescore.result.metrics[P];
      parentAfter.metrics = args.rescore.result.metrics;
      parentAfter.metricsPath = args.rescore.result.metricsPath;
      parentAfter.rescored = true;
    }
  }
  if (args.baseline) rows.push(evalRow(args, parent, args.baseline, { kind: "baseline", parent_id: null }));

  type Scored = { expId: string; branch: number; primary: number; metrics: Metrics; sha: string; eligible: boolean; instance: string };
  const scored: Scored[] = [];
  const branchRows: ResultRow[] = [];
  const summaries: RoundDecision["summaries"] = [];
  for (const b of args.branches) {
    if (!b.ok) {
      const st = readCodeState(cfg, args.nightId, b.expId);
      branchRows.push(baseRow(args, {
        exp_id: b.expId, parent_id: parent.expId, model: b.model, eval_id: `${b.expId}-eval`,
        hypothesis: args.hypotheses[b.branch] ?? `(failed: ${b.error.slice(0, 200)})`, metrics: { [P]: 0 },
        coder_usd: st.coderUsd, ...(st.devUsd ? { dev_usd: st.devUsd } : {}), tokens: st.tokens, decision: "error", infra_errors: 1,
      }));
      summaries.push({ expId: b.expId, model: b.model, hypothesis: args.hypotheses[b.branch] ?? "(unknown)", decision: "error", primary: 0, metrics: {} });
      continue;
    }
    const ev = b.eval;
    const evalOk = !!(b.code.sha && ev?.ok);
    const metrics = evalOk ? ev!.metrics : { [P]: 0 };
    const primary = metrics[P] ?? 0;
    const eligible = evalOk && passesGates(metrics, cfg.gates);
    if (evalOk) scored.push({ expId: b.expId, branch: b.branch, primary, metrics, sha: b.code.sha!, eligible, instance: ev!.evaluator_instance });
    branchRows.push(baseRow(args, {
      exp_id: b.expId, parent_id: parent.expId, model: b.model, hypothesis: b.code.hypothesis, commit: b.code.sha ?? "",
      eval_id: `${b.expId}-eval`, metrics, coder_usd: b.code.coder_usd, program_usd: ev?.program_usd ?? 0,
      ...(b.code.dev_usd ? { dev_usd: b.code.dev_usd } : {}),
      tokens: b.code.tokens,
      wall_s: Math.round((b.code.t_provision + b.code.t_code + b.code.t_teardown + (ev?.wall_s ?? 0)) * 100) / 100,
      decision: evalOk ? "revert" : "error",
      t_provision: b.code.t_provision + (ev?.t_provision ?? 0), t_code: b.code.t_code, t_eval: ev?.t_eval ?? 0,
      t_teardown: b.code.t_teardown + (ev?.t_teardown ?? 0),
      infra_errors: b.code.infra_errors + (ev?.infra_errors ?? 0) + (b.code.sha && !ev ? 1 : 0),
      ...(ev ? { evaluator_instance: ev.evaluator_instance, eval_order: ev.eval_order } : {}),
    }));
    summaries.push({ expId: b.expId, model: b.model, hypothesis: b.code.hypothesis, decision: evalOk ? "revert" : "error", primary, metrics });
  }

  // The parent's run in this round's evaluator: the reference for cost and latency.
  const parentEval = args.rescore ?? args.baseline ?? null;
  const parentRun = parentEval?.ok && parentEval.result.ok ? parentEval.result : null;
  const objectives = efficiencyMetrics(cfg);
  type Measured = { metrics: Metrics; instance: string };
  const comparable = (m: string, a: Measured, b: Measured) =>
    typeof a.metrics[m] === "number" && typeof b.metrics[m] === "number" && (!m.startsWith("latency_") || a.instance === b.instance);
  /** `a` is meaningfully lower than `b` on `m`. */
  const cuts = (m: string, a: Measured, b: Measured) =>
    comparable(m, a, b) && cutsMetric(a.metrics[m], b.metrics[m], cfg.standard_metrics.min_efficiency_gain, args.effSigma?.[m] ?? 0);
  /** The cheaper, then faster of two candidates; `a` (the higher primary) when neither is meaningfully better. */
  const prefer = (a: Scored, b: Scored) => {
    for (const m of objectives) {
      if (cuts(m, b, a)) return b;
      if (cuts(m, a, b)) return a;
    }
    return a;
  };

  const tol = 2 * args.sigma + 1e-12;
  const eligible = scored.filter((s) => s.eligible).sort((a, b) => b.primary - a.primary || a.branch - b.branch);
  const gainers = eligible.filter((s) => beatsParent(s.primary, parentAfter.score, cfg.min_gain, args.sigma));
  let pick: { s: Scored; reason: KeepReason } | null = null;
  if (gainers.length) {
    pick = { s: gainers.filter((s) => s.primary >= gainers[0].primary - tol).reduce(prefer), reason: "primary" };
  } else if (objectives.length && parentRun) {
    const ref = { metrics: parentRun.metrics, instance: parentRun.evaluator_instance };
    const floor = Math.max(parentAfter.score, args.bestPrimary ?? 0) - tol;
    const efficient = eligible.filter(
      (s) => s.primary >= floor && objectives.some((m) => cuts(m, s, ref)) && !objectives.some((m) => cuts(m, ref, s)),
    );
    if (efficient.length) pick = { s: efficient.reduce(prefer), reason: "efficiency" };
  }

  let keep: RoundDecision["keep"] = null;
  if (pick) {
    const best = pick.s;
    keep = { expId: best.expId, sha: best.sha, score: best.primary, metrics: best.metrics, reason: pick.reason };
    const row = branchRows.find((r) => r.exp_id === best.expId)!;
    row.decision = "keep";
    row.keep_reason = pick.reason;
    summaries.find((s) => s.expId === best.expId)!.decision = pick.reason === "efficiency" ? "keep (cheaper/faster)" : "keep";
  }
  rows.push(...branchRows);
  const spend = rows.reduce((a, r) => a + rowSpend(r), 0);
  return { rows, parentAfter, parentRun: parentRun?.metrics ?? null, keep, summaries, spend };
}

export async function reviewRound(args: {
  cfg: NightConfig;
  nightId: string;
  round: number;
  parentExpId: string;
  parentScore: number;
  parentMetrics: Metrics | null;
  summaries: RoundDecision["summaries"];
  log: HypothesisLogEntry[];
  validationGap?: number;
}): Promise<ReviewOutput> {
  const repo = new ExperimentRepo(nightPaths(args.cfg, args.nightId).gitDir);
  const results: BranchSummary[] = [];
  for (const s of args.summaries) {
    const diff = await repo.diff(args.parentExpId, s.expId).catch(() => "(no commit)");
    results.push({ ...s, diff });
  }
  const review = await runReview({
    model: args.cfg.reviewer_model,
    spec: readSpecText(args.cfg.spec_dir),
    round: args.round,
    branches: args.cfg.models.length,
    primaryMetric: args.cfg.primary_metric,
    thresholds: args.cfg.thresholds,
    gates: args.cfg.gates,
    parentScore: args.parentScore,
    parentMetrics: args.parentMetrics,
    objectives: efficiencyMetrics(args.cfg),
    minEfficiencyGain: args.cfg.standard_metrics.min_efficiency_gain,
    results,
    log: args.log,
    validationGap: args.validationGap,
  });
  const file = nightPaths(args.cfg, args.nightId).reviewJson(args.round);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ round: args.round, model: args.cfg.reviewer_model, ...review }, null, 2));
  return review;
}

export function recordRows(cfg: NightConfig, rows: ResultRow[]): number {
  appendRows(cfg.results_path, rows);
  return rows.length;
}

/** Noise floor: N evals of the first kept commit in one evaluator → σ of the primary; their mean doubles as its re-score. */
export function recordNoise(b: RowBase & { kept: Pick<Kept, "expId" | "sha">; outcomes: EvalOutcome[] }) {
  const P = b.cfg.primary_metric;
  const rows = b.outcomes.map((o) => evalRow(b, b.kept, o, { split: "noise", kind: "noise" }));
  appendRows(b.cfg.results_path, rows);
  const ok = b.outcomes.filter((o): o is Extract<EvalOutcome, { ok: true }> => o.ok && o.result.ok);
  if (!ok.length) return null;
  const all = ok.map((o) => o.result.metrics);
  const xs = all.map((m) => m[P]);
  const sigmas = noiseSigmas(b.cfg, all);
  const metrics: Metrics = { ...all[0], [P]: mean(xs) };
  for (const m of Object.keys(sigmas?.effSigma ?? {})) metrics[m] = mean(all.map((x) => x[m]));
  return {
    sigma: xs.length >= 2 ? stddev(xs) : 0,
    effSigma: sigmas?.effSigma ?? {},
    mean: mean(xs),
    metrics,
    metricsPath: ok[0].result.metricsPath,
  };
}

export function validateKept(b: RowBase & { kept: Kept; outcome: EvalOutcome }) {
  const P = b.cfg.primary_metric;
  const val = b.outcome.ok && b.outcome.result.ok ? b.outcome.result : null;
  if (!val || !b.kept.metricsPath) {
    appendRows(b.cfg.results_path, [evalRow(b, b.kept, b.outcome, { split: "val", kind: "validation", decision: "error" })]);
    return { ok: false as const };
  }
  const t = overfitTest(b.kept.score, val.metrics[P], readPerItem(b.kept.metricsPath), readPerItem(val.metricsPath!), b.cfg.overfit_gap);
  appendRows(b.cfg.results_path, [
    evalRow(b, b.kept, b.outcome, {
      split: "val", kind: "validation", decision: t.overfit ? "revert" : "keep",
      metrics: { ...val.metrics, gap: t.gap, gap_se: t.se },
    }),
  ]);
  return { ok: true as const, ...t };
}

export async function finishNight(b: RowBase & {
  kept: Kept;
  test: EvalOutcome;
  stopReason: string;
  rounds: number;
  spend: number;
  validations: number;
}) {
  appendRows(b.cfg.results_path, [evalRow(b, b.kept, b.test, { split: "test", kind: "test" })]);
  const swept = await sweepNight(b.nightId);
  const summary = {
    night_id: b.nightId,
    stop_reason: b.stopReason,
    rounds: b.rounds,
    validations: b.validations,
    kept: { exp_id: b.kept.expId, commit: b.kept.sha, opt_score: b.kept.score },
    test_metrics: b.test.ok && b.test.result.ok ? b.test.result.metrics : null,
    spend_usd: Math.round(b.spend * 10_000) / 10_000,
    leftover_sandboxes_destroyed: swept,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(nightPaths(b.cfg, b.nightId).doneJson, JSON.stringify(summary, null, 2));
  await writeReport(b.cfg);
  return summary;
}
