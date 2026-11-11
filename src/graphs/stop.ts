// The `stop` graph: the one cleanup path of every hard stop, step by step (spec: Cleanup).
import { entrypoint } from "@langchain/langgraph";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cancelNightRuns, nightThreads, pendingPause, startLessons, type TimerGuard } from "../control.ts";
import { lessonsOn } from "../lessons.ts";
import { sandboxPrefix } from "../ids.ts";
import { findNightDir, readJson, type StopReason, writeStopIfMissing } from "../night/files.ts";
import { sandboxes } from "../night/sandboxes.ts";
import { type NightJson, serverRoot } from "../night/types.ts";
import { abortNight } from "../runtime/registry.ts";
import { step } from "../runtime/step.ts";
import { registerTracing } from "../tracing.ts";

registerTracing();

export interface StopInput {
	night_id: string;
	reason?: StopReason;
	/** A timer's guard: the pause or the variation it watches. */
	guard?: TimerGuard;
}

/** A timer fires only while its pause is pending, or while its variation is the newest and has not ended. */
async function guardHolds(id: string, guard: TimerGuard): Promise<boolean> {
	const dir = findNightDir(serverRoot(), id);
	if (!dir || existsSync(join(dir, "done.json")) || existsSync(join(dir, "stop.json"))) return false;
	if (guard.pause !== undefined) return (await pendingPause(id))?.pause === guard.pause;
	if (guard.variation !== undefined) return (await nightThreads(id))[0]?.variation === guard.variation;
	return false;
}

export const stop = entrypoint("stop", async (input: StopInput) => {
	const id = input.night_id;
	if (input.guard) {
		const guard = input.guard;
		if (!(await step("guard", () => guardHolds(id, guard))())) return { night_id: id, skipped: true };
		// A timer has no caller: it writes stop.json itself, before the cancel, so the night reads it as a stop.
		await step("timer-stop-json", async () => {
			const dir = findNightDir(serverRoot(), id);
			return dir ? writeStopIfMissing(dir, "failed") : false;
		})();
	}
	const cancelled = await step("cancel-runs", () => cancelNightRuns(id))();
	// The server reports a cancelled run as interrupted while its step may still run: abort and sweep always follow.
	const aborted = await step("abort-live", async () => abortNight(id, new Error(`night ${id} stopped`)))();
	const swept = await step("sweep", () => sandboxes.sweep({ prefix: sandboxPrefix(id) }))();
	const wrote = await step("stop-json", async () => {
		const dir = findNightDir(serverRoot(), id);
		return dir ? writeStopIfMissing(dir, input.reason ?? "failed") : false;
	})();
	// A night that didn't finish distills its lessons here, with the config from its night.json.
	const lessons = await step("lessons", async () => {
		const dir = findNightDir(serverRoot(), id);
		const night = dir ? readJson<NightJson>(join(dir, "night.json")) : null;
		if (!dir || !night || existsSync(join(dir, "done.json")) || !lessonsOn(night.config)) return false;
		await startLessons({ night_id: id, scenario: night.config.scenario, config: night.config });
		return true;
	})();
	return { night_id: id, cancelled, aborted, swept, wrote_stop_json: wrote, lessons };
});
