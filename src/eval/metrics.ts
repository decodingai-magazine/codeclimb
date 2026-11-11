// Stage reports become flat metrics; the standard latency and cost metrics (spec: Stage reports become metrics; Standard metrics).

export type Metrics = Record<string, number>;

const round = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

/** Flatten a score report: nested keys joined with `.`; lists, non-numbers, `per_item` and `details` skipped; `ci95: [lo, hi]` → `ci95_half`. */
export function flattenReport(report: unknown, stage: string, prefixStage: boolean): Metrics {
	const out: Metrics = {};
	const walk = (node: unknown, path: string[]) => {
		if (typeof node !== "object" || node === null || Array.isArray(node)) return;
		for (const [k, v] of Object.entries(node)) {
			if (k === "per_item" || k === "details") continue;
			if (k === "ci95" && Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "number" && Number.isFinite(x))) {
				out[[...path, "ci95_half"].join(".")] = ((v[1] as number) - (v[0] as number)) / 2;
				continue;
			}
			if (typeof v === "number" && Number.isFinite(v)) out[[...path, k].join(".")] = v;
			else walk(v, [...path, k]);
		}
	};
	walk(report, prefixStage ? [stage] : []);
	return out;
}

export interface Timing {
	op: string;
	id?: string;
	ms: number;
	warmup?: boolean;
}

const OP = /^[a-z][a-z0-9_]*$/;

/** Parse a runner's `timings.jsonl`; throws on a bad line. */
export function parseTimings(text: string): Timing[] {
	const out: Timing[] = [];
	for (const [i, line] of text.split("\n").entries()) {
		if (line.trim() === "") continue;
		let t: unknown;
		try {
			t = JSON.parse(line);
		} catch {
			throw new Error(`timings.jsonl line ${i + 1}: not JSON`);
		}
		const r = t as Record<string, unknown>;
		if (typeof r !== "object" || r === null || typeof r.op !== "string" || !OP.test(r.op) || typeof r.ms !== "number" || !Number.isFinite(r.ms) || r.ms < 0) {
			throw new Error(`timings.jsonl line ${i + 1}: needs {op matching ${OP}, ms ≥ 0}`);
		}
		out.push(t as Timing);
	}
	return out;
}

/** Linear-interpolation percentile of sorted values. */
function percentile(sorted: number[], p: number): number {
	if (sorted.length === 1) return sorted[0] as number;
	const pos = (sorted.length - 1) * p;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

export function latencyMetrics(timings: Timing[]): Metrics {
	const byOp = new Map<string, number[]>();
	for (const t of timings) {
		if (t.warmup) continue;
		const list = byOp.get(t.op) ?? [];
		list.push(t.ms);
		byOp.set(t.op, list);
	}
	const out: Metrics = {};
	let totalMs = 0;
	for (const [op, values] of byOp) {
		const sorted = [...values].sort((a, b) => a - b);
		const sum = sorted.reduce((a, b) => a + b, 0);
		totalMs += sum;
		out[`latency_${op}_p50_ms`] = round(percentile(sorted, 0.5), 3);
		out[`latency_${op}_p95_ms`] = round(percentile(sorted, 0.95), 3);
		out[`latency_${op}_total_s`] = round(sum / 1000, 6);
	}
	out.latency_total_s = round(totalMs / 1000, 6);
	return out;
}

export interface LedgerCall {
	op: string;
	ok: boolean;
	cost_usd: number;
	replayed_usd?: number;
	rejected?: number;
	/** For the metered-call spans. */
	kind?: string;
	model?: string;
	input_tokens?: number;
	output_tokens?: number;
	ms?: number;
	error?: string;
}

/** Cost metrics from a ledger's calls, refused calls excluded; all 0 without calls. A replayed call is priced as the call it stands for. */
export function costMetrics(calls: LedgerCall[], items: number): Metrics {
	const counted = calls.filter((c) => c.rejected === undefined);
	const price = (c: LedgerCall) => c.cost_usd + (c.replayed_usd ?? 0);
	const total = counted.reduce((a, c) => a + price(c), 0);
	const out: Metrics = {
		cost_usd: round(total, 9),
		cost_per_item_usd: items > 0 ? round(total / items, 9) : 0,
		model_calls: counted.length,
		model_calls_replayed: counted.filter((c) => (c.replayed_usd ?? 0) > 0 || (c.cost_usd === 0 && c.replayed_usd !== undefined)).length,
		model_calls_failed: counted.filter((c) => !c.ok).length,
	};
	for (const c of counted) out[`cost_${c.op}_usd`] = round((out[`cost_${c.op}_usd`] ?? 0) + price(c), 9);
	return out;
}
