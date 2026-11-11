// A pause for credits in the night's own code, between steps: pause.json and its timer, the interrupt, the end (spec: Pause for credits).
import { interrupt } from "@langchain/langgraph";
import { startTimer } from "../control.ts";
import type { NightPaths } from "../night/files.ts";
import { beginPause, type CreditStop, endPause, PAUSE_TIMEOUT_S, type PauseStop } from "../night/pause.ts";
import { step } from "../runtime/step.ts";

/** A resume after the night was stopped while paused: the night ends its server run quietly. */
export class NightStopped extends Error {
	constructor(night: string) {
		super(`night ${night} was stopped while paused`);
	}
}

/** The night's pauses: their count and the loop's deadline, which every ended pause moves forward. */
export class Pauses {
	constructor(
		private readonly night: string,
		private readonly paths: NightPaths,
		public deadlineMs: number,
		/** Pause numbers used by earlier variations: numbers never repeat within a night. */
		private count = 0,
	) {}

	/**
	 * Pause the night on one credit stop and wait for the resume of this pause; returns the suffix (`-resume<n>`) of
	 * the work that reruns. Steps before the interrupt replay from their saved results.
	 */
	async pause(round: number, where: string, credit: CreditStop): Promise<string> {
		const n = ++this.count;
		const stops: PauseStop[] = [{ where, ...credit }];
		const begun = await step(`pause${n}/begin`, async () => beginPause(this.paths, { pause: n, round, stops }))();
		await step(`pause${n}/timer`, () => startTimer(this.night, { pause: n }, PAUSE_TIMEOUT_S))();
		const payload = { pause: n, at: begun.at, stops };
		let resume = interrupt(payload) as { pause?: unknown } | undefined;
		// A stale resume (another pause's number) is answered with another interrupt: it can't end this pause.
		while (resume?.pause !== n) resume = interrupt(payload) as { pause?: unknown } | undefined;
		const end = await step(`pause${n}/end`, async () => endPause(this.paths, n))();
		if (end.stopped) throw new NightStopped(this.night);
		this.deadlineMs = end.deadlineMs;
		return `-resume${n}`;
	}
}
