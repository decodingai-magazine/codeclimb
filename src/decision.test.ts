import assert from "node:assert/strict";
import { test } from "node:test";
import { aaMove, type AttemptFacts, decide, guardrails, marginFor, noiseDue, outcomeOf, weightedScore } from "./decision.ts";

const thresholds = { a: 0.8, b: 0.5 };
const weights = { a: 3, b: 1 };
const noise = { min: 0.002, max: 0.005, scale_by_replay: true };

test("weighted score: shares capped at 1, missing and negative count 0, divided by the sum of weights", () => {
	assert.equal(weightedScore({}, thresholds, weights), 0);
	// a: 0.4/0.8 = 0.5 share × 3; b: past its threshold, share 1 × 1 → (1.5 + 1) / 4
	assert.equal(weightedScore({ a: 0.4, b: 0.9 }, thresholds, weights), 0.625);
	assert.equal(weightedScore({ a: -1, b: 0.25 }, thresholds, weights), 0.125);
	assert.equal(weightedScore({ b: 0.5, other: 99 }, thresholds, weights), 0.25);
});

test("margin: base × √fresh share, clamped to [min, max]", () => {
	assert.equal(marginFor(0, noise, {}), 0.002);
	// The spec's example: 0.022 × √(9/83) = 0.0072, capped to 0.005.
	assert.equal(marginFor(0.022, noise, { model_calls: 83, model_calls_replayed: 74 }), 0.005);
	assert.ok(Math.abs(marginFor(0.006, noise, { model_calls: 4, model_calls_replayed: 3 }) - 0.003) < 1e-12);
	assert.equal(marginFor(0.004, { ...noise, scale_by_replay: false }, { model_calls: 4, model_calls_replayed: 3 }), 0.004);
	assert.equal(marginFor(0.004, noise, { model_calls: 0 }), 0.004);
});

test("guardrails: a failed or missing gate, an empty stage, two held-out names", () => {
	assert.deepEqual(guardrails({ lat: 10, output_bytes: 5 }, { lat: 50 }, 1), []);
	assert.deepEqual(guardrails({ lat: 51, output_bytes: 5 }, { lat: 50, viol: 0 }, 0), ["gate lat = 51 > 50", "gate viol missing"]);
	assert.deepEqual(guardrails({ "s1.output_bytes": 0, "s2.output_bytes": 3 }, {}, 2), ["stage s1 wrote no output", "the diff names 2 held-out items"]);
	assert.deepEqual(guardrails({ output_bytes: 0 }, {}, 0), ["the stage wrote no output"]);
});

const base = { primary: "a", thresholds, weights, checkpointScore: 0, margin: 0.002, aaBase: 0, scaleByReplay: true };

test("outcome: the coder failed outright", () => {
	const d = decide({ ...base, outcome: { kind: "failed" } });
	assert.deepEqual(d, { decision: "error", reason: "the experiment failed", metrics: { a: 0 } });
});

test("outcome: unchanged files revert with the checkpoint's metrics", () => {
	const d = decide({ ...base, checkpointScore: 0.25, outcome: { kind: "unchanged", checkpointMetrics: { a: 0.4 } } });
	assert.deepEqual(d, { decision: "revert", reason: "no code change", metrics: { a: 0.4 }, unchanged: true, score: 0.25 });
});

test("outcome: check errors or a failed evaluation are not scored", () => {
	assert.deepEqual(decide({ ...base, outcome: { kind: "not_scored" } }), { decision: "error", reason: "not scored", metrics: { a: 0 } });
});

test("outcome: a guardrail blocks the keep, with its own metrics", () => {
	const d = decide({ ...base, outcome: { kind: "scored", metrics: { a: 0.8 }, guardrails: ["gate lat missing", "stage s wrote no output"] } });
	assert.deepEqual(d, { decision: "revert", reason: "blocked: gate lat missing, stage s wrote no output", metrics: { a: 0.8 }, score: 0.75 });
});

test("outcome: scored, kept above checkpoint + margin, reverted at it (epsilon 1e-12)", () => {
	// a = 0.4 → score (0.5 × 3) / 4 = 0.375
	const kept = decide({ ...base, checkpointScore: 0.37, margin: 0.004, outcome: { kind: "scored", metrics: { a: 0.4 }, guardrails: [] } });
	assert.equal(kept.decision, "keep");
	assert.equal(kept.reason, "weighted score 0.3750 > checkpoint 0.3700 + noise margin 0.0040");
	assert.equal(kept.score, 0.375);

	const equal = decide({ ...base, checkpointScore: 0.371, margin: 0.004, outcome: { kind: "scored", metrics: { a: 0.4 }, guardrails: [] } });
	assert.equal(equal.decision, "revert");
	assert.equal(equal.reason, "weighted score 0.3750 <= checkpoint 0.3710 + noise margin 0.0040");

	const withinEpsilon = decide({ ...base, checkpointScore: 0.375 - 1e-13, margin: 0, outcome: { kind: "scored", metrics: { a: 0.4 }, guardrails: [] } });
	assert.equal(withinEpsilon.decision, "revert");
	const pastEpsilon = decide({ ...base, checkpointScore: 0.375 - 1e-9, margin: 0, outcome: { kind: "scored", metrics: { a: 0.4 }, guardrails: [] } });
	assert.equal(pastEpsilon.decision, "keep");
	assert.equal(pastEpsilon.reason, "weighted score 0.3750 > checkpoint 0.3750");
});

