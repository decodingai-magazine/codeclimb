// CodeClimb on Inngest: a thin parent run per night, a linear loop of one experiment per round.
// Each round is one child run for the coding phase (`step.invoke`) and one evaluator run, on its
// own sandbox. A worse experiment is reviewed, then dropped: the next round restarts from the checkpoint.
// Children get their own `cancelOn` for the night-stop event: cancelling the
// parent alone may not cancel invoked children, and cancel never interrupts a
// running step.
import { invoke, NonRetriableError, staticSchema } from "inngest";
import { abortNight, abortRun } from "../../codeclimb/aborts";
import { markStopped, sweepNight, sweepRun } from "../../codeclimb/cleanup";
import { type EvalFailure, type ExperimentInput, runCoder } from "../../codeclimb/coder";
import { efficiencyMetrics, evalMinutes, rootConfig, type NightConfig } from "../../codeclimb/config";
import { OutOfCredits } from "../../codeclimb/credits";
import { closeEvaluator, type EvalRequest, evalCandidate, openEvaluator } from "../../codeclimb/evaluate";
import {
  applyReview,
  checkRepo,
  checkStop,
  creditStopOf,
  decideRound,
  endPause,
  type EvalOutcome,
  type ExperimentOutcome,
  finishNight,
  initNight,
  type Kept,
  maskFailures,
  markPaused,
  type PausedAt,
  recordRows,
  reviewRound,
} from "../../codeclimb/orchestrator";
import { checkNightModels } from "../../codeclimb/meter/backends";
import { writeReport } from "../../codeclimb/report/html";
import type { HypothesisLogEntry, ReviewOutput } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightResume, nightStart, nightStop } from "./client";


/** How long a night waits for credits before it stops. Stay under `run-night`'s `timeouts.finish`. */
const PAUSE_TIMEOUT = "3d";

type ExperimentEvent = ExperimentInput;
type EvalSpec = Omit<EvalRequest, "nightId" | "runId" | "order"> & {
  /** Attach the metrics as native scores to this run (the experiment's own run). */
  scoreRunId?: string;
};
type EvaluatorEvent = { config: NightConfig; nightId: string; evaluatorId: string; request: EvalSpec };

