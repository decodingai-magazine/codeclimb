// The `night` graph: init, rounds, finish; any failure ends in the stop operation (spec: Round loop; Cleanup).
import { existsSync } from "node:fs";
import { entrypoint, getConfig, isGraphInterrupt } from "@langchain/langgraph";
import { runStopGraph } from "../control.ts";
import { nightPaths, writeStopIfMissing } from "../night/files.ts";
import { initNight } from "../night/init.ts";
import { finishNight, stopCheck } from "../night/loop.ts";
import { type NightInput, serverRoot } from "../night/types.ts";
import { HOST_COMMAND_BACKSTOP_MIN, isOwnFailure, step } from "../runtime/step.ts";

export const night = entrypoint("night", async (input: NightInput) => {
	const root = serverRoot();
	const runSignal = getConfig().signal;
	const id = input.night_id;
	const config = input.config;
	const paths = nightPaths(root, config.results_path, id);
	try {
		const init = await step("init", (ctx) => initNight(ctx, root, input), { backstopMin: HOST_COMMAND_BACKSTOP_MIN })();
		let round = 0;
		let stopReason: string;
		for (;;) {
			const next = round + 1;
			const check = await step(`r${next}/stop-check`, async () => stopCheck(paths, config, init, next))();
			if (check.hard) return { night_id: id, stopped: true };
			if (check.reason) {
				stopReason = check.reason;
				break;
			}
			round = next;
			await step(`r${round}/round`, async () => ({ round }))();
		}
		const done = await step("finish", () =>
			finishNight(paths, {
				nightId: id,
				stopReason,
				rounds: round,
				kept: { exp_id: init.round0.exp_id, commit: init.round0.sha, dev_score: 0 },
				testMetrics: null,
				spendUsd: 0,
			}),
		)();
		return done ?? { night_id: id, stopped: true };
	} catch (error) {
		// A pause travels as a thrown GraphInterrupt: never clean up on it.
		if (isGraphInterrupt(error)) throw error;
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
