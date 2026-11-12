import assert from "node:assert/strict";
import { mkdtempSync, utimesSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadNightConfig } from "../config.ts";
import { writeJson } from "../night/files.ts";
import type { NightJson } from "../night/types.ts";
import { nightStatus, STALE_MS } from "./nights.ts";
import { serveApi, WorkerApi } from "./server.ts";
import { emptyWatch, type WatchAction, type WatchState, watch } from "./watchdog.ts";

const ROOT = process.cwd();

/** Run checks in order; return the actions. */
function checks(seen: ({ thread_id: string; status: string } | null)[], s: WatchState = emptyWatch()): WatchAction["kind"][] {
	const out: WatchAction["kind"][] = [];
	for (const t of seen) {
		const r = watch(s, t);
		s = r.state;
		out.push(r.action.kind);
	}
	return out;
}
const err = { thread_id: "t1", status: "error" };
const busy = { thread_id: "t1", status: "busy" };

test("watchdog: error on two checks in a row resumes, at most twice per thread; the third error stops", () => {
	assert.deepEqual(checks([err, busy, err, busy]), ["none", "none", "none", "none"], "one check of error is not enough");
	assert.deepEqual(checks([err, err, busy, err, err, err, err]), ["none", "resume", "none", "none", "resume", "none", "stop"]);
	// A new thread (a continue) has resumes of its own.
	assert.deepEqual(checks([err, err, err, err, { thread_id: "t2", status: "error" }, { thread_id: "t2", status: "error" }]), ["none", "resume", "none", "resume", "none", "resume"]);
	for (const status of ["busy", "interrupted", "idle"]) assert.deepEqual(checks([{ thread_id: "t1", status }, { thread_id: "t1", status }]), ["none", "none"]);
});

test("watchdog: no thread on two checks in a row stops the night", () => {
	assert.deepEqual(checks([null, busy, null]), ["none", "none", "none"]);
	assert.deepEqual(checks([null, null]), ["none", "stop"]);
});

/** A checkout with one night of each status under runs-langchain/mock/t/. */
function checkout() {
	const root = mkdtempSync(join(tmpdir(), "cc-api-"));
	const base = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
	const config = { ...base, results_path: "runs-langchain/mock/t/results.jsonl" };
	const dir = (id: string) => join(root, "runs-langchain", "mock", "t", "nights", id);
	const files: Record<string, string | null> = { fin: "done.json", stp: "stop.json", pau: "pause.json", run: null, old: null };
	for (const [id, file] of Object.entries(files)) {
		writeJson(join(dir(id), "night.json"), { night_id: id, startedAt: new Date().toISOString(), deadlineMs: 0, round0: { exp_id: `${id}-r0-starter`, sha: "c0" }, seed: null, config, metric_script_sha256: {}, lessons_sha256: [] } satisfies NightJson);
		if (file) writeJson(join(dir(id), file), file === "done.json" ? { stop_reason: "max_rounds", rounds: 1, kept: { exp_id: `${id}-r0-starter`, commit: "c0", dev_score: 0.5 }, spend_usd: 0, finished_at: "x" } : { reason: "manual", pause: 1, stops: [] });
	}
	// A night of the Inngest twin in the same folder: listed nowhere.
	writeJson(join(dir("twin"), "night.json"), { night_id: "twin", startedAt: Date.now(), config: { scenario: { name: "datenorm" }, results_path: config.results_path } });
	const old = (Date.now() - STALE_MS - 60_000) / 1000;
	utimesSync(join(dir("old"), "night.json"), old, old);
	utimesSync(dir("old"), old, old);
	return { root, dir };
}

test("status comes from files: finished, stopped, paused, stale, running", () => {
	const { dir } = checkout();
	assert.deepEqual(["fin", "stp", "pau", "old", "run"].map((id) => nightStatus(dir(id))), ["finished", "stopped", "paused", "stale", "running"]);
});

async function listen(handler: WorkerApi): Promise<{ server: Server; url: string }> {
	const server = createServer((req, res) => void handler.handle(req, res));
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("routes: health, nights, a summary, live, report; unknown night 404, bad id 400; continue validates before it reaches the server", async () => {
	const { root } = checkout();
	const { server, url } = await listen(new WorkerApi({ root, host: "127.0.0.1" }));
	try {
		assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { ok: true });
		const nights = (await (await fetch(`${url}/api/nights`)).json()) as { nights: { id: string; status: string }[] };
		assert.deepEqual(nights.nights.map((n) => n.id).sort(), ["fin", "old", "pau", "run", "stp"]);
		const fin = (await (await fetch(`${url}/api/nights/fin`)).json()) as { status: string; best: number };
		assert.equal(fin.status, "finished");
		assert.equal(fin.best, 0.5);
		const lv = (await (await fetch(`${url}/api/nights/run/live`)).json()) as { current: unknown; experiments: unknown[] };
		assert.equal(lv.current, null, "round 0: no experiment yet");
		const rep = (await (await fetch(`${url}/api/nights/fin/report`)).json()) as { rows: unknown[]; config: { primary_metric: string } };
		assert.equal(rep.config.primary_metric, "accuracy");
		assert.equal((await fetch(`${url}/api/nights/nope`)).status, 404);
		assert.equal((await fetch(`${url}/api/nights/-bad`)).status, 400);
		assert.equal((await fetch(`${url}/api/nights/fin/continue`, { method: "POST", body: JSON.stringify({ rounds: 0 }) })).status, 400);
		assert.equal((await fetch(`${url}/api/nights/fin/export/other-r1-e0`)).status, 400, "an experiment of another night");
	} finally {
		server.close();
	}
});

test("off loopback every route needs the bearer token; a busy port is a startup error", async () => {
	const { root } = checkout();
	await assert.rejects(serveApi({ root, host: "0.0.0.0", port: 0 }), /needs CODECLIMB_WORKER_TOKEN/);
	const { server, url } = await listen(new WorkerApi({ root, host: "0.0.0.0", token: "s3cret" }));
	try {
		assert.equal((await fetch(`${url}/api/health`)).status, 401);
		assert.equal((await fetch(`${url}/api/health`, { headers: { authorization: "Bearer wrong" } })).status, 401);
		assert.equal((await fetch(`${url}/api/health`, { headers: { authorization: "Bearer s3cret" } })).status, 200);
	} finally {
		server.close();
	}
	const first = await serveApi({ root, port: 0 });
	try {
		await assert.rejects(serveApi({ root, port: (first.address() as AddressInfo).port }), /EADDRINUSE/);
	} finally {
		first.close();
	}
});
