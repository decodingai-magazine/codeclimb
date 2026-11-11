import assert from "node:assert/strict";
import { test } from "node:test";
import { flattenReport, latencyMetrics, parseTimings } from "./metrics.ts";

test("nested keys join with dots; lists, non-numbers, per_item and details are skipped", () => {
	const report = { accuracy: 0.5, mentions: { f1: 0.7, precision: 0.6, list: [1, 2] }, name: "x", per_item: { a: 1 }, details: { b: 2 }, ok: true };
	assert.deepEqual(flattenReport(report, "answer", false), { accuracy: 0.5, "mentions.f1": 0.7, "mentions.precision": 0.6 });
});

test("a ci95 pair becomes its half width", () => {
	const m = flattenReport({ f1: { mean: 0.5, ci95: [0.4, 0.6] } }, "s", false);
	assert.deepEqual(Object.keys(m), ["f1.mean", "f1.ci95_half"]);
	assert.ok(Math.abs((m["f1.ci95_half"] as number) - 0.1) < 1e-12);
});

test("with more than one stage every key gets the stage in front", () => {
	assert.deepEqual(flattenReport({ mentions: { f1: 0.8 } }, "extraction", true), { "extraction.mentions.f1": 0.8 });
});

test("latency from timings: warm-ups count for nothing; percentiles interpolate", () => {
	const lines = [
		{ op: "query", ms: 1000, warmup: true },
		{ op: "query", id: "a", ms: 10 },
		{ op: "query", id: "b", ms: 20 },
		{ op: "query", id: "c", ms: 30 },
		{ op: "query", id: "d", ms: 40 },
	];
	const m = latencyMetrics(lines);
	assert.equal(m.latency_query_p50_ms, 25);
	assert.equal(m.latency_query_p95_ms, 38.5);
	assert.equal(m.latency_query_total_s, 0.1);
	assert.equal(m.latency_total_s, 0.1);
});

test("a bad timings file is an error", () => {
	assert.throws(() => parseTimings('{"op":"Bad Op","ms":1}\n'), /timings/);
	assert.throws(() => parseTimings('{"op":"q"}\n'), /timings/);
	assert.throws(() => parseTimings("not json\n"), /timings/);
	assert.deepEqual(parseTimings('{"op":"q","ms":2}\n\n'), [{ op: "q", ms: 2 }]);
});
