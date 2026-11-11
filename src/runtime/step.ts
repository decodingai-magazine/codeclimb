// The step wrapper: a step is a LangGraph task() with CodeClimb's retry, backstop timer and one abort signal
// (spec: Durable runtime on LangGraph). Step bodies stay framework-free: they get a StepContext.
import { getConfig, task } from "@langchain/langgraph";
import { register } from "./registry.ts";

/** A failure no retry can fix (the model check). */
export class NonRetriableError extends Error {
	override name = "NonRetriableError";
}

/** A step's backstop timer fired. Not retried: the experiment or evaluation becomes an error outcome. */
export class StepTimeoutError extends Error {
	override name = "StepTimeoutError";
}

export interface StepContext {
	/** Fires on a cancel of the server run, the backstop timer, or the stop operation through the live registry. */
	signal: AbortSignal;
	/** For logs only: crash resume reads the state file, not this. */
	attempt: number;
}

export interface StepOptions {
	/** Backstop per attempt, in minutes. Default 30. */
	backstopMin?: number;
	/** Register the step's abort in the live registry under this id. */
	live?: { id: string; night: string };
}

const OWN_FAILURE = Symbol("codeclimb.ownFailure");

/**
 * A step failed on its own, while its server run was alive. LangGraph aborts the entrypoint's signal after any
 * step failure, so `signal.aborted` alone cannot tell a failure from a cancel from outside.
 */
export const isOwnFailure = (error: unknown) => typeof error === "object" && error !== null && (error as Record<symbol, boolean>)[OWN_FAILURE] === true;

export const DEFAULT_BACKSTOP_MIN = 30;
export const HOST_COMMAND_BACKSTOP_MIN = 35;

/** Define and call a step named `name` once. Saved results are matched by name and call order. */
export function step<A extends unknown[], R>(name: string, body: (ctx: StepContext, ...args: A) => Promise<R>, opts: StepOptions = {}): (...args: A) => Promise<R> {
	let runAborted = false;
	const t = task(
		{
			name,
			retry: {
				maxAttempts: 3,
				retryOn: (e: unknown) => !(e instanceof NonRetriableError) && !(e instanceof StepTimeoutError) && !runAborted,
			},
		},
		async (...args: A): Promise<R> => {
			const config = getConfig();
			const runSignal = config.signal;
			const attempt = config.executionInfo?.nodeAttempt ?? 1;
			const ac = new AbortController();
			const onRunAbort = () => {
				runAborted = true;
				ac.abort(runSignal?.reason);
			};
			if (runSignal?.aborted) onRunAbort();
			else runSignal?.addEventListener("abort", onRunAbort, { once: true });
			let timedOut = false;
			const backstopMin = opts.backstopMin ?? DEFAULT_BACKSTOP_MIN;
			const timer = setTimeout(() => {
				timedOut = true;
				ac.abort(new StepTimeoutError(`step ${name}: backstop of ${backstopMin} min passed`));
			}, backstopMin * 60_000);
			const unregister = opts.live ? register(opts.live.id, opts.live.night, (reason) => ac.abort(reason)) : undefined;
			try {
				const result = await body({ signal: ac.signal, attempt }, ...args);
				if (timedOut) throw ac.signal.reason;
				return result;
			} catch (error) {
				const thrown = timedOut ? ac.signal.reason : error;
				if (!runAborted && typeof thrown === "object" && thrown !== null) (thrown as Record<symbol, boolean>)[OWN_FAILURE] = true;
				throw thrown;
			} finally {
				clearTimeout(timer);
				runSignal?.removeEventListener("abort", onRunAbort);
				unregister?.();
			}
		},
	);
	return t as (...args: A) => Promise<R>;
}
