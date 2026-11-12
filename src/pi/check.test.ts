import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { checkNightModels, openRouterProblems, piModelProblems, SMOKE_RETRIES, SMOKE_WAIT_MS, smokeWithRetries } from "./check.ts";

/** A model runtime with `models` (provider/id), credentials for `authed` providers and `available` ids on the account. */
function fakeRuntime(models: string[], authed: string[], available: string[]): ModelRuntime {
	const split = (ref: string) => ({ provider: ref.split("/")[0] as string, id: ref.slice(ref.indexOf("/") + 1) });
	const rt = {
		getModel: (p: string, id: string) => (models.includes(`${p}/${id}`) ? split(`${p}/${id}`) : undefined),
		checkAuth: async (p: string) => (authed.includes(p) ? { ok: true } : undefined),
		getAvailable: async (p: string) => available.filter((r) => r.startsWith(`${p}/`)).map(split),
	};
	return rt as unknown as ModelRuntime;
}

test("the model check names each missing model, missing key and model off the account's plan", async () => {
	const rt = fakeRuntime(["copilot/a", "copilot/b", "anthropic/c"], ["copilot"], ["copilot/a"]);
	const problems = await piModelProblems(["copilot/a", "copilot/b", "anthropic/c", "copilot/zzz", "noslash", "copilot/a"], rt);
	assert.equal(problems.length, 4);
	assert.match(problems[0] as string, /copilot\/b: not available to this copilot account/);
	assert.match(problems[1] as string, /anthropic\/c: no anthropic credentials; set ANTHROPIC_API_KEY/);
	assert.match(problems[2] as string, /copilot\/zzz: not in Pi's model runtime/);
	assert.match(problems[3] as string, /noslash: not in Pi's model runtime/);
});

test("the night's check covers the coder, reviewer and Pi program models, leaves out priced embeddings, and is off in mock mode", async () => {
	const rt = fakeRuntime(["copilot/a"], ["copilot"], ["copilot/a"]);
	await checkNightModels({ model: "copilot/a", reviewer_model: "copilot/a", allowed_models: ["openai/text-embedding-3-small"] }, false, rt);
	await assert.rejects(checkNightModels({ model: "copilot/a", reviewer_model: "copilot/r", allowed_models: ["copilot/p"] }, false, rt), (e: Error) => {
		assert.match(e.message, /^models not ready:/);
		assert.match(e.message, /copilot\/r: not in/);
		assert.match(e.message, /copilot\/p: not in/);
		return true;
	});
	await checkNightModels({ model: "x/none", reviewer_model: "y/none", allowed_models: [] }, true, rt);
});

test("an openrouter/ model is ready only when OpenRouter's endpoints API lists an endpoint for it", async () => {
	const seen: string[] = [];
	const server = createServer((req, res) => {
		seen.push(`${req.url} ${req.headers.authorization}`);
		const listed = req.url === "/v1/models/good/model/endpoints";
		res.writeHead(listed ? 200 : 404, { "content-type": "application/json" });
		res.end(JSON.stringify(listed ? { data: { endpoints: [{}] } } : { error: "no" }));
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const prior = process.env.OPENROUTER_API_KEY;
	try {
		process.env.OPENROUTER_API_KEY = "k";
		assert.deepEqual(await openRouterProblems(["openrouter/good/model", "copilot/x"], base), []);
		assert.deepEqual(await openRouterProblems(["openrouter/bad/model"], base), ["openrouter/bad/model: OpenRouter lists no endpoint for it (404)"]);
		assert.ok(seen.every((s) => s.endsWith("Bearer k")));
		delete process.env.OPENROUTER_API_KEY;
		assert.match((await openRouterProblems(["openrouter/good/model"], base))[0] as string, /OPENROUTER_API_KEY is not set/);
	} finally {
		if (prior === undefined) delete process.env.OPENROUTER_API_KEY;
		else process.env.OPENROUTER_API_KEY = prior;
		server.close();
	}
});

test("a failed smoke test is tried again every 5 minutes, 6 more times, then gives up with the last failure", async () => {
	let clock = 0;
	const tries: number[] = [];
	const wait = async () => {
		clock += SMOKE_WAIT_MS;
	};
	const down = await smokeWithRetries(async (n) => {
		tries.push(clock);
		return `down ${n}`;
	}, wait);
	assert.equal(down, `down ${SMOKE_RETRIES}`);
	assert.equal(tries.length, 7);
	assert.deepEqual(tries, Array.from({ length: 7 }, (_, i) => i * 5 * 60_000));

	clock = 0;
	tries.length = 0;
	const up = await smokeWithRetries(async (n) => {
		tries.push(clock);
		return n < 2 ? "down" : null;
	}, wait);
	assert.equal(up, null);
	assert.deepEqual(tries, [0, 5 * 60_000, 10 * 60_000]);
});
