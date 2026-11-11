// The keep decision: pure functions over dev metrics (spec: Weighted score; Keep rule; Noise margin).
import type { NightConfig } from "./config.ts";

type Metrics = Record<string, number>;

export const KEEP_EPSILON = 1e-12;
/** Held-out item names in a diff's added lines that block a keep. */
export const HELD_OUT_BLOCK = 2;

/** Sum of `weight × min(max(value, 0) / threshold, 1)` over the threshold metrics, over the sum of weights. */
export function weightedScore(metrics: Metrics, thresholds: Metrics, weights: Metrics): number {
	let sum = 0;
	let total = 0;
	for (const [name, target] of Object.entries(thresholds)) {
		const w = weights[name] ?? 1;
		const v = metrics[name];
		sum += w * (typeof v === "number" ? Math.min(Math.max(v, 0) / target, 1) : 0);
		total += w;
	}
	return total > 0 ? sum / total : 0;
}

/** The share of the experiment's model calls that were not replayed; 1 when off or without calls. */
function freshShare(metrics: Metrics, scaleByReplay: boolean): number {
	const calls = metrics.model_calls ?? 0;
	if (!scaleByReplay || calls <= 0) return 1;
	return (calls - (metrics.model_calls_replayed ?? 0)) / calls;
}

/** The margin an experiment must beat: `clamp(base × √f, min, max)`. */
export function marginFor(base: number, noise: Pick<NightConfig["noise_margin"], "min" | "max" | "scale_by_replay">, metrics: Metrics): number {
	return Math.min(Math.max(base * Math.sqrt(freshShare(metrics, noise.scale_by_replay)), noise.min), noise.max);
}

/** The guardrails that fired: failed or missing gates, empty stages, held-out names in the diff. */
export function guardrails(metrics: Metrics, gates: Metrics, heldOutNames: number): string[] {
	const out: string[] = [];
	for (const [name, cap] of Object.entries(gates)) {
		const v = metrics[name];
		if (typeof v !== "number") out.push(`gate ${name} missing`);
		else if (v > cap) out.push(`gate ${name} = ${v} > ${cap}`);
	}
	for (const [name, v] of Object.entries(metrics)) {
		if (v !== 0) continue;
		if (name === "output_bytes") out.push("the stage wrote no output");
		else if (name.endsWith(".output_bytes")) out.push(`stage ${name.slice(0, -".output_bytes".length)} wrote no output`);
	}
	if (heldOutNames >= HELD_OUT_BLOCK) out.push(`the diff names ${heldOutNames} held-out items`);
	return out;
}

export type Outcome =
	| { kind: "failed" }
	| { kind: "unchanged"; checkpointMetrics: Metrics }
	| { kind: "not_scored" }
	| { kind: "scored"; metrics: Metrics; guardrails: string[] };

export interface DecideInput {
	outcome: Outcome;
	primary: string;
	thresholds: Metrics;
	weights: Metrics;
	checkpointScore: number;
	margin: number;
	/** The A/A base (fixed or measured); 0 before any A/A run. */
	aaBase: number;
	scaleByReplay: boolean;
}

export interface Decision {
	decision: "keep" | "revert" | "error";
	reason: string;
	metrics: Metrics;
	score?: number;
	unchanged?: true;
}

const f4 = (n: number) => n.toFixed(4);

export function decide(d: DecideInput): Decision {
	const o = d.outcome;
	if (o.kind === "failed") return { decision: "error", reason: "the experiment failed", metrics: { [d.primary]: 0 } };
	if (o.kind === "not_scored") return { decision: "error", reason: "not scored", metrics: { [d.primary]: 0 } };
	if (o.kind === "unchanged") return { decision: "revert", reason: "no code change", metrics: o.checkpointMetrics, unchanged: true, score: d.checkpointScore };
	const score = weightedScore(o.metrics, d.thresholds, d.weights);
	if (o.guardrails.length) return { decision: "revert", reason: `blocked: ${o.guardrails.join(", ")}`, metrics: o.metrics, score };
	const keep = score - (d.checkpointScore + d.margin) > KEEP_EPSILON;
	let reason = `weighted score ${f4(score)} ${keep ? ">" : "<="} checkpoint ${f4(d.checkpointScore)}`;
	if (d.margin > 0) {
		reason += ` + noise margin ${f4(d.margin)}`;
		const parts: string[] = [];
		const calls = o.metrics.model_calls ?? 0;
		if (d.scaleByReplay && calls > 0) parts.push(`${calls - (o.metrics.model_calls_replayed ?? 0)} of ${calls} model calls fresh`);
		if (d.aaBase > 0) parts.push(`A/A ${f4(d.aaBase)}`);
		if (parts.length) reason += ` (${parts.join(", ")})`;
	}
	return { decision: keep ? "keep" : "revert", reason, metrics: o.metrics, score };
}
