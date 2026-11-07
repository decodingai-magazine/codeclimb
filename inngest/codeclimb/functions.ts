// CodeClimb on Inngest: a thin parent run per night, a linear loop of one experiment per round.
// Each round is one child run for the coding phase (`step.invoke`) and one evaluator run, on its
// own sandbox. Its weighted score decides the keep; a worse experiment is reviewed, then dropped: the
// next round restarts from the checkpoint.
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
  appendNotes,
  checkRepo,
  checkStop,
  continueNight,
  creditStopOf,
  decideRound,
  diffLeaks,
  endPause,
  type EvalOutcome,
  type ExperimentOutcome,
  finishNight,
  freshNight,
  initNight,
  type Kept,
  historyLine, maskFailures, repairable,
  markPaused,
  type Noise,
  type PausedAt,
  recordNoise, recordRows, renameKept, rescoreRow, saveRejected,
  reviewRound, smokeTest,
} from "../../codeclimb/orchestrator";
import { checkNightModels } from "../../codeclimb/meter/backends";
import { writeReport } from "../../codeclimb/report/html";
import type { HypothesisLogEntry, ReviewOutput } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightResume, nightStart, nightStop } from "./client";


/** How long a night waits for credits before it stops. Stay under `run-night`'s `timeouts.finish`. */
const PAUSE_TIMEOUT = "3d";
/** A failed round-start smoke test is tried again this often, this many times, before the night stops. */
const SMOKE_WAIT = "5m";
const SMOKE_RETRIES = 6;

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
    const { config: cfg, nightId, parentExpId, expId } = event.data;
    const code = await step.run("code", () => runCoder(event.data, { attempt, runId }));
    if (!code.sha || code.credits || code.unchanged !== undefined) return { code, runId };
    const check = cfg.scenario.check ? await step.run("check", () => checkRepo(cfg, nightId, expId)) : undefined;
    const leaks = cfg.scenario.scan ? await step.run("leaks", () => diffLeaks(cfg, nightId, parentExpId, expId)) : [];
    return { code: { ...code, ...(check ? { check } : {}), ...(leaks.length ? { leaks } : {}) }, runId };
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
        const { headline } = cfg.scenario;
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
    const start = event.data.continue;
    const state = start ? await step.run("continue", () => continueNight(cfg, nightId, start)) : freshNight(await step.run("init", () => initNight(cfg, nightId)));
    const { direction } = state;
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
    let deadlineMs = state.deadlineMs;
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

    let spend = state.spend;
    // The checkpoint. Round 1's is the starter repo, scored 0 and never evaluated.
    let kept: Kept = state.kept;
    let feedback = state.feedback;
    let failures: EvalFailure[] = [];
    // A direction replaces the hypothesis the night had got to.
    let hypothesis: string | null = direction ? null : state.hypothesis;
    const log: HypothesisLogEntry[] = [...state.log];
    const history: string[] = [...state.history]; // The log as coders read it, held-out names masked.
    const roundSpends: number[] = [];
    const roundTokens: number[] = [];
    let tokens = 0;
    let roundsWithoutKeep = 0;
    let maxEvalUsd = 0;
    let stopReason = "";
    let round = state.round;
    let noise: Noise | null = state.noise;
    let noiseTried = false;
    const margin = () => noise?.margin ?? 0;

    // The scorers changed since the kept commit was scored: a round of its own scores it again, or the
    // next round would be compared with scores from another evaluation.
    if (start?.rescore) {
      round += 1;
      const at = round;
      const rescored = await step.run("rescore-name", () => renameKept(cfg, nightId, state.kept, `${nightId}-r${at}-e0`));
      const outcome = await evaluate(`r${at}-rescore`, at, { evalId: `${rescored.expId}-eval`, expId: rescored.expId, split: "dev" });
      kept = rescored;
      if (outcome.ok) {
        spend += outcome.result.program_usd;
        maxEvalUsd = outcome.result.program_usd;
        if (outcome.result.ok) kept = { ...rescored, score: outcome.result.metrics[cfg.primary_metric] ?? 0, metrics: outcome.result.metrics };
      }
      await step.run("record-rescore", () => recordRows(cfg, [rescoreRow({ cfg, nightId, round: at }, rescored, outcome)]));
    }

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
      // Before any money goes into the round: the models answer and the proxy is reachable. An outage
      // would spend the coder's budget on a round that can't be scored.
      let down: string | null = null;
      for (let n = 0; n <= SMOKE_RETRIES; n += 1) {
        if (n) await step.sleep(`r${round}-smoke-wait${n}`, SMOKE_WAIT);
        down = await step.run(`r${round}-smoke${n ? n : ""}`, () => smokeTest(cfg));
        if (!down) break;
      }
      if (down) {
        console.log(`[night ${nightId}] stopping: round ${round} smoke test failed ${SMOKE_RETRIES + 1} times: ${down}`);
        stopReason = "outage";
        round -= 1;
        break;
      }
      const rowBase = { cfg, nightId, round };

      // The first checkpoint with scores, new, continued or rescored, is scored once more with nothing
      // replayed: how far its weighted score moves is the margin every later experiment must beat. Once.
      if (kept.metrics && !noise && !noiseTried) {
        noiseTried = true;
        const aa = kept;
        const outcome = await evaluate(`r${round}-noise`, round, { evalId: `${aa.expId}-noise-r${round}`, expId: aa.expId, split: "dev", noReplay: true });
        if (outcome.ok) {
          spend += outcome.result.program_usd;
          maxEvalUsd = Math.max(maxEvalUsd, outcome.result.program_usd);
        }
        noise = await step.run(`r${round}-noise-record`, () => recordNoise(rowBase, aa, outcome));
      }

      // One experiment and its evaluation on dev, with the coder stopped.
      const parent = kept;
      const attempt = async (n: number, parentExpId: string, input: Pick<ExperimentEvent, "failures" | "hypothesis" | "repair">): Promise<ExperimentOutcome> => {
        const expId = `${nightId}-r${round}-e${n}`;
        const code = (resume: number) => {
          const data: ExperimentEvent = {
            nightId, expId, parentExpId, round, model: cfg.model,
            feedback, history, direction, ...input, config: cfg, ...(resume ? { resume: true } : {}),
          };
          return step.invoke(`r${round}-e${n}${resume ? `-resume${resume}` : ""}`, { function: runExperiment, data, timeout: expTimeout }).then(
            (out) => ({ ok: true as const, code: out.code, runId: out.runId }),
            (e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }),
          );
        };
        let coded = await code(0);
        for (let r = 1; coded.ok && coded.code.credits; r += 1) {
          await pauseForCredits(round, [{ ...coded.code.credits, where: `experiment ${expId.replace(`${nightId}-`, "")}` }]);
          coded = await code(r);
        }
        if (!coded.ok) return { ok: false, expId, model: cfg.model, error: coded.error };
        const notes = coded.code.notes ?? "";
        if (notes) await step.run(`r${round}-e${n}-notes`, () => appendNotes(cfg, nightId, expId, notes));
        const evaluated = coded.code.sha && !coded.code.check?.errors.length && coded.code.unchanged === undefined
          ? await evaluate(`r${round}-eval${n ? n : ""}`, round, { evalId: `${expId}-eval`, expId, split: "dev", scoreRunId: coded.runId })
          : null;
        return { ok: true, expId, model: cfg.model, code: coded.code, eval: evaluated?.ok ? evaluated.result : null, ...(evaluated?.ok === false ? { evalError: evaluated.error } : {}) };
      };

      let experiment = await attempt(0, parent.expId, { failures, hypothesis });
      let decided = await step.run(`r${round}-decide`, () => decideRound({ ...rowBase, parent, experiment, hypothesis, margin: margin() }));

      // A failed commit says nothing about its idea: one coder fixes it, if the budget allows, and the fix
      // stands for the round. The failed attempt keeps its row and its cost.
      let failed: typeof decided | null = null;
      if (repairable(experiment)) {
        const first = decided;
        const stop = await step.run(`r${round}-repair-check`, () =>
          checkStop({
            round, cfg, deadlineMs, spend: spend + first.spend, roundSpends, maxEvalUsd, tokens: tokens + (first.row.tokens ?? 0), roundTokens, roundsWithoutKeep,
          }),
        );
        if (!stop.stop) {
          failed = first;
          const errors = first.summary.errors ?? [];
          const toFix = await step.run(`r${round}-repair-failures`, () => maskFailures(cfg, [{ expId: first.summary.expId, errors }]));
          await step.run(`r${round}-record-failed`, () => recordRows(cfg, [first.row]));
          experiment = await attempt(1, first.summary.expId, { failures: toFix, hypothesis: first.summary.hypothesis, repair: true });
          const fixed = experiment;
          decided = await step.run(`r${round}-decide-repair`, () => decideRound({ ...rowBase, parent, experiment: fixed, hypothesis, margin: margin() }));
        }
      }
      const final = decided;

      // Review, even of a reverted experiment and in the last round: its feedback is what the next round
      // learns from it, and a continued night's next round is the one after this. It decides nothing.
      let review: ReviewOutput = { feedback, hypothesis: hypothesis ?? "", reviewer_usd: 0, t_review: 0, tokens: 0 };
      const decision = final;
      for (let n = 0; ; n += 1) {
        let reviewed;
        try {
          reviewed = await step.run(`r${round}-review${n ? `-resume${n}` : ""}`, () =>
            reviewRound({
              cfg, nightId, round, parentExpId: parent.expId, parentScore: parent.score, parentMetrics: parent.metrics,
              summary: final.summary, log: [...log], direction,
            }).catch((e: unknown) => {
              if (e instanceof OutOfCredits) return { credits: e.stop };
              throw e;
            }),
          );
        } catch {
          break; // A failed review keeps last round's guidance instead of killing the night.
        }
        if ("credits" in reviewed) {
          await pauseForCredits(round, [{ ...reviewed.credits, where: `review of round ${round}` }]);
          continue;
        }
        review = reviewed;
        break;
      }
      const row = { ...decision.row, reviewer_usd: review.reviewer_usd, t_review: review.t_review };
      await step.run(`r${round}-record`, async () => {
        const n = recordRows(cfg, [row]);
        await writeReport(cfg); // live report after every round; never throws
        return n;
      });

      maxEvalUsd = Math.max(maxEvalUsd, row.program_usd, failed?.row.program_usd ?? 0);
      const roundSpend = decision.spend + review.reviewer_usd + (failed?.spend ?? 0);
      roundSpends.push(roundSpend);
      spend += roundSpend;
      const roundTok = (row.tokens ?? 0) + review.tokens + (failed?.row.tokens ?? 0);
      roundTokens.push(roundTok);
      tokens += roundTok;
      roundsWithoutKeep = decision.keep ? 0 : roundsWithoutKeep + 1;
      const s = decision.summary;
      const scored = [...efficiencyMetrics(cfg), ...cfg.scenario.headline].filter((m) => s.decision !== "error" && typeof s.metrics[m] === "number");
      const against = parent.metrics;
      const moved = against
        ? { deltas: Object.fromEntries(scored.flatMap((m) => (typeof against[m] === "number" ? [[m, s.metrics[m] - against[m]]] : []))) }
        : { scores: Object.fromEntries(scored.map((m) => [m, s.metrics[m]])) };
      const entry: HypothesisLogEntry = {
        round, hypothesis: s.hypothesis, deltaPrimary: s.primary - parent.score,
        ...(s.decision === "error" || s.unchanged !== undefined ? {} : { deltaScore: s.score - s.parentScore }), ...moved, decision: s.decision,
        reason: s.unchanged !== undefined ? `no code change: ${s.unchanged}` : s.errors?.join("; ") ?? s.reason,
      };
      log.push(entry);
      history.push(await step.run(`r${round}-history`, () => historyLine(cfg, entry)));
      // A rejected commit stays readable to later coders, whatever rejected it.
      if (!decision.keep && experiment.ok && experiment.code.sha && (s.unchanged === undefined || failed)) {
        await step.run(`r${round}-rejected`, () => saveRejected(cfg, nightId, round, parent.expId, s.expId));
      }
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

    // After any stop: score the final kept commit on test, once per run, for the report only.
    const test = await evaluate(`test-r${round}`, round, { evalId: `${nightId}-test-r${round}`, expId: kept.expId, split: "test" });
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
