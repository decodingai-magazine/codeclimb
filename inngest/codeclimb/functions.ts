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
import { efficiencyMetrics, evalMinutes, parallelWidth, rootConfig, type NightConfig } from "../../codeclimb/config";
import { closeEvaluator, type EvalRequest, evalCandidate, openEvaluator } from "../../codeclimb/evaluate";
import {
  applyReview,
  type BranchOutcome,
  checkRepo,
  checkStop,
  decideRound,
  type EvalOutcome,
  evalRow,
  finishNight,
  initNight,
  type Kept,
  recordRows,
  reviewRound,
  rotate,
} from "../../codeclimb/orchestrator";
import { checkNightModels } from "../../codeclimb/meter/backends";
import { writeReport } from "../../codeclimb/report/html";
import type { HypothesisLogEntry } from "../../codeclimb/reviewer";
import { passesThresholds } from "../../codeclimb/stats";
import { ccInngest, nightStart, nightStop } from "./client";


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
    if (!code.sha || !event.data.config.scenario.check) return { code, runId };
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
    // Backstop past any sane deadline + one round + the test eval; the deadline itself is a soft stop.
    // A timeout cancels this run; `onRunCancelled` turns that into a night stop.
    timeouts: { finish: "24h" },
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
    const invokeOne = (id: string, req: EvalSpec): Promise<EvalOutcome> => invokeEvaluator(id, [req]).then((o) => o[0]);

    let kept: Kept = {
      expId: init.starterExpId, sha: init.starterSha, score: 0, metrics: null, metricsPath: null,
      rescored: true, // round-1 parent = the starter repo, scored 0
    };
    // Highest re-scored primary kept so far: efficiency keeps may not drift below it.
    let bestPrimary = 0;
    const noteKept = () => {
      if (kept.rescored) bestPrimary = Math.max(bestPrimary, kept.score);
    };
    let feedback = "";
    let hypotheses: (string | null)[] = Array(B).fill(null);
    const log: HypothesisLogEntry[] = [];
    const roundSpends: number[] = [];
    let spend = 0;
    const roundTokens: number[] = [];
    let tokens = 0;
    let roundsWithoutKeep = 0;
    let maxEvalUsd = 0;
    let stopReason = "";
    let round = 0;

    while (!stopReason) {
      round += 1;
      const check = await step.run(`r${round}-check`, () =>
        checkStop({ round, cfg, deadlineMs: init.deadlineMs, spend, roundSpends, maxEvalUsd, tokens, roundTokens, roundsWithoutKeep }),
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
      const width = parallelWidth(cfg, round, roundsWithoutKeep);
      const coded = await Promise.all(
        cfg.models.slice(0, width).map((model, b) => {
          const expId = `${nightId}-r${round}-b${b}`;
          const data: ExperimentEvent = {
            nightId, expId, parentExpId: parent.expId, round, branch: b, model,
            feedback, hypothesis: hypotheses[b] ?? null, config: cfg,
          };
          return step.invoke(`r${round}-b${b}`, { function: runExperiment, data, timeout: expTimeout }).then(
            (out) => ({ ok: true as const, expId, branch: b, model, code: out.code, runId: out.runId }),
            (e: unknown) => ({ ok: false as const, expId, branch: b, model, error: String((e as Error)?.message ?? e) }),
          );
        }),
      );

      // Then one evaluator, with every coder stopped: the parent and each committed branch in turn.
      const parentSpec: EvalSpec = {
        evalId: `${nightId}-r${round}-${parent.rescored ? "baseline" : "rescore"}`, expId: parent.expId, split: "dev",
      };
      const specs: EvalSpec[] = [parentSpec];
      for (const c of coded) {
        if (c.ok && c.code.sha && !c.code.check?.errors.length) specs.push({ evalId: `${c.expId}-eval`, expId: c.expId, split: "dev", scoreRunId: c.runId });
      }
      const order = rotate(specs, round);
      const outcomes =
        cfg.scenario.eval_sandboxes === "per_candidate"
          ? await Promise.all(order.map((spec, i) => invokeOne(`r${round}-eval-${i}`, spec)))
          : await invokeEvaluator(`r${round}-eval`, order);
      const evals = new Map(outcomes.map((o) => [o.evalId, o]));
      const branches: BranchOutcome[] = coded.map((c) => {
        if (!c.ok) return c;
        const o = evals.get(`${c.expId}-eval`);
        return { ok: true, expId: c.expId, branch: c.branch, model: c.model, code: c.code, eval: o?.ok ? o.result : null };
      });
      const parentEval = evals.get(parentSpec.evalId)!;

      const mechanical = await step.run(`r${round}-decide`, () =>
        decideRound({
          ...rowBase, parent, bestPrimary, branches, hypotheses,
          rescore: parent.rescored ? null : parentEval,
          baseline: parent.rescored ? parentEval : null,
        }),
      );
      kept = { ...kept, ...mechanical.parentAfter };
      noteKept();

      // Review: what to keep, feedback, and one hypothesis per branch of the next round. The next round's
      // width depends on the keep, so ask for the wider case. After the last round with no candidate there
      // is nothing to ask.
      let review = { feedback, hypotheses: hypotheses.map((h) => h ?? ""), reviewer_usd: 0, t_review: 0, tokens: 0 };
      let decision = mechanical;
      if (round < cfg.max_rounds || mechanical.candidates.length) {
        const nextWidth = round < cfg.max_rounds ? Math.max(parallelWidth(cfg, round + 1, 0), parallelWidth(cfg, round + 1, roundsWithoutKeep + 1)) : 0;
        try {
          const reviewed = await step.run(`r${round}-review`, () =>
            reviewRound({
              cfg, nightId, round, parentExpId: parent.expId, parentScore: kept.score, parentMetrics: kept.metrics,
              summaries: mechanical.summaries, candidates: mechanical.candidates.map((c) => c.expId),
              mechanicalKeep: mechanical.keep?.expId ?? null, log: [...log], branches: nextWidth,
            }),
          );
          review = reviewed;
          decision = applyReview(mechanical, reviewed.keep);
        } catch {
          // A failed review keeps last round's guidance and the mechanical keep instead of killing the night.
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

      if (decision.keep) {
        const { reason: _, ...k } = decision.keep;
        kept = { ...k, metricsPath: null, rescored: false };
        if (passesThresholds(kept.metrics ?? {}, cfg.thresholds)) {
          // The raw (best-of-N) score passes: re-score now, so the thresholds stop reads an unbiased score.
          const outcome = await invokeOne(`r${round}-rescore-now`, {
            evalId: `${nightId}-r${round}-rescore-now`, expId: kept.expId, split: "dev",
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

      // Thresholds pass on the kept commit's dev re-score: done.
      if (kept.rescored && kept.metrics && passesThresholds(kept.metrics, cfg.thresholds)) stopReason = "thresholds";
    }

    // After any stop: score the final kept commit on test once, for the report only.
    const test = await invokeOne("test", { evalId: `${nightId}-test`, expId: kept.expId, split: "test" });
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
