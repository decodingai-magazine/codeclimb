// CodeClimb on Inngest: a thin parent run per night, one child run per
// experiment's coding phase (`step.invoke`) and one evaluator run per round and
// per extra eval, which evaluates its candidates in turn on one sandbox.
// Children get their own `cancelOn` for the night-stop event: cancelling the
// parent alone may not cancel invoked children, and cancel never interrupts a
// running step.
import { invoke, NonRetriableError, staticSchema } from "inngest";
import { abortNight, abortRun } from "../../codeclimb/aborts";
import { markStopped, sweepNight, sweepRun } from "../../codeclimb/cleanup";
import { type EvalFailure, type ExperimentInput, runCoder } from "../../codeclimb/coder";
import { efficiencyMetrics, evalMinutes, parallelWidth, rootConfig, type NightConfig } from "../../codeclimb/config";
import { OutOfCredits } from "../../codeclimb/credits";
import { closeEvaluator, type EvalRequest, evalCandidate, openEvaluator } from "../../codeclimb/evaluate";
import {
  applyReview,
  type BranchOutcome,
  checkRepo,
  checkStop,
  creditStopOf,
  decideRound,
  endPause,
  type EvalOutcome,
  evalRow,
  finishNight,
  initNight,
  type Kept,
  maskFailures,
  markPaused,
  type PausedAt,
  recordRows,
  reviewRound,
  rotate,
} from "../../codeclimb/orchestrator";
import { checkNightModels } from "../../codeclimb/meter/backends";
import { writeReport } from "../../codeclimb/report/html";
import type { HypothesisLogEntry } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightResume, nightStart, nightStop } from "./client";