export const runExperiment = ccInngest.createFunction(
  {
    id: "run-experiment",
    triggers: [invoke(staticSchema<ExperimentEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.nightId" }],
  },
  async ({ event, step, attempt, runId }) => {
    const code = await step.run("code", () => runCoder(event.data, { attempt, runId }));
    if (!code.sha || code.credits || !event.data.config.scenario.check) return { code, runId };
    const check = await step.run("check", () => checkRepo(event.data.config, event.data.nightId, event.data.expId));
    return { code: { ...code, check }, runId };
  },
);

/** Evaluates one commit on one sandbox. A failed evaluation is an `ok: false` outcome, not a failed run. */
export const runEvaluator = ccInngest.createFunction(
  {
    id: "run-evaluator",
    triggers: [invoke(staticSchema<EvaluatorEvent>())],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.nightId" }],
  },
  async ({ event, step, runId }) => {
    const { config: cfg, nightId, evaluatorId, request: { scoreRunId, ...spec } } = event.data;
    let outcome: EvalOutcome;
    try {
      const result = await step.run(`eval-${spec.evalId}`, async () =>
        evalCandidate(cfg, await openEvaluator(cfg, nightId, evaluatorId, runId), { ...spec, nightId, runId }),
      );
      outcome = { ok: true, evalId: spec.evalId, result };
      // Native mirror of the metrics on the experiment's run (not used for decisions).
      if (scoreRunId && result.ok) {
        // Sorted: a memoized result's keys may come back in another order, and step ids must replay the same.
        const headline = Object.keys(cfg.scenario.headline);
        const names = headline.length ? [cfg.primary_metric, ...headline] : Object.keys(result.metrics);
        for (const name of [...new Set(names)].sort()) {
          const value = result.metrics[name];
          if (value === undefined) continue;
          await step.score(`score-${spec.evalId}-${name}`, { runId: scoreRunId, name, value }).catch(() => undefined);
        }
      }
    } catch (e) {
      outcome = { ok: false, evalId: spec.evalId, error: String((e as Error)?.message ?? e) };
    }
    await step.run("close", () => closeEvaluator(cfg, evaluatorId));
    return outcome;
  },
);

export const runNight = ccInngest.createFunction(
  {
    id: "run-night",
    triggers: [nightStart],
    retries: 2,
    cancelOn: [{ event: nightStop, if: "async.data.night_id == event.data.night_id" }],
    // Backstop past any sane deadline + one round + the test eval + a pause (PAUSE_TIMEOUT); the deadline
    // itself is a soft stop. A timeout cancels this run; `onRunCancelled` turns that into a night stop.
    timeouts: { finish: "4d" },
    // Out of retries: stop the night through the one cleanup path (`cancelOn` + `night-stop-cleanup`).
    onFailure: async ({ event, step }) => {
      const nightId = String(event.data.event.data.night_id);
      await step.sendEvent("stop-night", { name: nightStop.name, data: { night_id: nightId, reason: "failed" } });
    },
  },
  async ({ event, step }) => {
    const nightId = event.data.night_id;
    // Paths arrive relative to the checkout; the children get them resolved against this worker's.
    const cfg = rootConfig(event.data.config);
    // The worker's own credentials, which may differ from the CLI's: fail once, not per experiment.
    await step.run("check-models", () =>
      checkNightModels(cfg).catch((e: Error) => {
        throw new NonRetriableError(e.message);
      }),
    );
    const init = await step.run("init", () => initNight(cfg, nightId));
    const expTimeout = `${cfg.timeouts.experiment_min * 3 + 30}m`;

    // One evaluator run (and sandbox, `cc-<night>-<id>`) per call.
    const invokeEvaluator = (id: string, request: EvalSpec): Promise<EvalOutcome> =>
      step
        .invoke(id, {
          function: runEvaluator,
          data: { config: cfg, nightId, evaluatorId: `${nightId}-${id}`, request },
          timeout: `${evalMinutes(cfg) * 3 + 15}m`,
        })
        .then(
          (outcome) => outcome as EvalOutcome,
          (e: unknown) => ({ ok: false as const, evalId: request.evalId, error: String((e as Error)?.message ?? e) }),
        );

    // Out of credits: the night waits here for `night.resume`, with no sandbox running, and costs nothing.
    // Only the parent waits: a child waiting would run into its `step.invoke` timeout. What finished stays
    // memoized, so after the resume only what stopped runs again, under new step ids.
    let pauses = 0;
    let deadlineMs = init.deadlineMs;
    const pauseForCredits = async (round: number, stops: PausedAt[]) => {
      pauses += 1;
      const pausedAt = await step.run(`pause-${pauses}`, () => markPaused(cfg, nightId, round, stops));
      const resumed = await step.waitForEvent(`pause-${pauses}-resume`, {
        event: nightResume, timeout: PAUSE_TIMEOUT, if: "async.data.night_id == event.data.night_id",
      });
      if (!resumed) throw new NonRetriableError(`paused for ${PAUSE_TIMEOUT} with no resume`);
      deadlineMs += await step.run(`pause-${pauses}-end`, () => endPause(cfg, nightId, pausedAt));
    };

    // One evaluation, however many pauses it takes.
    const evaluate = async (id: string, round: number, spec: EvalSpec): Promise<EvalOutcome> => {
      for (let n = 0; ; n += 1) {
        const outcome = await invokeEvaluator(n ? `${id}-resume${n}` : id, spec);
        const stop = creditStopOf(outcome);
        if (!stop) return outcome;
        if (outcome.ok) spend += outcome.result.program_usd;
        await pauseForCredits(round, [{ ...stop, where: `evaluation ${outcome.evalId.replace(`${nightId}-`, "")}` }]);
      }
    };

    let spend = 0;
    // The checkpoint. Round 1's is the starter repo, scored 0 and never evaluated.
    let kept: Kept = { expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null };
    let feedback = "";
    let failures: EvalFailure[] = [];
    let hypothesis: string | null = null;
    const log: HypothesisLogEntry[] = [];
    const roundSpends: number[] = [];
    const roundTokens: number[] = [];
    let tokens = 0;
    let roundsWithoutKeep = 0;
    let maxEvalUsd = 0;
    let stopReason = "";
    let round = 0;

    while (!stopReason) {
      round += 1;
      const check = await step.run(`r${round}-check`, () =>
        checkStop({ round, cfg, deadlineMs, spend, roundSpends, maxEvalUsd, tokens, roundTokens, roundsWithoutKeep }),
      );
      if (check.stop) {
        stopReason = check.reason!;
        round -= 1;
        break;
      }
      const rowBase = { cfg, nightId, round };

      // One experiment from the checkpoint, with what the reviewer said about the last one.
      const parent = kept;
      const expId = `${nightId}-r${round}-e0`;
      const code = (resume: number) => {
        const data: ExperimentEvent = {
          nightId, expId, parentExpId: parent.expId, round, model: cfg.model,
          feedback, failures, hypothesis, config: cfg, ...(resume ? { resume: true } : {}),
        };
        return step.invoke(`r${round}-e0${resume ? `-resume${resume}` : ""}`, { function: runExperiment, data, timeout: expTimeout }).then(
          (out) => ({ ok: true as const, code: out.code, runId: out.runId }),
          (e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }),
        );
      };
      let coded = await code(0);
      for (let n = 1; coded.ok && coded.code.credits; n += 1) {
        await pauseForCredits(round, [{ ...coded.code.credits, where: `experiment ${expId.replace(`${nightId}-`, "")}` }]);
        coded = await code(n);
      }

      // Then its evaluation on dev, with the coder stopped.
      let experiment: ExperimentOutcome;
      if (coded.ok) {
        const evaluated = coded.code.sha && !coded.code.check?.errors.length
          ? await evaluate(`r${round}-eval`, round, { evalId: `${expId}-eval`, expId, split: "dev", scoreRunId: coded.runId })
          : null;
        experiment = { ok: true, expId, model: cfg.model, code: coded.code, eval: evaluated?.ok ? evaluated.result : null };
      } else {
        experiment = { ok: false, expId, model: cfg.model, error: coded.error };
      }

      const decided = await step.run(`r${round}-decide`, () => decideRound({ ...rowBase, parent, experiment, hypothesis }));

      // Review, even of a reverted experiment: its feedback is what the next round learns from it. After
      // the last round with nothing to keep there is nothing to ask.
      let review: Omit<ReviewOutput, "keep"> = { keep_reason: "", feedback, hypothesis: hypothesis ?? "", reviewer_usd: 0, t_review: 0, tokens: 0 };
      let decision = decided;
      if (round < cfg.max_rounds || decided.candidate) {
        for (let n = 0; ; n += 1) {
          let reviewed;
          try {
            reviewed = await step.run(`r${round}-review${n ? `-resume${n}` : ""}`, () =>
              reviewRound({
                cfg, nightId, round, parentExpId: parent.expId, parentScore: parent.score, parentMetrics: parent.metrics,
                summary: decided.summary, canKeep: !!decided.candidate, log: [...log],
              }).catch((e: unknown) => {
                if (e instanceof OutOfCredits) return { credits: e.stop };
                throw e;
              }),
            );
          } catch {
            break; // A failed review reverts and keeps last round's guidance instead of killing the night.
          }
          if ("credits" in reviewed) {
            await pauseForCredits(round, [{ ...reviewed.credits, where: `review of round ${round}` }]);
            continue;
          }
          review = reviewed;
          decision = applyReview(decided, reviewed.keep);
          break;
        }
      }
      const row = { ...decision.row, reviewer_usd: review.reviewer_usd, t_review: review.t_review };
      await step.run(`r${round}-record`, async () => {
        const n = recordRows(cfg, [row]);
        await writeReport(cfg); // live report after every round; never throws
        return n;
      });

      maxEvalUsd = Math.max(maxEvalUsd, row.program_usd);
      const roundSpend = decision.spend + review.reviewer_usd;
      roundSpends.push(roundSpend);
      spend += roundSpend;
      const roundTok = (row.tokens ?? 0) + review.tokens;
      roundTokens.push(roundTok);
      tokens += roundTok;
      roundsWithoutKeep = decision.keep ? 0 : roundsWithoutKeep + 1;
      const s = decision.summary;
      const scored = [...efficiencyMetrics(cfg), ...Object.keys(cfg.scenario.headline)].filter((m) => s.decision !== "error" && typeof s.metrics[m] === "number");
      const against = parent.metrics;
      const moved = against
        ? { deltas: Object.fromEntries(scored.flatMap((m) => (typeof against[m] === "number" ? [[m, s.metrics[m] - against[m]]] : []))) }
        : { scores: Object.fromEntries(scored.map((m) => [m, s.metrics[m]])) };
      log.push({
        round, hypothesis: s.hypothesis, deltaPrimary: s.primary - parent.score, ...moved, decision: s.decision,
        // An error's tail names the failure; its head is the command, and coders get it whole.
        reason: s.errors?.join("; ").slice(-300) ?? (s.guardrails.join("; ") || review.keep_reason),
      });
      feedback = review.feedback;
      failures = await step.run(`r${round}-failures`, () => maskFailures(cfg, s.errors ? [{ expId: s.expId, errors: s.errors }] : []));
      hypothesis = review.hypothesis;

      if (decision.keep) {
        const { expId: keptId, sha, score, metrics } = decision.keep;
        kept = { expId: keptId, sha, score, metrics };
      }

      // Thresholds pass on the checkpoint's dev scores: done.
      if (kept.metrics && passesThresholds(kept.metrics, cfg.thresholds)) stopReason = "thresholds";
    }

    // After any stop: score the final kept commit on test once, for the report only.
    const test = await evaluate("test", round, { evalId: `${nightId}-test`, expId: kept.expId, split: "test" });
    if (test.ok) spend += test.result.program_usd;
    return step.run("finish", () => finishNight({ cfg, nightId, round, kept, test, stopReason, rounds: round, spend }));
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

/**
 * A cancelled run: abort its Pi session (if this worker runs it) and destroy the sandboxes it created.
 * A cancelled `run-night` (a `timeouts.finish` hit, or a stop) also stops its night: the parent creates
 * no sandboxes itself, so sweeping its run id alone would leave the children running. After a stop this
 * sends a second `night.stop`; its cleanup reruns and ends there, because `run-night` is already cancelled.
 */
export const onRunCancelled = ccInngest.createFunction(
  { id: "run-cancelled-cleanup", triggers: [{ event: "inngest/function.cancelled" }] },
  async ({ event, step }) => {
    const runId = event.data.run_id;
    const aborted = await step.run("abort-pi", () => abortRun(runId));
    const swept = await step.run("sweep", () => sweepRun(runId));
    // The SDK's CancelledEventPayload type omits it, but the payload carries the triggering event.
    // Only `run-night` is triggered by `night.start` (the children by `inngest/function.invoked`), and the
    // event name does not depend on how `function_id` is spelled (a slug on the dev server, unchecked on Cloud).
    const trigger = (event.data as { event?: { name?: string; data?: { night_id?: unknown } } }).event;
    const nightId = trigger?.data?.night_id;
    if (trigger?.name === nightStart.name && typeof nightId === "string") {
      await step.sendEvent("stop-night", { name: nightStop.name, data: { night_id: nightId, reason: "cancelled" } });
    }
    return { aborted, swept };
  },
);

export const codeclimbFunctions = [runNight, runExperiment, runEvaluator, onNightStop, onRunCancelled];
