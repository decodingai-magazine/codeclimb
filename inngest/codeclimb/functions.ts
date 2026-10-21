// CodeClimb on Inngest: a thin parent run per night, one child run per
// experiment (`step.invoke`), one per extra eval. Children get their own
// `cancelOn` for the night-stop event: cancelling the parent alone may not
// cancel invoked children, and cancel never interrupts a running step.
import { invoke, staticSchema } from "inngest";
import { abortNight, abortRun } from "../../codeclimb/aborts";
import { sweepNight, sweepRun } from "../../codeclimb/cleanup";
import { type ExperimentInput, runCoder } from "../../codeclimb/coder";
import type { NightConfig } from "../../codeclimb/config";
import { type EvalRequest, runEval } from "../../codeclimb/evaluate";
import {
  type BranchOutcome,
  checkStop,
  decideRound,
  type EvalOutcome,
  evalRow,
  finishNight,
  initNight,
  type Kept,
  recordNoise,
  recordRows,
  reviewRound,
  validateKept,
} from "../../codeclimb/orchestrator";
import type { HypothesisLogEntry } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightStart, nightStop } from "./client";

const NOISE_RUNS = 5;

type ExperimentEvent = ExperimentInput & { optFolds: number[] };
type EvalEvent = { config: NightConfig; req: EvalRequest };

