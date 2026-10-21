import assert from "node:assert/strict";
import { test } from "node:test";
import { parseApproach } from "./coder";
import { parseConfig, resolveDeadline } from "./config";
import { checkStop, decideRound, type Kept } from "./orchestrator";
import { validateRow } from "./results";
import { parseReview } from "./reviewer";
import { beatsParent, bootstrapGapSE, overfitTest, passesGates, passesThresholds, stddev } from "./stats";

const BASE_YAML = `
spec_dir: s
dataset_dir: d
run_cmd: python3 /eval/run.py
score_cmd: python3 score.py
sandbox: docker
max_rounds: 2
deadline: 90m
timeouts: { experiment_min: 10, eval_min: 3 }
models: [p/a, p/a, p/b]
reviewer_model: p/c
primary_metric: accuracy
thresholds: { accuracy: 0.9 }
gates: { schema_violations: 0 }
min_gain: 0.02
overfit_gap: 0.05
max_validations: 3
budget_usd: { experiment: 1, night: 5 }
results_path: runs/r.jsonl
`;
const cfg = parseConfig(BASE_YAML, "/base");

test("keep rule: gain >= max(min_gain, 2σ)", () => {
  assert.equal(beatsParent(0.52, 0.5, 0.02, 0), true);
  assert.equal(beatsParent(0.519, 0.5, 0.02, 0), false);
  assert.equal(beatsParent(0.55, 0.5, 0.02, 0.03), false); // 2σ = 0.06 dominates
  assert.equal(beatsParent(0.56, 0.5, 0.02, 0.03), true);
});

test("gates are caps, thresholds are floors", () => {
  assert.equal(passesGates({ schema_violations: 0, p95_ms: 10 }, { schema_violations: 0, p95_ms: 50 }), true);
  assert.equal(passesGates({ schema_violations: 1 }, { schema_violations: 0 }), false);
  assert.equal(passesGates({}, { schema_violations: 0 }), false);
  assert.equal(passesThresholds({ accuracy: 0.97 }, { accuracy: 0.97 }), true);
  assert.equal(passesThresholds({ accuracy: 0.96 }, { accuracy: 0.97 }), false);
});

test("overfit needs gap > overfit_gap and >= 2 bootstrap SE", () => {
  const ones = Array(30).fill(1);
  const mixed = [...Array(15).fill(1), ...Array(15).fill(0)];
  const big = overfitTest(1, 0.5, ones, mixed, 0.05);
  assert.ok(big.se > 0 && big.overfit);
  const none = overfitTest(1, 1, ones, ones, 0.05);
  assert.deepEqual([none.gap, none.se, none.overfit], [0, 0, false]);
  // overfit_gap < 0 forces a rotation even on a zero gap
  assert.equal(overfitTest(1, 1, ones, ones, -0.01).overfit, true);
  assert.equal(bootstrapGapSE(mixed, mixed), bootstrapGapSE(mixed, mixed)); // deterministic
  assert.ok(Math.abs(stddev([1, 2, 3, 4]) - 1.2909944) < 1e-6);
});

test("config validation", () => {
  assert.equal(cfg.spec_dir, "/base/s");
  assert.equal(cfg.baseline, "autocode-base");
  assert.throws(() => parseConfig(BASE_YAML.replace("reviewer_model: p/c", "reviewer_model: p/a"), "/b"), /reviewer_model/);
  assert.throws(() => parseConfig(BASE_YAML.replace("max_validations: 3", "max_validations: 6"), "/b"), /max_validations/);
  assert.equal(resolveDeadline("90m", 0), 90 * 60_000);
  assert.equal(resolveDeadline("2026-10-22T06:00:00Z", 0), Date.parse("2026-10-22T06:00:00Z"));
});

test("soft stops between rounds", () => {
  const now = Date.now();
  const base = { cfg, deadlineMs: now + 3_600_000, spend: 0, roundSpends: [] as number[] };
  assert.equal(checkStop({ ...base, round: 1 }).stop, false);
  assert.equal(checkStop({ ...base, round: 3 }).reason, "max_rounds");
  assert.equal(checkStop({ ...base, round: 2, deadlineMs: now - 1 }).reason, "deadline");
  assert.equal(checkStop({ ...base, round: 2, spend: 3, roundSpends: [2.5] }).reason, "budget");
  assert.equal(checkStop({ ...base, round: 2, spend: 2, roundSpends: [2] }).stop, false);
});

test("decideRound keeps the best gate-passing branch only past the keep rule", () => {
  const parent: Kept = { expId: "n-r0", sha: "p", score: 0.5, metrics: null, metricsPath: null, rescored: true, validatedFolds: [] };
  const code = (sha: string) => ({
    ok: true, sha, hypothesis: `h-${sha}`, stop: "done" as const, coder_usd: 0.1, tokens: 10,
    t_provision: 1, t_code: 2, t_teardown: 1, infra_errors: 0, resumed: false,
  });
  const ev = (accuracy: number, schema_violations = 0) => ({
    ok: true, metrics: { accuracy, schema_violations }, metricsPath: "/m.json", program_usd: 0,
    t_provision: 1, t_eval: 1, t_teardown: 1, wall_s: 3, infra_errors: 0,
  });
  const d = decideRound({
    cfg, nightId: "n", round: 1, valFold: 0, parent, sigma: 0, rescore: null, hypotheses: [null, null, null],
    branches: [
      { ok: true, expId: "n-r1-b0", branch: 0, model: "p/a", code: code("a"), eval: ev(0.9, 2) }, // best but fails a gate
      { ok: true, expId: "n-r1-b1", branch: 1, model: "p/a", code: code("b"), eval: ev(0.6) },
      { ok: false, expId: "n-r1-b2", branch: 2, model: "p/b", error: "boom" },
    ],
  });
  assert.equal(d.keep?.expId, "n-r1-b1");
  assert.deepEqual(d.rows.map((r) => r.decision), ["revert", "keep", "error"]);
  for (const r of d.rows) assert.deepEqual(validateRow(r), []);

  const none = decideRound({
    cfg, nightId: "n", round: 1, valFold: 0, parent: { ...parent, score: 0.59 }, sigma: 0, rescore: null,
    hypotheses: [null], branches: [{ ok: true, expId: "x", branch: 0, model: "p/a", code: code("c"), eval: ev(0.6) }],
  });
  assert.equal(none.keep, null);
});

test("results schema rejects bad rows", () => {
  assert.ok(validateRow({}).some((e) => e.startsWith("missing")));
  assert.ok(validateRow({ decision: "maybe" }).some((e) => e.includes("decision")));
});

test("parsers", () => {
  assert.equal(parseApproach("did stuff\nAPPROACH: regex table for month names"), "regex table for month names");
  assert.equal(parseApproach("**APPROACH:** `x`"), "x");
  assert.equal(parseApproach("**APPROACH**: y"), "y");
  assert.equal(parseApproach("My approach is fine\nlast line"), "last line");
  const r = parseReview('noise {"feedback": "f", "hypotheses": ["a", "b", "a", "c"]} tail', 3);
  assert.deepEqual(r, { feedback: "f", hypotheses: ["a", "b", "c"] });
  assert.equal(parseReview('{"feedback": "f", "hypotheses": ["a"]}', 3), null);
});
