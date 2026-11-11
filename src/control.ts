// The control operations, as calls to the Agent Server's API (spec: Control operations; Durable runtime on LangGraph, Threads).
// The CLI, the worker API, the watchdog and the graphs all call this module.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@langchain/langgraph-sdk";
import type { NightConfig } from "./config.ts";
import { lessonsThreadId, nightThreadId, stopThreadId, timerThreadId } from "./ids.ts";
import { findNightDir, type StopReason, writeStopIfMissing } from "./night/files.ts";
import type { NightInput } from "./night/types.ts";

export const serverUrl = () => process.env.CODECLIMB_SERVER_URL ?? "http://127.0.0.1:2024";
const client = () => new Client({ apiUrl: serverUrl() });

export type StartResult = { started: true; threadId: string } | { started: false; threadId: string };

/** Create the night's thread (raise if it exists), then a server run of `night` on it. A 409 means the night already runs. */
export async function startNight(input: NightInput): Promise<StartResult> {
	const c = client();
	const threadId = nightThreadId(input.night_id);
	try {
		await c.threads.create({ threadId, ifExists: "raise", metadata: { kind: "night", night_id: input.night_id, run: 0 } });
	} catch (error) {
		if (typeof error === "object" && error !== null && "status" in error && error.status === 409) return { started: false, threadId };
		throw error;
	}
	await c.runs.create(threadId, "night", { input: { ...input }, multitaskStrategy: "reject" });
	return { started: true, threadId };
}

/** A continued variation: a new thread (a random UUID, so it never meets the saved steps of the variation before), then its server run. */
export async function startVariation(input: NightInput): Promise<string> {
	const c = client();
	const thread = await c.threads.create({ metadata: { kind: "night", night_id: input.night_id, run: input.variation ?? 0 } });
	await c.runs.create(thread.thread_id, "night", { input: { ...input }, multitaskStrategy: "reject" });
	return thread.thread_id;
}

/** The night's threads, newest first. */
export async function nightThreads(nightId: string): Promise<{ thread_id: string; status: string; variation: number }[]> {
	const threads = await client().threads.search({ metadata: { kind: "night", night_id: nightId }, sortBy: "created_at", sortOrder: "desc", limit: 100 });
	return threads.map((t) => ({ thread_id: t.thread_id, status: t.status, variation: Number(t.metadata?.run ?? 0) }));
}

/** The pause number of the newest thread's pending interrupt, or null: a night is paused by this, never by the thread's status. */
export async function pendingPause(nightId: string): Promise<{ threadId: string; pause: number } | null> {
	const newest = (await nightThreads(nightId))[0];
	if (!newest) return null;
	const state = await client().threads.getState(newest.thread_id);
	for (const task of state.tasks) {
		for (const i of task.interrupts) {
			const pause = (i.value as { pause?: unknown } | undefined)?.pause;
			if (typeof pause === "number") return { threadId: newest.thread_id, pause };
		}
	}
	return null;
}

export type ResumeResult = { resumed: number } | { refused: string };

/** End a pause: a server run of `night` on the newest thread with the resume command for the pending pause. A stopped night is never resumed. */
export async function resumeNight(root: string, nightId: string): Promise<ResumeResult> {
	const dir = findNightDir(root, nightId);
	if (dir && existsSync(join(dir, "stop.json"))) return { refused: `night ${nightId} was stopped` };
	if (dir && existsSync(join(dir, "done.json"))) return { refused: `night ${nightId} is done` };
	const pending = await pendingPause(nightId);
	if (!pending) return { refused: `night ${nightId} is not paused` };
	try {
		await client().runs.create(pending.threadId, "night", { command: { resume: { pause: pending.pause } }, multitaskStrategy: "reject" });
	} catch (error) {
		// A run is in flight on the thread: the pause was resumed already and its end has not run yet.
		if (typeof error === "object" && error !== null && "status" in error && error.status === 409) return { refused: `night ${nightId} is running: pause ${pending.pause} was resumed already` };
		throw error;
	}
	return { resumed: pending.pause };
}

export interface TimerGuard {
	pause?: number;
	variation?: number;
}

/** A delayed server run of `stop` on the night's timer thread (created if missing), carrying its guard. */
export async function startTimer(nightId: string, guard: TimerGuard, afterSeconds: number): Promise<void> {
	const c = client();
	const threadId = timerThreadId(nightId);
	await c.threads.create({ threadId, ifExists: "do_nothing", metadata: { kind: "timer", night_id: nightId } });
	await c.runs.create(threadId, "stop", { input: { night_id: nightId, reason: "failed", guard }, afterSeconds, multitaskStrategy: "enqueue" });
}

/** Cancel every pending or running server run on the night's threads, action interrupt, without waiting. */
export async function cancelNightRuns(nightId: string): Promise<number> {
	const c = client();
	let n = 0;
	for (const t of await nightThreads(nightId)) {
		for (const status of ["running", "pending"] as const) {
			for (const run of await c.runs.list(t.thread_id, { status, limit: 100 })) {
				// The SDK always sends `wait`, and the server reads any value as wait: call the route without it.
				const r = await fetch(`${serverUrl()}/threads/${t.thread_id}/runs/${run.run_id}/cancel?action=interrupt`, { method: "POST" });
				if (r.ok || r.status === 404 || r.status === 409) n++;
				else throw new Error(`cancel ${run.run_id}: HTTP ${r.status} ${await r.text()}`);
			}
		}
	}
	return n;
}

/** A server run of `stop` on the night's stop thread (created if missing), queued behind any in flight. */
export async function runStopGraph(nightId: string, reason?: StopReason): Promise<void> {
	const c = client();
	const threadId = stopThreadId(nightId);
	await c.threads.create({ threadId, ifExists: "do_nothing", metadata: { kind: "stop", night_id: nightId } });
	await c.runs.create(threadId, "stop", { input: { night_id: nightId, ...(reason ? { reason } : {}) }, multitaskStrategy: "enqueue" });
}

export interface LessonsInput {
	night_id: string;
	scenario: string;
	config: NightConfig;
}

/** The lessons operation: a server run of `lessons` on the scenario's lessons thread (created if missing), queued behind any in flight. */
export async function startLessons(input: LessonsInput): Promise<void> {
	const c = client();
	const threadId = lessonsThreadId(input.scenario);
	await c.threads.create({ threadId, ifExists: "do_nothing", metadata: { kind: "lessons", scenario: input.scenario } });
	await c.runs.create(threadId, "lessons", { input: { ...input }, multitaskStrategy: "enqueue" });
}

/** The stop operation: write `stop.json` (the first stop wins), then the stop graph. */
export async function stopNight(root: string, nightId: string, reason: StopReason, nightDir = findNightDir(root, nightId)): Promise<void> {
	if (nightDir) writeStopIfMissing(nightDir, reason);
	await runStopGraph(nightId, reason);
}
