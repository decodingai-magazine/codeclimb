// Step bodies for the night run. Each takes plain data and returns plain,
// small JSON (SHAs, metrics, file paths), so the parent's state can be rebuilt
// from memoized step outputs on replay.
import type { CreditStop } from "./credits";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { sweepNight } from "./cleanup";
import type { CodeResult } from "./coder";
import { readSpecText } from "./coder";
import { efficiencyMetrics, type NightConfig, resolveDeadline } from "./config";
import type { EvalResult } from "./evaluate";
import { ExperimentRepo } from "./git";
import { nightPaths } from "./paths";
import { writeReport } from "./report/html";
import { appendRows, readRows, type ResultRow, rowSpend } from "./results";
import { type BranchSummary, type HypothesisLogEntry, runReview, type ReviewOutput } from "./reviewer";
import { hostCommand, readProtocol, type RepoCheck } from "./scenario";
import { beatsParent, cutsMetric, guardrailFailures, type Metrics, passesGates } from "./stats";

/** What the parent tracks about the commit the next round starts from. */
export interface Kept {
  expId: string;
  sha: string;
  /** Score used by the keep rule: the re-score when `rescored`, else the raw best-of-N score. */
  score: number;
  metrics: Metrics | null;
  /** metrics.json of the latest dev re-score. */
  metricsPath: string | null;
  rescored: boolean;
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

/** `xs` rotated left by `k`: the round's evaluation order, so no candidate always runs first. Replay-stable. */
export function rotate<T>(xs: T[], k: number): T[] {
  if (!xs.length) return xs;
  const i = ((k % xs.length) + xs.length) % xs.length;
  return [...xs.slice(i), ...xs.slice(0, i)];
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

export type BranchOutcome =
  | { ok: true; expId: string; branch: number; model: string; code: CodeResult; eval: EvalResult | null }
  | { ok: false; expId: string; branch: number; model: string; error: string };

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

/** Row for an extra eval (re-score, baseline, test) of an existing commit. */
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

const MAX_DETAILS_CHARS = 12_000;

export type KeepReason = "primary" | "efficiency" | "reviewer";

export interface RoundDecision {
  rows: ResultRow[];
  /** The kept commit after this round's re-score, before any new keep. */
  parentAfter: Pick<Kept, "score" | "metrics" | "metricsPath" | "rescored">;
  /** The parent's metrics from this round's evaluator (re-score or baseline), what the branches compare against. */
  parentRun: Metrics | null;
  keep: { expId: string; sha: string; score: number; metrics: Metrics; reason: KeepReason } | null;
  /** Branches that passed the gates and guardrails: what the reviewer picks from. */
  candidates: { expId: string; sha: string; score: number; metrics: Metrics }[];
  summaries: (Omit<BranchSummary, "diff" | "details"> & { metricsPath: string | null })[];
  spend: number;
}

function readCodeState(cfg: NightConfig, nightId: string, expId: string): { coderUsd: number; devUsd?: number; tokens: number } {
  const f = join(nightPaths(cfg, nightId).expDir(expId), "code-state.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : { coderUsd: 0, tokens: 0 };
}

/**
 * The mechanical pass over a round. A branch is a candidate if it passes the gates and the guardrails
 * (no headline regression against the parent's run in this round, no stage gone empty). The reviewer
 * then picks among the candidates (`applyReview`); the rule below stands when no review came back:
 * - Primary: the candidate whose primary gains >= min_gain over the parent's score, ties to the cheaper, then faster.
 * - Efficiency, only when no candidate gains on the primary: one whose primary stays at both the parent's
 *   score and the night's best kept score, and that cuts an optimized metric by > min_efficiency_gain × parent
 *   without raising another one by that much.
 * Latency is compared only between evals on the same evaluator instance. Otherwise the round stays on the parent.
 */
export function decideRound(args: RowBase & {
  parent: Kept;
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

  // The parent's run in this round's evaluator: the reference for guardrails, cost and latency.
  const parentEval = args.rescore ?? args.baseline ?? null;
  const parentRun = parentEval?.ok && parentEval.result.ok ? parentEval.result : null;

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
      summaries.push({ expId: b.expId, model: b.model, hypothesis: args.hypotheses[b.branch] ?? "(unknown)", decision: "error", primary: 0, metrics: {}, guardrails: [], notes: [], metricsPath: null });
      continue;
    }
    const ev = b.eval;
    const evalOk = !!(b.code.sha && ev?.ok);
    const metrics = evalOk ? ev!.metrics : { [P]: 0 };
    const primary = metrics[P] ?? 0;
    const failedCheck = b.code.check?.errors ?? [];
    const guardrails = evalOk && parentRun ? guardrailFailures(metrics, parentRun.metrics, cfg.scenario.headline) : [...failedCheck, ...(ev?.error ? [ev.error.slice(0, 500)] : [])];
    const eligible = evalOk && passesGates(metrics, cfg.gates) && !guardrails.length;
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
      infra_errors: b.code.infra_errors + (ev?.infra_errors ?? 0) + (b.code.sha && !ev && !failedCheck.length ? 1 : 0),
      ...(ev ? { evaluator_instance: ev.evaluator_instance, eval_order: ev.eval_order } : {}),
    }));
    summaries.push({ expId: b.expId, model: b.model, hypothesis: b.code.hypothesis, decision: evalOk ? "revert" : "error", primary, metrics, guardrails, notes: b.code.check?.notes ?? [], metricsPath: ev?.metricsPath ?? null });
  }

  const objectives = efficiencyMetrics(cfg);
  type Measured = { metrics: Metrics; instance: string };
  const comparable = (m: string, a: Measured, b: Measured) =>
    typeof a.metrics[m] === "number" && typeof b.metrics[m] === "number" && (!m.startsWith("latency_") || a.instance === b.instance);
  /** `a` is meaningfully lower than `b` on `m`. */
  const cuts = (m: string, a: Measured, b: Measured) =>
    comparable(m, a, b) && cutsMetric(a.metrics[m], b.metrics[m], cfg.standard_metrics.min_efficiency_gain);
  /** The cheaper, then faster of two candidates; `a` (the higher primary) when neither is meaningfully better. */
  const prefer = (a: Scored, b: Scored) => {
    for (const m of objectives) {
      if (cuts(m, b, a)) return b;
      if (cuts(m, a, b)) return a;
    }
    return a;
  };

  const eligible = scored.filter((s) => s.eligible).sort((a, b) => b.primary - a.primary || a.branch - b.branch);
  const gainers = eligible.filter((s) => beatsParent(s.primary, parentAfter.score, cfg.min_gain));
  let pick: { s: Scored; reason: KeepReason } | null = null;
  if (gainers.length) {
    pick = { s: gainers.filter((s) => s.primary === gainers[0].primary).reduce(prefer), reason: "primary" };
  } else if (objectives.length && parentRun) {
    const ref = { metrics: parentRun.metrics, instance: parentRun.evaluator_instance };
    const floor = Math.max(parentAfter.score, args.bestPrimary ?? 0);
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
  const candidates = eligible.map((s) => ({ expId: s.expId, sha: s.sha, score: s.primary, metrics: s.metrics }));
  return { rows, parentAfter, parentRun: parentRun?.metrics ?? null, keep, candidates, summaries, spend };
}

