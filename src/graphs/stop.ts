// The `stop` graph: the one cleanup path of every hard stop, step by step (spec: Cleanup).
import { entrypoint } from "@langchain/langgraph";
import { cancelNightRuns } from "../control.ts";
import { sandboxPrefix } from "../ids.ts";
import { findNightDir, type StopReason, writeStopIfMissing } from "../night/files.ts";
import { sandboxes } from "../night/sandboxes.ts";
import { serverRoot } from "../night/types.ts";
import { abortNight } from "../runtime/registry.ts";
import { step } from "../runtime/step.ts";

export interface StopInput {
	night_id: string;
	reason?: StopReason;
}

export const stop = entrypoint("stop", async (input: StopInput) => {
	const id = input.night_id;
	const cancelled = await step("cancel-runs", () => cancelNightRuns(id))();
	// The server reports a cancelled run as interrupted while its step may still run: abort and sweep always follow.
	const aborted = await step("abort-live", async () => abortNight(id, new Error(`night ${id} stopped`)))();
	const swept = await step("sweep", () => sandboxes.sweep({ prefix: sandboxPrefix(id) }))();
	const wrote = await step("stop-json", async () => {
		const dir = findNightDir(serverRoot(), id);
		return dir ? writeStopIfMissing(dir, input.reason ?? "failed") : false;
	})();
	return { night_id: id, cancelled, aborted, swept, wrote_stop_json: wrote };
});