test("scored reason: the fresh-calls clause and the A/A value appear only when they apply", () => {
	const metrics = { a: 0.4, model_calls: 83, model_calls_replayed: 74 };
	const d = decide({ ...base, aaBase: 0.022, margin: 0.005, outcome: { kind: "scored", metrics, guardrails: [] } });
	assert.equal(d.reason, "weighted score 0.3750 > checkpoint 0.0000 + noise margin 0.0050 (9 of 83 model calls fresh, A/A 0.0220)");
	const off = decide({ ...base, aaBase: 0.022, margin: 0.005, scaleByReplay: false, outcome: { kind: "scored", metrics, guardrails: [] } });
	assert.equal(off.reason, "weighted score 0.3750 > checkpoint 0.0000 + noise margin 0.0050 (A/A 0.0220)");
	const noAa = decide({ ...base, margin: 0.002, outcome: { kind: "scored", metrics, guardrails: [] } });
	assert.equal(noAa.reason, "weighted score 0.3750 > checkpoint 0.0000 + noise margin 0.0020 (9 of 83 model calls fresh)");
});

test("A/A move: weighted sum of each threshold metric's share move, so opposite moves add up", () => {
	// a: shares 0.5 and 0.4375 (move 0.0625 × 3); b: 0.4 and 0.5 (move 0.1 × 1) → (0.1875 + 0.1) / 4
	assert.ok(Math.abs(aaMove({ a: 0.4, b: 0.2 }, { a: 0.35, b: 0.25 }, thresholds, weights) - 0.071875) < 1e-12);
	assert.equal(aaMove({ a: 0.4 }, { a: 0.4 }, thresholds, weights), 0);
});

test("A/A due: a checkpoint with metrics, no noise yet or a remeasure on a new kept checkpoint, at most 2 runs, not with fixed", () => {
	const s = { runs: 0, measured: false, remeasureOn: null as string | null };
	assert.equal(noiseDue(s, "cp", false, undefined), false); // the unscored starter
	assert.equal(noiseDue(s, "cp", true, undefined), true);
	assert.equal(noiseDue(s, "cp", true, 0.003), false); // fixed margin
	assert.equal(noiseDue({ ...s, runs: 1, measured: true }, "cp", true, undefined), false);
	assert.equal(noiseDue({ ...s, runs: 1 }, "cp", true, undefined), true); // a failed run is tried again
	assert.equal(noiseDue({ runs: 1, measured: true, remeasureOn: "cp" }, "cp", true, undefined), false); // same checkpoint
	assert.equal(noiseDue({ runs: 1, measured: true, remeasureOn: "cp" }, "cp2", true, undefined), true); // the next kept one
	assert.equal(noiseDue({ runs: 2, measured: false, remeasureOn: null }, "cp", true, undefined), false);
});

const attempt = (over: Partial<AttemptFacts> = {}): AttemptFacts => ({ committed: true, unchanged: false, checkErrors: false, checkFailed: false, evaluation: { ok: true, failedOut: false, metrics: { f1: 0.5 } }, guardrails: [], ...over });

test("repair: check errors or a failed evaluation are repairable; out of retries, a crashed check, unchanged or scored are not", () => {
	const cp = { f1: 0.4 };
	assert.deepEqual(outcomeOf(attempt({ checkErrors: true, evaluation: null }), cp), { outcome: { kind: "not_scored" }, repairable: true });
	assert.equal(outcomeOf(attempt({ evaluation: { ok: false, failedOut: false, metrics: {} } }), cp).repairable, true);
	assert.equal(outcomeOf(attempt({ evaluation: { ok: false, failedOut: true, metrics: {} } }), cp).repairable, false);
	assert.equal(outcomeOf(attempt({ checkFailed: true, evaluation: null }), cp).repairable, false);
	assert.equal(outcomeOf(attempt({ committed: false, evaluation: null }), cp).repairable, false);
	assert.deepEqual(outcomeOf(attempt(), cp), { outcome: { kind: "scored", metrics: { f1: 0.5 }, guardrails: [] }, repairable: false });
});

test("repair: an e1 equal to its failed e0 is a revert, unchanged, with the checkpoint's metrics", () => {
	const cp = { f1: 0.4 };
	const { outcome } = outcomeOf(attempt({ unchanged: true, evaluation: null }), cp);
	const d = decide({ outcome, primary: "f1", thresholds: { f1: 1 }, weights: { f1: 1 }, checkpointScore: 0.4, margin: 0, aaBase: 0, scaleByReplay: false });
	assert.equal(d.decision, "revert");
	assert.equal(d.unchanged, true);
	assert.deepEqual(d.metrics, cp);
});

test("held-out names: one is only a note, two block the keep", () => {
	assert.deepEqual(guardrails({}, {}, 1), []);
	assert.equal(guardrails({}, {}, 2).length, 1);
});