/** The round with the reviewer's pick (a candidate, or null to keep nothing) in place of the mechanical one. */
export function applyReview(d: RoundDecision, keepId: string | null): RoundDecision {
  const pick = d.candidates.find((c) => c.expId === keepId) ?? null;
  const decided = (expId: string, fallback: string) => (expId === pick?.expId ? "keep" : expId === d.keep?.expId ? "revert" : fallback);
  return {
    ...d,
    keep: pick && { ...pick, reason: "reviewer" },
    rows: d.rows.map((r) => {
      if (r.kind !== "experiment" || r.exp_id !== pick?.expId && r.exp_id !== d.keep?.expId) return r;
      const { keep_reason: _, ...rest } = r;
      return r.exp_id === pick?.expId ? { ...rest, decision: "keep", keep_reason: "reviewer" } : { ...rest, decision: "revert" };
    }),
    summaries: d.summaries.map((s) => ({ ...s, decision: decided(s.expId, s.decision) })),
  };
}

/** Per-item errors of a branch's dev eval, per stage, capped: what `details` in a stage report holds. */
function readDetails(cfg: NightConfig, metricsPath: string | null): string {
  if (!metricsPath) return "";
  const parts = cfg.scenario.stages.flatMap((stage) => {
    const file = join(dirname(metricsPath), stage.name, "report.json");
    if (!stage.details || !existsSync(file)) return [];
    const { details } = JSON.parse(readFileSync(file, "utf8")) as { details?: unknown };
    return details === undefined ? [] : [`### ${stage.name}\n${JSON.stringify(details).slice(0, MAX_DETAILS_CHARS)}`];
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
  /** This round's run of the parent, not yet in the results file. */
  parentRun: Metrics | null;
  summaries: RoundDecision["summaries"];
  /** The branches it may keep, and what the mechanical rule would keep. */
  candidates: string[];
  mechanicalKeep: string | null;
  log: HypothesisLogEntry[];
  /** Branches the next round runs: one hypothesis each. */
  branches: number;
}): Promise<ReviewOutput> {
  const repo = new ExperimentRepo(nightPaths(args.cfg, args.nightId).gitDir);
  const results: BranchSummary[] = [];
  for (const { metricsPath, ...s } of args.summaries) {
    const diff = await repo.diff(args.parentExpId, s.expId).catch(() => "(no commit)");
    results.push({ ...s, diff, details: readDetails(args.cfg, metricsPath) });
  }
  const review = await runReview({
    model: args.cfg.reviewer_model,
    spec: readSpecText(nightPaths(args.cfg, args.nightId).bundleDir),
    round: args.round,
    branches: args.branches,
    primaryMetric: args.cfg.primary_metric,
    thresholds: args.cfg.thresholds,
    gates: args.cfg.gates,
    parentScore: args.parentScore,
    parentMetrics: args.parentMetrics,
    parentRuns: [
      ...readRows(args.cfg.results_path).filter((r) => r.night_id === args.nightId && r.exp_id === args.parentExpId && r.split === "dev" && r.decision !== "error").map((r) => r.metrics),
      ...(args.parentRun ? [args.parentRun] : []),
    ],
    objectives: efficiencyMetrics(args.cfg),
    minEfficiencyGain: args.cfg.standard_metrics.min_efficiency_gain,
    results,
    log: args.log,
    candidates: args.candidates,
    mechanicalKeep: args.mechanicalKeep,
    headline: Object.keys(args.cfg.scenario.headline),
    protocol: readProtocol(args.cfg.scenario_dir, args.cfg.scenario.protocol),
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