export const runExperiment = ccInngest.createFunction(
  {
    id: "run-experiment",
    triggers: [invoke(staticSchema<ExperimentEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.nightId" }],
  },
  async ({ event, step, attempt, runId }) => {
    const input = event.data;
    const code = await step.run("code", () => runCoder(input, { attempt, runId }));
    if (!code.sha) return { code, eval: null };
    const ev = await step.run("eval", () =>
      runEval(input.config, {
        nightId: input.nightId, evalId: `${input.expId}-eval`, expId: input.expId,
        split: "opt", folds: input.optFolds, runId,
      }),
    );
    // Native mirror of the metrics (not used for decisions).
    if (ev.ok) {
      for (const [name, value] of Object.entries(ev.metrics)) await step.score(`score-${name}`, { name, value });
    }
    return { code, eval: ev };
  },
);

export const runEvalFn = ccInngest.createFunction(
  {
    id: "run-eval",
    triggers: [invoke(staticSchema<EvalEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.req.nightId" }],
  },
  async ({ event, step, runId }) => step.run("eval", () => runEval(event.data.config, { ...event.data.req, runId })),
);

export const runNight = ccInngest.createFunction(
  {
    id: "run-night",
    triggers: [nightStart],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.night_id" }],
    // Backstop past any sane deadline + one round + the test eval; the deadline itself is a soft stop.
    timeouts: { finish: "24h" },
  },
  async ({ event, step }) => {
    const { night_id: nightId, config: cfg } = event.data;
    const init = await step.run("init", () => initNight(cfg, nightId));
    const B = cfg.models.length;
    const expTimeout = `${(cfg.timeouts.experiment_min + cfg.timeouts.eval_min) * 3 + 30}m`;
    const evalTimeout = `${cfg.timeouts.eval_min * 3 + 15}m`;

    const invokeEval = (id: string, req: Omit<EvalRequest, "nightId">): Promise<EvalOutcome> =>
      step
        .invoke(id, { function: runEvalFn, data: { config: cfg, req: { ...req, nightId } }, timeout: evalTimeout })
        .then(
          (result) => ({ ok: true as const, evalId: req.evalId, result }),
          (e: unknown) => ({ ok: false as const, evalId: req.evalId, error: String((e as Error)?.message ?? e) }),
        );

    let kept: Kept = {
      expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null, metricsPath: null,
      rescored: true, // round-1 parent = the starter repo, scored 0
      validatedFolds: [],
    };
    let sigma = init.sigma;
    let sigmaMeasured = init.sigmaMeasured;
    let valIdx = 0;
    let validations = 0;
    let feedback = "";
    let hypotheses: (string | null)[] = Array(B).fill(null);
    let validationGap: number | undefined;
    const log: HypothesisLogEntry[] = [];
    const roundSpends: number[] = [];
    let spend = 0;
    let stopReason = "";
    let round = 0;

    while (!stopReason) {
      round += 1;
      const check = await step.run(`r${round}-check`, () =>
        checkStop({ round, cfg, deadlineMs: init.deadlineMs, spend, roundSpends }),
      );
      if (check.stop) {
        stopReason = check.reason!;
        round -= 1;
        break;
      }
      const valFold = init.folds[valIdx];
      const optFolds = init.folds.filter((f) => f !== valFold);
      const rowBase = { cfg, nightId, round, valFold };

      // 3 experiments in parallel from the kept commit + the kept commit's re-score alongside.
      const parent = kept;
      const branchRuns = cfg.models.map((model, b): Promise<BranchOutcome> => {
        const expId = `${nightId}-r${round}-b${b}`;
        const data: ExperimentEvent = {
          nightId, expId, parentExpId: parent.expId, round, branch: b, model,
          feedback, hypothesis: hypotheses[b], config: cfg, optFolds,
        };
        return step.invoke(`r${round}-b${b}`, { function: runExperiment, data, timeout: expTimeout }).then(
          (out) => ({ ok: true as const, expId, branch: b, model, code: out.code, eval: out.eval }),
          (e: unknown) => ({ ok: false as const, expId, branch: b, model, error: String((e as Error)?.message ?? e) }),
        );
      });
      const rescoreRun = parent.rescored
        ? Promise.resolve(null)
        : invokeEval(`r${round}-rescore`, { evalId: `${nightId}-r${round}-rescore`, expId: parent.expId, split: "opt", folds: optFolds });
      const [branches, rescore] = await Promise.all([Promise.all(branchRuns), rescoreRun]);

      const decision = await step.run(`r${round}-decide`, () =>
        decideRound({ ...rowBase, parent, sigma, branches, rescore, hypotheses }),
      );
      kept = { ...kept, ...decision.parentAfter };

      // Review: feedback + one hypothesis per branch for the next round (skipped after the last round).
      let review = { feedback, hypotheses: hypotheses.map((h) => h ?? ""), reviewer_usd: 0, t_review: 0, tokens: 0 };
      if (round < cfg.max_rounds) {
        try {
          review = await step.run(`r${round}-review`, () =>
            reviewRound({
              cfg, nightId, round, parentExpId: parent.expId, parentScore: kept.score, parentMetrics: kept.metrics,
              summaries: decision.summaries, log: [...log], validationGap,
            }),
          );
        } catch {
          // A failed review keeps last round's guidance instead of killing the night.
        }
      }
      const rows = decision.rows.map((r) => ({ ...r, reviewer_usd: review.reviewer_usd, t_review: review.t_review }));
      await step.run(`r${round}-record`, () => recordRows(cfg, rows));

      const roundSpend = decision.spend + review.reviewer_usd;
      roundSpends.push(roundSpend);
      spend += roundSpend;
      for (const s of decision.summaries) {
        log.push({ round, hypothesis: s.hypothesis, deltaPrimary: s.primary - parent.score, decision: s.decision });
      }
      feedback = review.feedback;
      hypotheses = review.hypotheses;
      validationGap = undefined;

      if (decision.keep) {
        kept = { ...decision.keep, metricsPath: null, rescored: false, validatedFolds: [] };
        // Noise floor: on the first night, eval the first kept commit 5× in parallel (doubles as its re-score).
        if (!sigmaMeasured) {
          const outcomes = await Promise.all(
            Array.from({ length: NOISE_RUNS }, (_, i) =>
              invokeEval(`r${round}-noise-${i}`, { evalId: `${nightId}-r${round}-noise${i}`, expId: kept.expId, split: "opt", folds: optFolds }),
            ),
          );
          const noise = await step.run(`r${round}-noise`, () => recordNoise({ ...rowBase, kept, outcomes }));
          if (noise) {
            sigma = noise.sigma;
            sigmaMeasured = true;
            kept = { ...kept, score: noise.mean, metrics: noise.metrics, metricsPath: noise.metricsPath, rescored: true };
          }
        } else if (passesThresholds(kept.metrics ?? {}, cfg.thresholds)) {
          // The raw (best-of-N) score passes: re-score now, before validation, not alongside a round.
          const outcome = await invokeEval(`r${round}-rescore-now`, {
            evalId: `${nightId}-r${round}-rescore-now`, expId: kept.expId, split: "opt", folds: optFolds,
          });
          await step.run(`r${round}-rescore-record`, () =>
            recordRows(cfg, [evalRow(rowBase, kept, outcome, { kind: "rescore" })]),
          );
          if (outcome.ok && outcome.result.ok) {
            kept = { ...kept, score: outcome.result.metrics[cfg.primary_metric], metrics: outcome.result.metrics, metricsPath: outcome.result.metricsPath, rescored: true };
          }
        }
      }

      // Thresholds pass on the kept commit's re-score → validate on the held-out fold.
      if (kept.rescored && kept.metrics && passesThresholds(kept.metrics, cfg.thresholds) && !kept.validatedFolds.includes(valFold)) {
        if (validations >= cfg.max_validations) {
          stopReason = "max_validations";
          break;
        }
        const outcome = await invokeEval(`val-${validations}`, {
          evalId: `${nightId}-val${validations}`, expId: kept.expId, split: "val", folds: [valFold],
        });
        const v = await step.run(`val-${validations}-check`, () => validateKept({ ...rowBase, kept, outcome }));
        validations += 1;
        kept = { ...kept, validatedFolds: [...kept.validatedFolds, valFold] };
        if (v.ok && !v.overfit) {
          stopReason = "thresholds";
          break;
        }
        if (validations >= cfg.max_validations) {
          stopReason = "max_validations";
          break;
        }
        if (v.ok) {
          // Overfit: the next fold becomes validation; re-score the kept commit on the new optimization folds.
          valIdx = (valIdx + 1) % init.folds.length;
          kept = { ...kept, rescored: false };
          validationGap = v.gap;
          feedback = `${feedback}\n\nValidation gap (optimization − validation ${cfg.primary_metric}): ${v.gap.toFixed(4)}. The change overfits; prefer changes that generalize.`.trim();
        }
      }
    }

    // After any stop: score the final kept commit on test once, for the report only.
    const test = await invokeEval("test", { evalId: `${nightId}-test`, expId: kept.expId, split: "test", folds: [] });
    return step.run("finish", () =>
      finishNight({
        cfg, nightId, round, valFold: init.folds[valIdx], kept, test, stopReason, rounds: round, spend, validations,
      }),
    );
  },
);

/** Night stop: abort live Pi sessions of that night in this worker and destroy its sandboxes. */
export const onNightStop = ccInngest.createFunction(
  { id: "night-stop-cleanup", triggers: [nightStop] },
  async ({ event, step }) => {
    const aborted = await step.run("abort-pi", () => abortNight(event.data.night_id));
    const swept = await step.run("sweep", () => sweepNight({ sandbox: event.data.sandbox ?? "docker" }, event.data.night_id));
    return { aborted, swept };
  },
);

/** A cancelled run: abort its Pi session (if this worker runs it) and destroy the sandboxes it created. */
export const onRunCancelled = ccInngest.createFunction(
  { id: "run-cancelled-cleanup", triggers: [{ event: "inngest/function.cancelled" }] },
  async ({ event, step }) => {
    const runId = event.data.run_id;
    const aborted = await step.run("abort-pi", () => abortRun(runId));
    const swept = await step.run("sweep", () => sweepRun({ sandbox: "docker" }, runId));
    return { aborted, swept };
  },
);

export const codeclimbFunctions = [runNight, runExperiment, runEvalFn, onNightStop, onRunCancelled];
