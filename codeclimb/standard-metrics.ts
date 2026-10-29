// Standard metrics, the same for every scenario and computed outside the code
// under optimization. Latency comes from the hidden runner's timings file: one
// JSON line per operation of the program, `{op, id?, ms, warmup?}`, e.g.
// op "ingest" or "query". Warm-up records count toward nothing. Cost comes from
// the metering proxy's ledger of the program's model calls.
import type { MeterCall } from "./meter/proxy";
import type { Metrics } from "./stats";

/** Written by `run_cmd` next to its outputs. */
export const TIMINGS_FILE = "timings.jsonl";

export interface Timing {
  op: string;
  id?: string;
  ms: number;
  warmup?: boolean;
}

export interface OpLatency {
  op: string;
  n: number;
  p50_ms: number;
  p95_ms: number;
  total_s: number;
}

/** Linear-interpolation percentile, as the datenorm scorer computed it. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const k = (s.length - 1) * p;
  const lo = Math.floor(k);
  const hi = Math.ceil(k);
  return s[lo] + (s[hi] - s[lo]) * (k - lo);
}

const round3 = (x: number) => Math.round(x * 1e3) / 1e3;
// Seconds keep microseconds: a fast program's whole run can be a few milliseconds.
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function parseTimings(text: string): Timing[] {
  const out: Timing[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const t = JSON.parse(line) as Partial<Timing>;
    if (typeof t.op !== "string" || !/^[a-z][a-z0-9_]*$/.test(t.op)) throw new Error(`timings: bad op ${JSON.stringify(t.op)}`);
    if (typeof t.ms !== "number" || !Number.isFinite(t.ms) || t.ms < 0) throw new Error(`timings: bad ms for op ${t.op}`);
    out.push({ op: t.op, id: t.id, ms: t.ms, warmup: t.warmup === true });
  }
  return out;
}

/** Per-operation latency in first-seen order, warm-up records excluded. */
export function opLatencies(timings: Timing[]): OpLatency[] {
  const byOp = new Map<string, number[]>();
  for (const t of timings) {
    if (!byOp.has(t.op)) byOp.set(t.op, []);
    if (!t.warmup) byOp.get(t.op)!.push(t.ms);
  }
  return [...byOp].map(([op, ms]) => ({
    op,
    n: ms.length,
    p50_ms: round3(percentile(ms, 0.5)),
    p95_ms: round3(percentile(ms, 0.95)),
    total_s: round6(ms.reduce((a, b) => a + b, 0) / 1000),
  }));
}

/** `latency_<op>_{p50_ms,p95_ms,total_s}` per operation and `latency_total_s`, the program's time over the eval. */
export function latencyMetrics(ops: OpLatency[]): Metrics {
  const m: Metrics = {};
  for (const o of ops) {
    m[`latency_${o.op}_p50_ms`] = o.p50_ms;
    m[`latency_${o.op}_p95_ms`] = o.p95_ms;
    m[`latency_${o.op}_total_s`] = o.total_s;
  }
  m.latency_total_s = round6(ops.reduce((a, o) => a + o.total_s, 0));
  return m;
}

const round9 = (x: number) => Math.round(x * 1e9) / 1e9;

/**
 * `cost_usd`, `cost_per_item_usd`, `model_calls` and `cost_<op>_usd` per operation. Always present, 0
 * without model calls, so cost compares (and its noise is measured) for every scenario.
 */
export function costMetrics(calls: MeterCall[], nItems: number): Metrics {
  const m: Metrics = {};
  for (const c of calls) m[`cost_${c.op}_usd`] = (m[`cost_${c.op}_usd`] ?? 0) + c.cost_usd;
  for (const k of Object.keys(m)) m[k] = round9(m[k]);
  const total = calls.reduce((a, c) => a + c.cost_usd, 0);
  // Totals last: an op named "per_item" must not shadow them.
  m.cost_usd = round9(total);
  m.cost_per_item_usd = nItems ? round9(total / nItems) : 0;
  m.model_calls = calls.length;
  return m;
}
