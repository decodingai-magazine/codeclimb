// The control operations, as calls to the Agent Server's API (spec: Control operations; Durable runtime on LangGraph, Threads).
// The CLI, the worker API, the watchdog and the graphs all call this module.
import { Client } from "@langchain/langgraph-sdk";
import { nightThreadId, stopThreadId } from "./ids.ts";
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

/** The night's threads, newest first. */
export async function nightThreads(nightId: string): Promise<{ thread_id: string; status: string }[]> {
	const threads = await client().threads.search({ metadata: { kind: "night", night_id: nightId }, sortBy: "created_at", sortOrder: "desc", limit: 100 });
	return threads.map((t) => ({ thread_id: t.thread_id, status: t.status }));
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

/** The stop operation: write `stop.json` (the first stop wins), then the stop graph. */
export async function stopNight(root: string, nightId: string, reason: StopReason, nightDir = findNightDir(root, nightId)): Promise<void> {
	if (nightDir) writeStopIfMissing(nightDir, reason);
	await runStopGraph(nightId, reason);
}
