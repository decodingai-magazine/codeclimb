// CodeClimb on Inngest: a thin parent run per night, one child run per
// experiment's coding phase (`step.invoke`) and one evaluator run per round and
// per extra eval, which evaluates its candidates in turn on one sandbox.
// Children get their own `cancelOn` for the night-stop event: cancelling the
// parent alone may not cancel invoked children, and cancel never interrupts a
// running step.
import { invoke, NonRetriableError, staticSchema } from "inngest";
import { abortNight, abortRun } from "../../codeclimb/aborts";
import { markStopped, sweepNight, sweepRun } from "../../codeclimb/cleanup";
import { type ExperimentInput, runCoder } from "../../codeclimb/coder";
import { efficiencyMetrics, rootConfig, type NightConfig } from "../../codeclimb/config";
import { closeEvaluator, type EvalRequest, evalCandidate, openEvaluator } from "../../codeclimb/evaluate";
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
  rotate,
  validateKept,
} from "../../codeclimb/orchestrator";
import { isEmbeddingModel } from "../../codeclimb/meter/backends";
import { checkModels } from "../../codeclimb/pi/session";
import { writeReport } from "../../codeclimb/report/html";
import type { HypothesisLogEntry } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightStart, nightStop } from "./client";

const NOISE_RUNS = 5;

type ExperimentEvent = ExperimentInput;
type EvalSpec = Omit<EvalRequest, "nightId" | "runId" | "order"> & {
  /** Attach the metrics as native scores to this run (the experiment's own run). */
  scoreRunId?: string;
};
type EvaluatorEvent = { config: NightConfig; nightId: string; evaluatorId: string; requests: EvalSpec[] };