/** How long a night waits for credits before it stops. Stay under `run-night`'s `timeouts.finish`. */
const PAUSE_TIMEOUT = "3d";

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
    if (!code.sha || code.credits || !event.data.config.scenario.check) return { code, runId };
    const check = await step.run("check", () => checkRepo(event.data.config, event.data.nightId, event.data.expId));
    return { code: { ...code, check }, runId };
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
      // Out of credits: the rest would fail the same way, so they wait for the resume too.
      const credits = outcomes.map(creditStopOf).find(Boolean);
      if (credits) {
        outcomes.push({ ok: false, evalId: spec.evalId, error: "skipped: out of credits", credits });
        continue;
      }
      try {
        const result = await step.run(`eval-${spec.evalId}`, async () =>
          evalCandidate(cfg, await openEvaluator(cfg, nightId, evaluatorId, runId), { ...spec, nightId, runId, order }),
        );
        outcomes.push({ ok: true, evalId: spec.evalId, result });
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
    const B = cfg.models.length;
    const expTimeout = `${cfg.timeouts.experiment_min * 3 + 30}m`;

    // One evaluator run (and sandbox, `cc-<night>-<id>`) per call; outcomes come back in run order.
    const invokeEvaluator = (id: string, requests: EvalSpec[]): Promise<EvalOutcome[]> =>
      step
        .invoke(id, {
          function: runEvaluator,
          data: { config: cfg, nightId, evaluatorId: `${nightId}-${id}`, requests },
          timeout: `${requests.length * evalMinutes(cfg) * 3 + 15}m`,
        })
        .then(
          (outcomes) => outcomes as EvalOutcome[],
          (e: unknown) => requests.map((r) => ({ ok: false as const, evalId: r.evalId, error: String((e as Error)?.message ?? e) })),
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

    // One `specs` batch, in order, however many pauses it takes.
    const evaluate = async (id: string, round: number, specs: EvalSpec[]): Promise<EvalOutcome[]> => {
      const done = new Map<string, EvalOutcome>();
      let pending = specs;
      for (let n = 0; pending.length; n += 1) {
        const tag = n ? `${id}-resume${n}` : id;
        const outcomes =
          cfg.scenario.eval_sandboxes === "per_candidate"
            ? (await Promise.all(pending.map((spec, i) => invokeEvaluator(`${tag}-${i}`, [spec])))).flat()
            : await invokeEvaluator(tag, pending);
        const stops = outcomes.flatMap((o) => {
          const stop = creditStopOf(o);
          if (!stop) done.set(o.evalId, o);
          else if (o.ok) spend += o.result.program_usd;
          return stop ? [{ ...stop, where: `evaluation ${o.evalId.replace(`${nightId}-`, "")}` }] : [];
        });
        pending = pending.filter((s) => !done.has(s.evalId));
        if (stops.length) await pauseForCredits(round, stops);
      }
      return specs.map((s) => done.get(s.evalId)!);
    };
    const evaluateOne = (id: string, round: number, spec: EvalSpec) => evaluate(id, round, [spec]).then((o) => o[0]);

    let spend = 0;
    let kept: Kept = {
      expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null, metricsPath: null,
      rescored: true, // round-1 parent = the starter repo, scored 0 and never evaluated
    };
    // Highest re-scored primary kept so far: efficiency keeps may not drift below it.
    let bestPrimary = 0;
    const noteKept = () => {
      if (kept.rescored) bestPrimary = Math.max(bestPrimary, kept.score);
    };
    let feedback = "";
    let failures: EvalFailure[] = [];
    let hypotheses: (string | null)[] = Array(B).fill(null);
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

      // The coders work in parallel from the kept commit.
      // Width schedule: the first `width` models code this round (see `parallelWidth`).
      const parent = kept;
      const width = parallelWidth(cfg, round);
      const code = (b: number, model: string, resume: number) => {
        const expId = `${nightId}-r${round}-e${b}`;
        const data: ExperimentEvent = {
          nightId, expId, parentExpId: parent.expId, round, branch: b, model,
          feedback, failures, hypothesis: hypotheses[b] ?? null, config: cfg, ...(resume ? { resume: true } : {}),
        };
        return step.invoke(`r${round}-e${b}${resume ? `-resume${resume}` : ""}`, { function: runExperiment, data, timeout: expTimeout }).then(
          (out) => ({ ok: true as const, expId, branch: b, model, code: out.code, runId: out.runId }),
          (e: unknown) => ({ ok: false as const, expId, branch: b, model, error: String((e as Error)?.message ?? e) }),
        );
      };
      const coded = await Promise.all(cfg.models.slice(0, width).map((model, b) => code(b, model, 0)));
      for (let n = 1; ; n += 1) {
        const out = coded.flatMap((c) => (c.ok && c.code.credits ? [{ ...c, credits: c.code.credits }] : []));
        if (!out.length) break;
        await pauseForCredits(round, out.map((c) => ({ ...c.credits, where: `experiment ${c.expId.replace(`${nightId}-`, "")}` })));
        const again = await Promise.all(out.map((c) => code(c.branch, c.model, n)));
        for (const c of again) coded[c.branch] = c;
      }

      // Then the evaluation, with every coder stopped: each committed branch, and the parent, unless it is
      // the starter: that empty program scores nothing, so there is nothing to compare the branches with.
      const parentSpec: EvalSpec = {
        evalId: `${nightId}-r${round}-${parent.rescored ? "baseline" : "rescore"}`, expId: parent.expId, split: "dev",
      };
      const specs: EvalSpec[] = parent.expId === init.starterExpId ? [] : [parentSpec];
      for (const c of coded) {
        if (c.ok && c.code.sha && !c.code.check?.errors.length) specs.push({ evalId: `${c.expId}-eval`, expId: c.expId, split: "dev", scoreRunId: c.runId });
      }
      const outcomes = await evaluate(`r${round}-eval`, round, rotate(specs, round));
      const evals = new Map(outcomes.map((o) => [o.evalId, o]));
      const branches: BranchOutcome[] = coded.map((c) => {
        if (!c.ok) return c;
        const o = evals.get(`${c.expId}-eval`);
        return { ok: true, expId: c.expId, branch: c.branch, model: c.model, code: c.code, eval: o?.ok ? o.result : null };
      });
      const parentEval = evals.get(parentSpec.evalId) ?? null;

      const mechanical = await step.run(`r${round}-decide`, () =>
        decideRound({
          ...rowBase, parent, bestPrimary, branches, hypotheses,
          rescore: parent.rescored ? null : parentEval,
          baseline: parent.rescored ? parentEval : null,
        }),
      );
      kept = { ...kept, ...mechanical.parentAfter };
      noteKept();

      // Review: what to keep, feedback, and one hypothesis per experiment of the next round. After the
      // last round with no candidate there is nothing to ask.
      let review = { keep_reason: "", feedback, hypotheses: hypotheses.map((h) => h ?? ""), reviewer_usd: 0, t_review: 0, tokens: 0 };
      let decision = mechanical;
      if (round < cfg.max_rounds || mechanical.candidates.length) {
        const nextWidth = round < cfg.max_rounds ? parallelWidth(cfg, round + 1) : 0;
        for (let n = 0; ; n += 1) {
          let reviewed;
          try {
            reviewed = await step.run(`r${round}-review${n ? `-resume${n}` : ""}`, () =>
              reviewRound({
                cfg, nightId, round, parentExpId: parent.expId, parentRun: mechanical.parentRun,
                parentScore: mechanical.parentRun?.[cfg.primary_metric] ?? kept.score, parentMetrics: mechanical.parentRun ?? kept.metrics,
                summaries: mechanical.summaries, candidates: mechanical.candidates.map((c) => c.expId),
                mechanicalKeep: mechanical.keep?.expId ?? null, log: [...log], branches: nextWidth,
              }).catch((e: unknown) => {
                if (e instanceof OutOfCredits) return { credits: e.stop };
                throw e;
              }),
            );
          } catch {
            break; // A failed review keeps last round's guidance and the mechanical keep instead of killing the night.
          }
          if ("credits" in reviewed) {
            await pauseForCredits(round, [{ ...reviewed.credits, where: `review of round ${round}` }]);
            continue;
          }
          review = reviewed;
          decision = applyReview(mechanical, reviewed.keep);
          break;
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
      const roundTok = rows.reduce((a, r) => a + (r.tokens ?? 0), 0) + review.tokens;
      roundTokens.push(roundTok);
      tokens += roundTok;
      roundsWithoutKeep = decision.keep ? 0 : roundsWithoutKeep + 1;
      const parentRun = decision.parentRun;
      for (const s of decision.summaries) {
        const tracked = [...efficiencyMetrics(cfg), ...Object.keys(cfg.scenario.headline)].filter((m) => s.decision !== "error" && typeof s.metrics[m] === "number");
        const moved = parentRun
          ? { deltas: Object.fromEntries(tracked.flatMap((m) => (typeof parentRun[m] === "number" ? [[m, s.metrics[m] - parentRun[m]]] : []))) }
          : { scores: Object.fromEntries(tracked.map((m) => [m, s.metrics[m]])) };
        log.push({
          round, hypothesis: s.hypothesis, deltaPrimary: s.primary - (parentRun?.[cfg.primary_metric] ?? parent.score), ...moved, decision: s.decision,
          // An error's tail names the failure; its head is the command, and coders get it whole.
          reason: s.errors?.join("; ").slice(-300) ?? (s.guardrails.join("; ") || review.keep_reason),
        });
      }
      feedback = review.feedback;
      const unmasked = decision.summaries.flatMap((s) => (s.errors ? [{ expId: s.expId, errors: s.errors }] : []));
      failures = await step.run(`r${round}-failures`, () => maskFailures(cfg, unmasked));
      hypotheses = review.hypotheses;

      if (decision.keep) {
        const { reason: _, ...k } = decision.keep;
        kept = { ...k, metricsPath: null, rescored: false };
        if (passesThresholds(kept.metrics ?? {}, cfg.thresholds)) {
          // The raw (best-of-N) score passes: re-score now, so the thresholds stop reads an unbiased score.
          const outcome = await evaluateOne(`r${round}-rescore-now`, round, {
            evalId: `${nightId}-r${round}-rescore-now`, expId: kept.expId, split: "dev",
          });
          await step.run(`r${round}-rescore-record`, () =>
            recordRows(cfg, [evalRow(rowBase, kept, outcome, { kind: "rescore" })]),
          );
          if (outcome.ok) spend += outcome.result.program_usd;
          if (outcome.ok && outcome.result.ok) {
            kept = { ...kept, score: outcome.result.metrics[cfg.primary_metric], metrics: outcome.result.metrics, metricsPath: outcome.result.metricsPath, rescored: true };
            noteKept();
          }
        }
      }

      // Thresholds pass on the kept commit's dev re-score: done.
      if (kept.rescored && kept.metrics && passesThresholds(kept.metrics, cfg.thresholds)) stopReason = "thresholds";
    }

    // After any stop: score the final kept commit on test once, for the report only.
    const test = await evaluateOne("test", round, { evalId: `${nightId}-test`, expId: kept.expId, split: "test" });
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
