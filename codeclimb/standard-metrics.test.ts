import assert from "node:assert/strict";
import { test } from "node:test";
import { latencyMetrics, opLatencies, parseTimings, percentile } from "./standard-metrics";

const jsonl = (rows: object[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

test("percentile interpolates like the old datenorm scorer", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([4, 1, 3, 2], 0.5), 2.5);
  assert.ok(Math.abs(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95) - 9.55) < 1e-9);
});

test("latency per operation excludes warm-ups and sums the program's time", () => {
  const timings = parseTimings(
    jsonl([
      { op: "ingest", ms: 2000 },
      { op: "query", id: "q0", ms: 900, warmup: true },
      { op: "query", id: "q1", ms: 10 },
      { op: "query", id: "q2", ms: 30 },
      { op: "query", id: "q3", ms: 20 },
    ]),
  );
  const ops = opLatencies(timings);
  assert.deepEqual(ops.map((o) => [o.op, o.n]), [["ingest", 1], ["query", 3]]);
  const m = latencyMetrics(ops);
  assert.equal(m.latency_query_p50_ms, 20);
  assert.equal(m.latency_query_p95_ms, 29);
  assert.equal(m.latency_query_total_s, 0.06);
  assert.equal(m.latency_ingest_total_s, 2);
  assert.equal(m.latency_total_s, 2.06);
});

test("an operation with only warm-ups reports zeros, not NaN", () => {
  const m = latencyMetrics(opLatencies(parseTimings(jsonl([{ op: "query", ms: 50, warmup: true }]))));
  assert.deepEqual(m, { latency_query_p50_ms: 0, latency_query_p95_ms: 0, latency_query_total_s: 0, latency_total_s: 0 });
});

test("timings reject malformed records", () => {
  assert.throws(() => parseTimings(jsonl([{ op: "Query", ms: 1 }])), /bad op/);
  assert.throws(() => parseTimings(jsonl([{ op: "query", ms: -1 }])), /bad ms/);
  assert.throws(() => parseTimings(jsonl([{ op: "query" }])), /bad ms/);
  assert.deepEqual(parseTimings("\n\n"), []);
});