export const runExperiment = ccInngest.createFunction(
  {
    id: "run-experiment",
    triggers: [invoke(staticSchema<ExperimentEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.nightId" }],
  },
  async ({ event, step, attempt, runId }) => {
    const code = await step.run("code", () => runCoder(event.data, { attempt, runId }));
    return { code, runId };
  },
);

/** Evaluates `requests` in order on one sandbox. A failed candidate is an `ok: false` outcome, not a failed run. */
export const runEvaluator = ccInngest.createFunction(
  {
    id: "run-evaluator",
    triggers: [invoke(staticSchema<EvaluatorEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.nightId" }],
  },
  async ({ event, step, runId }) => {
    const { config: cfg, nightId, evaluatorId, requests } = event.data;
    const outcomes: EvalOutcome[] = [];
    for (const [order, { scoreRunId, ...spec }] of requests.entries()) {
      try {
        const result = await step.run(`eval-${spec.evalId}`, async () =>
          evalCandidate(cfg, await openEvaluator(cfg, nightId, evaluatorId, runId), { ...spec, nightId, runId, order }),
        );
        outcomes.push({ ok: true, evalId: spec.evalId, result });
        // Native mirror of the metrics on the experiment's run (not used for decisions).
        if (scoreRunId && result.ok) {
          for (const [name, value] of Object.entries(result.metrics)) {
            await step.score(`score-${spec.evalId}-${name}`, { runId: scoreRunId, name, value }).catch(() => undefined);
          }
        }
      } catch (e) {
        outcomes.push({ ok: false, evalId: spec.evalId, error: String((e as Error)?.message ?? e) });
      }
    }
    await step.run("close", () => closeEvaluator(cfg, evaluatorId));
    return outcomes;
  },
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
    const nightId = event.data.night_id;
    // Paths arrive relative to the checkout; the children get them resolved against this worker's.
    const cfg = rootConfig(event.data.config);
    // The worker's own credentials, which may differ from the CLI's: fail once, not per experiment.
    await step.run("check-models", () =>
      checkModels([...cfg.models, cfg.reviewer_model, ...cfg.allowed_models.filter((m) => !isEmbeddingModel(m))]).catch((e: Error) => {
        throw new NonRetriableError(e.message);
      }),
    );
    const init = await step.run("init", () => initNight(cfg, nightId));
    const B = cfg.models.length;
    const expTimeout = `${cfg.timeouts.experiment_min * 3 + 30}m`;

    // One evaluator run (and sandbox, `cc-<night>-<id>`) per call; outcomes come back in run order.
    const invokeEvaluator = (id: string, requests: EvalSpec[]): Promise<EvalOutcome[]> =>
      step
        .invoke(id, {
          function: runEvaluator,
          data: { config: cfg, nightId, evaluatorId: `${nightId}-${id}`, requests },
          timeout: `${requests.length * cfg.timeouts.eval_min * 3 + 15}m`,
        })
        .then(
          (outcomes) => outcomes as EvalOutcome[],
          (e: unknown) => requests.map((r) => ({ ok: false as const, evalId: r.evalId, error: String((e as Error)?.message ?? e) })),
        );
    const invokeOne = (id: string, req: EvalSpec): Promise<EvalOutcome> => invokeEvaluator(id, [req]).then((o) => o[0]);

    let kept: Kept = {
      expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null, metricsPath: null,
      rescored: true, // round-1 parent = the starter repo, scored 0
      validatedFolds: [],
    };
    let sigma = init.sigma;
    let effSigma = init.effSigma;
    let sigmaMeasured = init.sigmaMeasured;
    // Highest re-scored primary kept so far: efficiency keeps may not drift below it.
    let bestPrimary = 0;
    const noteKept = () => {
      if (kept.rescored) bestPrimary = Math.max(bestPrimary, kept.score);
    };
    let valIdx = 0;
    let validations = 0;
    let feedback = "";
    let hypotheses: (string | null)[] = Array(B).fill(null);
    let validationGap: number | undefined;
    const log: HypothesisLogEntry[] = [];
    const roundSpends: number[] = [];
    let spend = 0;
    let maxEvalUsd = 0;
    let stopReason = "";
    let round = 0;

    while (!stopReason) {
      round += 1;
      const check = await step.run(`r${round}-check`, () =>
        checkStop({ round, cfg, deadlineMs: init.deadlineMs, spend, roundSpends, maxEvalUsd }),
      );
      if (check.stop) {
        stopReason = check.reason!;
        round -= 1;
        break;
      }
      const valFold = init.folds[valIdx];
      const optFolds = init.folds.filter((f) => f !== valFold);
      const rowBase = { cfg, nightId, round, valFold };

      // The coders work in parallel from the kept commit.
      const parent = kept;
      const coded = await Promise.all(
        cfg.models.map((model, b) => {
          const expId = `${nightId}-r${round}-b${b}`;
          const data: ExperimentEvent = {
            nightId, expId, parentExpId: parent.expId, round, branch: b, model,
            feedback, hypothesis: hypotheses[b], config: cfg,
          };
          return step.invoke(`r${round}-b${b}`, { function: runExperiment, data, timeout: expTimeout }).then(
            (out) => ({ ok: true as const, expId, branch: b, model, code: out.code, runId: out.runId }),
            (e: unknown) => ({ ok: false as const, expId, branch: b, model, error: String((e as Error)?.message ?? e) }),
          );
        }),
      );

      // Then one evaluator, with every coder stopped: the parent and each committed branch in turn.
      const parentSpec: EvalSpec = {
        evalId: `${nightId}-r${round}-${parent.rescored ? "baseline" : "rescore"}`, expId: parent.expId, split: "opt", folds: optFolds,
      };
      const specs: EvalSpec[] = [parentSpec];
      for (const c of coded) {
        if (c.ok && c.code.sha) specs.push({ evalId: `${c.expId}-eval`, expId: c.expId, split: "opt", folds: optFolds, scoreRunId: c.runId });
      }
      const evals = new Map((await invokeEvaluator(`r${round}-eval`, rotate(specs, round))).map((o) => [o.evalId, o]));
      const branches: BranchOutcome[] = coded.map((c) => {
        if (!c.ok) return c;
        const o = evals.get(`${c.expId}-eval`);
        return { ok: true, expId: c.expId, branch: c.branch, model: c.model, code: c.code, eval: o?.ok ? o.result : null };
      });
      const parentEval = evals.get(parentSpec.evalId)!;

      const decision = await step.run(`r${round}-decide`, () =>
        decideRound({
          ...rowBase, parent, sigma, effSigma, bestPrimary, branches, hypotheses,
          rescore: parent.rescored ? null : parentEval,
          baseline: parent.rescored ? parentEval : null,
        }),
      );
      kept = { ...kept, ...decision.parentAfter };
      noteKept();

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
      await step.run(`r${round}-record`, async () => {
        const n = recordRows(cfg, rows);
        await writeReport(cfg); // live report after every round; never throws
        return n;
      });

      maxEvalUsd = Math.max(maxEvalUsd, ...rows.map((r) => r.program_usd));
      const roundSpend = decision.spend + review.reviewer_usd;
      roundSpends.push(roundSpend);
      spend += roundSpend;
      for (const s of decision.summaries) {
        const deltas = Object.fromEntries(
          efficiencyMetrics(cfg).flatMap((m) =>
            typeof s.metrics[m] === "number" && typeof decision.parentRun?.[m] === "number" ? [[m, s.metrics[m] - decision.parentRun[m]]] : [],
          ),
        );
        log.push({ round, hypothesis: s.hypothesis, deltaPrimary: s.primary - parent.score, deltas, decision: s.decision });
      }
      feedback = review.feedback;
      hypotheses = review.hypotheses;
      validationGap = undefined;

      if (decision.keep) {
        const { reason: _, ...k } = decision.keep;
        kept = { ...k, metricsPath: null, rescored: false, validatedFolds: [] };
        // Noise floor: on the first night, eval the first kept commit 5× in one evaluator (doubles as its re-score).
        if (!sigmaMeasured) {
          const outcomes = await invokeEvaluator(
            `r${round}-noise`,
            Array.from({ length: NOISE_RUNS }, (_, i) => ({
              evalId: `${nightId}-r${round}-noise${i}`, expId: kept.expId, split: "opt" as const, folds: optFolds,
            })),
          );
          const noise = await step.run(`r${round}-noise`, () => recordNoise({ ...rowBase, kept, outcomes }));
          if (noise) {
            sigma = noise.sigma;
            effSigma = noise.effSigma;
            sigmaMeasured = true;
            kept = { ...kept, score: noise.mean, metrics: noise.metrics, metricsPath: noise.metricsPath, rescored: true };
            noteKept();
          }
        } else if (passesThresholds(kept.metrics ?? {}, cfg.thresholds)) {
          // The raw (best-of-N) score passes: re-score now, before validation, not alongside a round.
          const outcome = await invokeOne(`r${round}-rescore-now`, {
            evalId: `${nightId}-r${round}-rescore-now`, expId: kept.expId, split: "opt", folds: optFolds,
          });
          await step.run(`r${round}-rescore-record`, () =>
            recordRows(cfg, [evalRow(rowBase, kept, outcome, { kind: "rescore" })]),
          );
          if (outcome.ok && outcome.result.ok) {
            kept = { ...kept, score: outcome.result.metrics[cfg.primary_metric], metrics: outcome.result.metrics, metricsPath: outcome.result.metricsPath, rescored: true };
            noteKept();
          }
        }
      }

      // Thresholds pass on the kept commit's re-score → validate on the held-out fold.
      if (kept.rescored && kept.metrics && passesThresholds(kept.metrics, cfg.thresholds) && !kept.validatedFolds.includes(valFold)) {
        if (validations >= cfg.max_validations) {
          stopReason = "max_validations";
          break;
        }
        const outcome = await invokeOne(`val-${validations}`, {
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
    const test = await invokeOne("test", { evalId: `${nightId}-test`, expId: kept.expId, split: "test", folds: [] });
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
    const swept = await step.run("sweep", () => sweepNight(event.data.night_id));
    await step.run("mark-stopped", () => markStopped(event.data.night_id, event.data.reason ?? "stop"));
    return { aborted, swept };
  },
);

/** A cancelled run: abort its Pi session (if this worker runs it) and destroy the sandboxes it created. */
export const onRunCancelled = ccInngest.createFunction(
  { id: "run-cancelled-cleanup", triggers: [{ event: "inngest/function.cancelled" }] },
  async ({ event, step }) => {
    const runId = event.data.run_id;
    const aborted = await step.run("abort-pi", () => abortRun(runId));
    const swept = await step.run("sweep", () => sweepRun(runId));
    return { aborted, swept };
  },
);

export const codeclimbFunctions = [runNight, runExperiment, runEvaluator, onNightStop, onRunCancelled];
