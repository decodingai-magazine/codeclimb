import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import { Client } from "langsmith";
import type { Sandbox } from "./sandbox/types.ts";
import { programSpans, tracedSandbox, withRoot } from "./spans.ts";
import { flushTracing, mirroredKeys, mirrorScores, registerTracing, tracingOn } from "./tracing.ts";

interface Seen {
	method: string;
	path: string;
	body: unknown;
}

/** A stand-in for the LangSmith API that records every request; `failFeedback` answers feedback with 403, as a key of the other region gets. */
async function fakeLangSmith() {
	const seen: Seen[] = [];
	const state = { failFeedback: false };
	const read = async (req: IncomingMessage) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		let buf = Buffer.concat(chunks);
		if (req.headers["content-encoding"] === "gzip") buf = gunzipSync(buf);
		try {
			return JSON.parse(buf.toString("utf8")) as unknown;
		} catch {
			return buf.toString("utf8");
		}
	};
	const server = createServer(async (req, res) => {
		const path = (req.url ?? "/").split("?")[0] ?? "/";
		seen.push({ method: req.method ?? "", path, body: await read(req) });
		if (path.startsWith("/feedback") && state.failFeedback) {
			res.writeHead(403).end("{}");
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		if (req.method === "GET" && path === "/sessions") res.end(JSON.stringify([{ id: "11111111-1111-4111-8111-111111111111", name: "codeclimb" }]));
		else if (path === "/info") res.end(JSON.stringify({ batch_ingest_config: { use_multipart_endpoint: false } }));
		else res.end("{}");
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	return { seen, state, server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

type Run = { id: string; name: string; parent_run_id?: string; trace_id?: string; extra?: { metadata?: Record<string, unknown> }; end_time?: unknown };

const fakeSandbox = { exec: async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, aborted: false }), readFile: async () => Buffer.from("x"), writeFile: async () => {} } as unknown as Sandbox;

test("tracing is off without a key or with LANGSMITH_TRACING=false; spans are then no-ops", async () => {
	assert.equal(tracingOn({}), false);
	assert.equal(tracingOn({ LANGSMITH_API_KEY: "k", LANGSMITH_TRACING: "false" }), false);
	assert.equal(tracingOn({ LANGSMITH_API_KEY: "k" }), true);
	const saved = process.env.LANGSMITH_API_KEY;
	delete process.env.LANGSMITH_API_KEY;
	try {
		assert.equal(registerTracing(), false, "no provider without a key");
		assert.equal(await withRoot("n-r1-e0", { night_id: "n" }, async (id) => id), undefined, "no run id while off");
	} finally {
		if (saved !== undefined) process.env.LANGSMITH_API_KEY = saved;
	}
});

test("a root is its own trace with the night id; its spans nest under it; a span outside any root sends nothing; feedback overwrites by id and a failed call is swallowed", async () => {
	const fake = await fakeLangSmith();
	try {
		const client = new Client({ apiUrl: fake.url, apiKey: "test", autoBatchTracing: false });
		assert.equal(registerTracing(client), true);
		await tracedSandbox(fakeSandbox).exec("echo stray");
		const runId = await withRoot("n-r1-e0", { night_id: "n", exp_id: "n-r1-e0" }, async (id) => {
			const sb = tracedSandbox(fakeSandbox);
			await sb.exec("ls");
			await sb.writeFile("/a", "x");
			programSpans([{ op: "predict", ms: 5.25 }, { op: "predict", ms: 7.5 }, { op: "load", ms: 1, warmup: true }], Date.now());
			return id;
		});
		assert.match(runId ?? "", /^[0-9a-f-]{36}$/);
		await flushTracing();

		const posted = fake.seen.filter((s) => s.method === "POST" && s.path === "/runs").map((s) => s.body as Run);
		const patched = fake.seen.filter((s) => s.method === "PATCH" && s.path.startsWith("/runs/"));
		const root = posted.find((r) => r.name === "n-r1-e0");
		assert.ok(root, "the root was posted");
		assert.equal(root.id, runId);
		assert.equal(root.parent_run_id ?? undefined, undefined);
		assert.equal(root.extra?.metadata?.night_id, "n");
		assert.equal(root.extra?.metadata?.exp_id, "n-r1-e0");
		const children = posted.filter((r) => r !== root);
		assert.deepEqual(children.map((r) => r.name).sort(), ["program.predict", "sandbox.exec", "sandbox.write"], "the stray exec and the warmup op sent nothing");
		for (const c of children) {
			assert.equal(c.parent_run_id, runId);
			assert.equal(c.trace_id, runId);
			assert.equal(c.extra?.metadata?.night_id, "n", "children carry the root's metadata");
		}
		assert.equal(patched.length, posted.length, "every run is patched at its end");
		for (const p of patched) {
			const end = (p.body as { end_time?: unknown }).end_time;
			assert.ok(typeof end !== "number" || Number.isInteger(end), `whole-millisecond end time, got ${String(end)}: the real API drops a batch with a fractional one`);
		}

		const metrics = { accuracy: 0.5, cost_usd: 0.01, zeta: 1, alpha: 2 };
		assert.deepEqual(mirroredKeys(metrics, "accuracy", []), ["accuracy", "alpha", "cost_usd", "zeta"]);
		assert.deepEqual(mirroredKeys(metrics, "accuracy", ["cost_usd", "missing"]), ["accuracy", "cost_usd"]);
		await mirrorScores(runId, "n-r1-e0-eval", metrics, ["accuracy", "cost_usd"]);
		await mirrorScores(runId, "n-r1-e0-eval", { ...metrics, accuracy: 0.75 }, ["accuracy", "cost_usd"]);
		const fb = fake.seen.filter((s) => s.method === "POST" && s.path === "/feedback").map((s) => s.body as { id: string; key: string; score: number; run_id: string; session_id: string });
		assert.equal(fb.length, 4);
		assert.deepEqual(fb.map((f) => f.key), ["accuracy", "cost_usd", "accuracy", "cost_usd"]);
		assert.equal(fb[0]?.id, fb[2]?.id, "one feedback id per evaluation and metric");
		assert.notEqual(fb[0]?.id, fb[1]?.id);
		assert.equal(fb[2]?.score, 0.75);
		assert.equal(fb[0]?.run_id, runId);
		assert.equal(fb[0]?.session_id, "11111111-1111-4111-8111-111111111111");

		fake.state.failFeedback = true;
		await mirrorScores(runId, "n-r2-e0-eval", metrics, ["accuracy"]);
		await mirrorScores(undefined, "n-r2-e0-eval", metrics, ["accuracy"]);
	} finally {
		fake.server.close();
	}
});
