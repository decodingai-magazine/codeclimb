// The watchdog: crash recovery only, in the worker API's process (spec: Durable runtime on LangGraph, Watchdog).
// Every 60 s, every night with neither done.json nor stop.json, read through its newest thread.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { nightThreads, resumeErroredThread, stopNight } from "../control.ts";
import { listNights } from "./nights.ts";

export const WATCHDOG_INTERVAL_MS = 60_000;
/** Server runs with no input on one errored thread; the next `error` stops the night. */
export const WATCHDOG_RESUMES = 2;
/** Checks in a row a state must hold before the watchdog acts on it. */
const CHECKS = 2;

export interface WatchState {
	/** The thread of the last check (null: none found), and how many checks in a row saw it so. */
	thread: string | null;
	errorChecks: number;
	missingChecks: number;
	/** Resumes so far, per thread. */
	resumes: Record<string, number>;
}

export const emptyWatch = (): WatchState => ({ thread: null, errorChecks: 0, missingChecks: 0, resumes: {} });

export type WatchAction = { kind: "none" } | { kind: "resume"; thread: string } | { kind: "stop" };

/**
 * One check of one night. `error` on two checks in a row → a resume, at most twice per thread; the third → stop.
 * No thread on two checks in a row → stop. A busy, interrupted or idle thread is the server's: nothing.
 */
export function watch(s: WatchState, newest: { thread_id: string; status: string } | null): { state: WatchState; action: WatchAction } {
	if (!newest) {
		const missingChecks = s.missingChecks + 1;
		const state = { ...s, thread: null, errorChecks: 0, missingChecks };
		return { state, action: missingChecks >= CHECKS ? { kind: "stop" } : { kind: "none" } };
	}
	if (newest.status !== "error") return { state: { ...s, thread: newest.thread_id, errorChecks: 0, missingChecks: 0 }, action: { kind: "none" } };
	const errorChecks = (s.thread === newest.thread_id ? s.errorChecks : 0) + 1;
	const state = { ...s, thread: newest.thread_id, errorChecks, missingChecks: 0 };
	if (errorChecks < CHECKS) return { state, action: { kind: "none" } };
	const used = s.resumes[newest.thread_id] ?? 0;
	if (used >= WATCHDOG_RESUMES) return { state, action: { kind: "stop" } };
	return { state: { ...state, errorChecks: 0, resumes: { ...s.resumes, [newest.thread_id]: used + 1 } }, action: { kind: "resume", thread: newest.thread_id } };
}

/** Start the watchdog's checks; returns the function that ends them. */
export function startWatchdog(root: string, intervalMs = WATCHDOG_INTERVAL_MS): () => void {
	const states = new Map<string, WatchState>();
	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			for (const n of listNights(root)) {
				if (existsSync(join(n.dir, "done.json")) || existsSync(join(n.dir, "stop.json"))) {
					states.delete(n.id);
					continue;
				}
				let newest: { thread_id: string; status: string } | null;
				try {
					newest = (await nightThreads(n.id))[0] ?? null;
				} catch (error) {
					// The Agent Server is down: no check counts, and nothing is acted on.
					console.error(`watchdog: cannot read the threads of ${n.id}:`, (error as Error).message);
					continue;
				}
				const { state, action } = watch(states.get(n.id) ?? emptyWatch(), newest);
				states.set(n.id, state);
				if (action.kind === "resume") {
					console.log(`watchdog: night ${n.id}: thread ${action.thread} errored; resume ${state.resumes[action.thread]} of ${WATCHDOG_RESUMES}`);
					await resumeErroredThread(action.thread);
				} else if (action.kind === "stop") {
					console.log(`watchdog: night ${n.id}: ${newest ? "errored past its resumes" : "no thread"}: stopped as failed`);
					await stopNight(root, n.id, "failed", n.dir);
				}
			}
		} catch (error) {
			console.error("watchdog:", error);
		} finally {
			running = false;
		}
	};
	const timer = setInterval(() => void tick(), intervalMs);
	void tick();
	return () => clearInterval(timer);
}
