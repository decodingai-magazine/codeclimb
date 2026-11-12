// The `night` graph: init, rounds, finish; any failure ends in the stop operation (spec: Round loop; Cleanup).
import { existsSync } from "node:fs";
import { entrypoint, getConfig, isGraphInterrupt } from "@langchain/langgraph";
import { runStopGraph, startLessons, startTimer } from "../control.ts";
import { lessonsOn } from "../lessons.ts";
import { nightPaths, writeStopIfMissing } from "../night/files.ts";
import { initNight } from "../night/init.ts";
import { emptyLoop, finishNight, type LoopState, stopCheck, thresholdsMet } from "../night/loop.ts";
import { type NightInput, serverRoot } from "../night/types.ts";
import { sandboxPrefix, testEvalId } from "../ids.ts";
import { type Checkpoint, evaluationRow } from "../night/rows.ts";
import { appendRow } from "../results.ts";
import { runEvaluation } from "./parts.ts";
import { NightStopped, Pauses } from "./pause.ts";
import { type RoundState, runRescore, runRound } from "./round.ts";
import { mockCredit, mockOffline } from "../pi/models.ts";
import { VARIATION_TIMEOUT_S } from "../night/pause.ts";
import { HOST_COMMAND_BACKSTOP_MIN, isOwnFailure, NonRetriableError, step } from "../runtime/step.ts";
import { checkNightModels, SMOKE_RETRIES, smokeTest, smokeWait, smokeWithRetries } from "../pi/check.ts";
import { registerTracing } from "../tracing.ts";

registerTracing();

export const night = entrypoint("night", async (input: NightInput) => {
	const root = serverRoot();
	const runSignal = getConfig().signal;
	const id = input.night_id;
	const config = input.config;
	const paths = nightPaths(root, config.results_path, id);
	try {
		const init = await step("init", async (ctx) => {
			// Armed once per night: a resumed run takes init from its checkpoint and leaves the counter alone.
			if (input.mock && input.mock_offline) mockOffline(input.mock_offline);
			if (input.mock && input.mock_credit) mockCredit(input.mock_credit);
			// The model check again, with the server's own credentials: a missing model or key is not retried.
			try {
				await checkNightModels(config, input.mock);
			} catch (e) {
				throw new NonRetriableError((e as Error).message);
			}
			return initNight(ctx, root, input);
		}, { backstopMin: HOST_COMMAND_BACKSTOP_MIN })();
		// The variation backstop: a timer due in 4 days that stops the variation unless it ended or a newer one began.
		await step("variation-timer", () => startTimer(id, { variation: input.variation ?? 0 }, VARIATION_TIMEOUT_S))();
		const start = init.start;
		const pauses = new Pauses(id, paths, init.deadlineMs, start.pauses);
		let round = start.lastRound;
		let stopReason: string;
		let state: RoundState = { checkpoint: start.checkpoint, guidance: start.guidance, history: start.history, noise: start.noise, ...(start.direction ? { direction: start.direction } : {}) };
		// Tokens, plateau and the costliest round and evaluation start at zero per variation; the spend carries over.
		let loop: LoopState = { ...emptyLoop(), spentUsd: start.spentUsd };
		if (start.rescore) {
			// The scoring changed since the checkpoint was scored: one extra round first, no stop check, coder or review.
			round++;
			const r = await runRescore(root, id, config, paths, input.mock, round, state.checkpoint, loop.spentUsd, pauses);
			state = { ...state, checkpoint: r.checkpoint, noise: { runs: 0, measured: false, remeasureOn: null, base: null } };
			loop = { ...loop, spentUsd: loop.spentUsd + r.spendUsd };
		}
		for (;;) {
			const next = round + 1;
			const check = await step(`r${next}/stop-check`, async () => stopCheck(paths, config, pauses.deadlineMs, next, loop))();
			if (check.hard) return { night_id: id, stopped: true };
			if (check.reason) {
				stopReason = check.reason;
				break;
			}
			// Before money goes into the round: the models are ready and the path to the proxy is up.
			const down = input.mock
				? null
				: await smokeWithRetries(
						(n) => step(`r${next}/smoke${n ? n : ""}`, async () => smokeTest(config, input.mock))(),
						(n) => step(`r${next}/smoke-wait${n}`, (ctx) => smokeWait(ctx.signal))(),
					);
			if (down !== null) {
				console.error(`night ${id}: round ${next} smoke test failed ${SMOKE_RETRIES + 1} times: ${down}`);
				stopReason = "outage";
				break;
			}
			round = next;
			const r = await runRound(root, id, config, paths, input.mock, round, state, loop, pauses);
			loop = {
				spentUsd: loop.spentUsd + r.spendUsd,
				tokens: loop.tokens + r.tokens,
				maxRoundUsd: Math.max(loop.maxRoundUsd, r.spendUsd),
				maxRoundTokens: Math.max(loop.maxRoundTokens, r.tokens),
				maxEvalUsd: Math.max(loop.maxEvalUsd, r.maxEvalUsd),
				roundsWithoutKeep: r.kept ? 0 : loop.roundsWithoutKeep + 1,
			};
			state = { checkpoint: r.checkpoint, guidance: r.guidance, history: r.history, noise: r.noise, ...(r.failures ? { failures: r.failures } : {}), ...(state.direction ? { direction: state.direction } : {}) };
			if (thresholdsMet(config, state.checkpoint.metrics)) {
				stopReason = "thresholds";
				break;
			}
		}
		const checkpoint: Checkpoint = state.checkpoint;
		// After any soft stop: score the checkpoint on test, for the report only.
		const testId = testEvalId(id, round);
		const test = await runEvaluation(root, id, config, paths, { evalId: testId, sandboxName: `${sandboxPrefix(id)}-test-r${round}`, split: "test", commit: checkpoint.commit, mock: input.mock, capUsd: config.budget_usd.night - loop.spentUsd, round, pauses, expId: checkpoint.exp_id });
		await step(`${testId}/record`, async () => appendRow(paths.results, evaluationRow(id, config, "test", testId, round, checkpoint, test)))();
		const done = await step("finish", () =>
			finishNight(paths, {
				nightId: id,
				stopReason,
				rounds: round,
				kept: { exp_id: checkpoint.exp_id, commit: checkpoint.commit, dev_score: checkpoint.metrics[config.primary_metric] ?? 0 },
				testMetrics: test.ok ? test.metrics : null,
				spendUsd: loop.spentUsd + test.program_usd,
			}),
		)();
		// The lessons run starts once done.json is written; a stopped night's lessons start in the stop cleanup.
		if (done && lessonsOn(config)) await step("lessons", () => startLessons({ night_id: id, scenario: config.scenario, config }))();
		return done ?? { night_id: id, stopped: true };
	} catch (error) {
		// A pause travels as a thrown GraphInterrupt: never clean up on it.
		if (isGraphInterrupt(error)) throw error;
		// Resumed after a stop while paused: the stop operation already cleaned up.
		if (error instanceof NightStopped) return { night_id: id, stopped: true };
		const runAborted = runSignal?.aborted === true && !isOwnFailure(error);
		const cancelledFromOutside = runAborted && !existsSync(paths.stopJson);
		// Aborted with a stop.json on disk: CodeClimb's own stop operation is cleaning up.
		if (runAborted && !cancelledFromOutside) throw error;
		const reason = cancelledFromOutside ? "cancelled" : "failed";
		if (writeStopIfMissing(paths.nightDir, reason)) {
			try {
				await runStopGraph(id, reason);
			} catch (stopError) {
				console.error(`night ${id}: could not start the stop operation:`, stopError);
			}
		}
		throw error;
	}
});
