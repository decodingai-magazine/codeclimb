import assert from "node:assert/strict";
import { test } from "node:test";
import { Ledger, MAX_BODY_BYTES, type MeterRow, ReplayCache, refusal } from "./ledger.ts";

const row = (over: Partial<MeterRow> = {}): MeterRow => ({ kind: "chat", model: "m", op: "program", ok: true, input_tokens: 1, output_tokens: 1, cost_usd: 0.01, ms: 300, ...over });

test("refusals in order: 401, 413, 403, 402 credit stop, 402 cap spent, 400, each with its type", () => {
	const l = new Ledger({ id: "e", allowedModels: ["m"], capUsd: 1 });
	assert.deepEqual(refusal(undefined, 0, "m", null)?.status, 401);
	assert.equal(refusal(undefined, 0, "m", null)?.type, "authentication_error");
	// Every failure at once: the first in the order wins.
	l.creditStopped = true;
	l.spentUsd = 2;
	assert.deepEqual([refusal(l, MAX_BODY_BYTES + 1, "x", "tools")?.status, refusal(l, MAX_BODY_BYTES + 1, "x", "tools")?.type], [413, "invalid_request_error"]);
	assert.deepEqual([refusal(l, 10, "x", "tools")?.status, refusal(l, 10, "x", "tools")?.type], [403, "permission_error"]);
	const credit = refusal(l, 10, "m", "tools");
	assert.deepEqual([credit?.status, credit?.type], [402, "insufficient_quota"]);
	assert.match(credit?.message ?? "", /credits/);
	l.creditStopped = false;
	const cap = refusal(l, 10, "m", "tools");
	assert.deepEqual([cap?.status, cap?.type], [402, "insufficient_quota"]);
	assert.match(cap?.message ?? "", /budget/);
	l.spentUsd = 0;
	assert.deepEqual([refusal(l, 10, "m", "tools")?.status, refusal(l, 10, "m", "tools")?.type], [400, "invalid_request_error"]);
	assert.equal(refusal(l, 10, "m", null), null);
	l.closed = true;
	assert.equal(refusal(l, 10, "m", null)?.status, 401);
});

test("a cap is checked before a call, so the crossing call still runs", () => {
	const l = new Ledger({ id: "e", allowedModels: ["m"], capUsd: 0.015 });
	assert.equal(refusal(l, 1, "m", null), null);
	l.record(row());
	assert.equal(refusal(l, 1, "m", null), null);
	l.record(row());
	assert.equal(refusal(l, 1, "m", null)?.status, 402);
});

test("replay: a call repeated by another evaluation replays; within one evaluation it goes upstream", () => {
	const cache = new ReplayCache();
	cache.forNight("n");
	const a = new Ledger({ id: "n-r1-e0-eval", allowedModels: ["m"], capUsd: 1 });
	const b = new Ledger({ id: "n-r2-e0-eval", allowedModels: ["m"], capUsd: 1 });
	const key = ReplayCache.key("chat", "m", { messages: [1] });
	cache.store(a, key, { answer: 1 }, row());
	assert.equal(cache.lookup(a, key), null);
	assert.deepEqual(cache.lookup(b, key)?.body, { answer: 1 });
	assert.equal(cache.lookup(b, key)?.row.ms, 300); // the answer comes back after the original call's time
	assert.equal(cache.lookup(b, ReplayCache.key("chat", "m", { messages: [2] })), null);
});

test("replay: the A/A run neither reads nor writes the cache; a cut-off or failed reply is not cached; a new night clears it", () => {
	const cache = new ReplayCache();
	cache.forNight("n");
	const ev = new Ledger({ id: "e1", allowedModels: ["m"], capUsd: 1 });
	const aa = new Ledger({ id: "e1-noise-r2", allowedModels: ["m"], capUsd: 1, noCache: true });
	const k = ReplayCache.key("chat", "m", "q");
	cache.store(aa, k, "x", row());
	assert.equal(cache.lookup(new Ledger({ id: "e2", allowedModels: ["m"], capUsd: 1 }), k), null);
	cache.store(ev, k, "x", row());
	assert.equal(cache.lookup(aa, k), null);
	const k2 = ReplayCache.key("chat", "m", "q2");
	cache.store(ev, k2, "y", row({ finish_reason: "length" }));
	cache.store(ev, ReplayCache.key("chat", "m", "q3"), "z", row({ ok: false }));
	const other = new Ledger({ id: "e2", allowedModels: ["m"], capUsd: 1 });
	assert.equal(cache.lookup(other, k2), null);
	assert.ok(cache.lookup(other, k));
	cache.forNight("n2");
	assert.equal(cache.lookup(other, k), null);
});

test("replay: the coder replays its own calls, except a repeat within 5 s of its last answer", () => {
	const cache = new ReplayCache();
	cache.forNight("n");
	const dev = new Ledger({ id: "n-r1-e0-dev", allowedModels: ["m"], capUsd: 1, coder: true });
	const k = ReplayCache.key("chat", "m", "q");
	cache.store(dev, k, "x", row(), 1_000);
	assert.equal(cache.lookup(dev, k, 4_000), null);
	assert.ok(cache.lookup(dev, k, 7_000));
});
