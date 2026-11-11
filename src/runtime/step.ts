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
export const STEP_ATTEMPTS = 3;

/**
 * A step's final failure travels as data: a task that fails out of its retries fails the whole server run, even when
 * the entrypoint catches the error (LangGraph 1.7.3), so a failed experiment could never become an outcome.
 */
interface StepFailure {
	__ccStepFailure: { kind: "timeout" | "nonretriable" | "error"; message: string };
}
const isStepFailure = (v: unknown): v is StepFailure => typeof v === "object" && v !== null && "__ccStepFailure" in v;

function rebuild(f: StepFailure): Error {
	const { kind, message } = f.__ccStepFailure;
	const e = kind === "timeout" ? new StepTimeoutError(message) : kind === "nonretriable" ? new NonRetriableError(message) : new Error(message);
	(e as unknown as Record<symbol, boolean>)[OWN_FAILURE] = true;
	return e;
}
export const HOST_COMMAND_BACKSTOP_MIN = 35;

/** Define and call a step named `name` once. Saved results are matched by name and call order. */
export function step<A extends unknown[], R>(name: string, body: (ctx: StepContext, ...args: A) => Promise<R>, opts: StepOptions = {}): (...args: A) => Promise<R> {
	let runAborted = false;
	const t = task(
		{
			name,
			retry: {
				maxAttempts: STEP_ATTEMPTS,
				retryOn: (e: unknown) => !(e instanceof NonRetriableError) && !(e instanceof StepTimeoutError) && !runAborted,
			},
		},
		async (...args: A): Promise<R | StepFailure> => {
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
				// An abort of the server run travels on as a throw: the run is ending.
				if (runAborted) throw thrown;
				const kind = thrown instanceof StepTimeoutError ? "timeout" : thrown instanceof NonRetriableError ? "nonretriable" : "error";
				const message = thrown instanceof Error ? thrown.message : String(thrown);
				// Retriable and attempts left: let LangGraph retry. Otherwise return the failure as data.
				if (kind === "error" && attempt < STEP_ATTEMPTS) throw thrown;
				console.error(`step ${name} failed (attempt ${attempt}):`, thrown);
				return { __ccStepFailure: { kind, message } };
			} finally {
				clearTimeout(timer);
				runSignal?.removeEventListener("abort", onRunAbort);
				unregister?.();
			}
		},
	);
	return async (...args: A): Promise<R> => {
		const r = await (t as (...a: A) => Promise<R | StepFailure>)(...args);
		if (isStepFailure(r)) throw rebuild(r);
		return r;
	};
}
