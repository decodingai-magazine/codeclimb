import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coderPrompt, parseApproach } from "./coder";
import { checkSandboxLimits, efficiencyMetrics, parallelWidth, parseConfig, relativeConfig, resolveDeadline, rootConfig } from "./config";
import { checkStop, decideRound, type Kept, rotate } from "./orchestrator";
import { validateRow } from "./results";
import { parseReview } from "./reviewer";
import { beatsParent, passesGates, passesThresholds, stddev } from "./stats";

// Config paths resolve against the repo root, where the real capitals scenario lives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_YAML = `
scenario: scenarios/capitals
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
budget_usd: { experiment: 1, night: 5 }
results_path: runs/r.jsonl
`;
const cfg = parseConfig(BASE_YAML, ROOT);

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

test("config validation", () => {
  assert.equal(cfg.scenario_dir, join(ROOT, "scenarios/capitals"));
  assert.equal(cfg.scenario.image, "codeclimb-python");
  assert.deepEqual(cfg.scenario.stages.map((s) => s.name), ["answer"]);
  assert.throws(() => parseConfig(BASE_YAML.replace("reviewer_model: p/c", "reviewer_model: p/a"), ROOT), /reviewer_model/);
  assert.throws(() => parseConfig(`${BASE_YAML}overfit_gap: 0.05\n`, ROOT), /is gone/);
  assert.throws(() => parseConfig(BASE_YAML.replace("scenarios/capitals", "scenarios/missing"), ROOT), /scenario\.yaml/);
  // eval defaults to experiment, dev to eval.
  assert.deepEqual(cfg.budget_usd, { experiment: 1, night: 5, eval: 1, dev: 1 });
  const capped = parseConfig(BASE_YAML.replace("night: 5 }", "night: 5, eval: 0.2 }"), ROOT);
  assert.deepEqual([capped.budget_usd.eval, capped.budget_usd.dev], [0.2, 0.2]);
  assert.throws(() => parseConfig(BASE_YAML.replace("night: 5 }", "night: 5, dev: 0 }"), ROOT), /budget_usd.dev/);
  // Inngest sandboxes run an hour at most: a long coder or eval must fit, with room to spare.
  const long = { ...cfg, timeouts: { experiment_min: 90, eval_min: 3 } };
  assert.doesNotThrow(() => checkSandboxLimits({ ...long, sandbox: "docker" }));
  assert.throws(() => checkSandboxLimits({ ...long, sandbox: "inngest" }), /experiment_min must be <= 50/);
  assert.throws(() => checkSandboxLimits({ ...cfg, sandbox: "inngest", timeouts: { experiment_min: 10, eval_min: 55 } }), /eval_min/);
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

test("token cap and plateau stops", () => {
  const base = { cfg, round: 2, deadlineMs: Date.now() + 3_600_000, spend: 0, roundSpends: [] as number[] };
  assert.equal(cfg.max_tokens, null);
  assert.equal(cfg.plateau_rounds, 3);
  // No cap: any token count goes on.
  assert.equal(checkStop({ ...base, tokens: 1e12, roundTokens: [1e9] }).stop, false);
  const capped = { ...cfg, max_tokens: 1000 };
  assert.equal(checkStop({ ...base, cfg: capped, tokens: 600, roundTokens: [500] }).reason, "tokens");
  assert.equal(checkStop({ ...base, cfg: capped, tokens: 500, roundTokens: [500] }).stop, false);
  assert.equal(checkStop({ ...base, roundsWithoutKeep: 2 }).stop, false);
  assert.equal(checkStop({ ...base, roundsWithoutKeep: 3 }).reason, "plateau");
  assert.equal(checkStop({ ...base, cfg: { ...cfg, plateau_rounds: 0 }, roundsWithoutKeep: 50 }).stop, false);
  const parsed = parseConfig(`${BASE_YAML}max_tokens: 2000000\nplateau_rounds: 5\n`, ROOT);
  assert.equal(parsed.max_tokens, 2_000_000);
  assert.equal(parsed.plateau_rounds, 5);
  assert.throws(() => parseConfig(`${BASE_YAML}max_tokens: 0\n`, ROOT), /max_tokens/);
  assert.throws(() => parseConfig(`${BASE_YAML}plateau_rounds: -1\n`, ROOT), /plateau_rounds/);
});

test("parallel width decays from every model to min, and widens again after a stall", () => {
  assert.deepEqual(cfg.parallel, { decay: "linear", min: 1, widen_after: 1 });
  const c = { ...cfg, models: ["p/a", "p/a", "p/a", "p/b"], max_rounds: 10 };
  const widths = Array.from({ length: 10 }, (_, i) => parallelWidth(c, i + 1, 0));
  assert.deepEqual(widths, [4, 4, 3, 3, 3, 2, 2, 2, 1, 1]);
  assert.equal(parallelWidth(c, 9, 1), 4); // nothing kept last round: explore again
  assert.equal(parallelWidth({ ...c, parallel: { ...c.parallel, widen_after: 2 } }, 9, 1), 1);
  assert.equal(parallelWidth({ ...c, parallel: { ...c.parallel, widen_after: 0 } }, 9, 5), 1);
  assert.equal(parallelWidth({ ...c, parallel: { ...c.parallel, min: 2 } }, 10, 0), 2);
  assert.equal(parallelWidth({ ...c, parallel: { ...c.parallel, decay: "none" } }, 10, 0), 4);
  assert.equal(parallelWidth({ ...c, max_rounds: 1 }, 1, 0), 4);
  const parsed = parseConfig(`${BASE_YAML}parallel: { decay: none, min: 2, widen_after: 0 }\n`, ROOT);
  assert.deepEqual(parsed.parallel, { decay: "none", min: 2, widen_after: 0 });
  assert.throws(() => parseConfig(`${BASE_YAML}parallel: { min: 4 }\n`, ROOT), /parallel.min/);
  assert.throws(() => parseConfig(`${BASE_YAML}parallel: { decay: cosine }\n`, ROOT), /parallel.decay/);
  assert.throws(() => parseConfig(`${BASE_YAML}parallel: { widen_after: -1 }\n`, ROOT), /widen_after/);
});

test("decideRound keeps the best gate-passing branch only past the keep rule", () => {
  const parent: Kept = { expId: "n-r0", sha: "p", score: 0.5, metrics: null, metricsPath: null, rescored: true };
  const code = (sha: string) => ({
    ok: true, sha, hypothesis: `h-${sha}`, stop: "done" as const, coder_usd: 0.1, dev_usd: 0, tokens: 10,
    t_provision: 1, t_code: 2, t_teardown: 1, infra_errors: 0, resumed: false,
  });
  const ev = (accuracy: number, schema_violations = 0) => ({
    ok: true, metrics: { accuracy, schema_violations }, metricsPath: "/m.json", program_usd: 0,
    t_provision: 1, t_eval: 1, t_teardown: 1, wall_s: 3, infra_errors: 0, evaluator_instance: "i1", eval_order: 0,
  });
  const d = decideRound({
    cfg, nightId: "n", round: 1, parent, sigma: 0, rescore: null, hypotheses: [null, null, null],
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
    cfg, nightId: "n", round: 1, parent: { ...parent, score: 0.59 }, sigma: 0, rescore: null,
    hypotheses: [null], branches: [{ ok: true, expId: "x", branch: 0, model: "p/a", code: code("c"), eval: ev(0.6) }],
  });
  assert.equal(none.keep, null);

  // An already re-scored parent's run in the evaluator is a baseline row: recorded, its score unchanged.
  const withBaseline = decideRound({
    cfg, nightId: "n", round: 2, parent, sigma: 0, rescore: null, hypotheses: [null],
    baseline: { ok: true, evalId: "n-r2-baseline", result: ev(0.3) },
    branches: [{ ok: true, expId: "n-r2-b0", branch: 0, model: "p/a", code: code("d"), eval: ev(0.4) }],
  });
  assert.equal(withBaseline.parentAfter.score, 0.5);
  assert.deepEqual(withBaseline.rows.map((r) => [r.kind, r.evaluator_instance]), [["baseline", "i1"], ["experiment", "i1"]]);
  assert.equal(withBaseline.keep, null);
  for (const r of withBaseline.rows) assert.deepEqual(validateRow(r), []);
});

test("evaluation order rotates by round and keeps every candidate", () => {
  assert.deepEqual(rotate(["p", "a", "b", "c"], 1), ["a", "b", "c", "p"]);
  assert.deepEqual(rotate(["p", "a", "b", "c"], 4), ["p", "a", "b", "c"]);
  assert.deepEqual(rotate(["p", "a"], 3), ["a", "p"]);
  assert.deepEqual(rotate([], 2), []);
});

test("standard metrics: on by default, cost before latency, validated", () => {
  assert.deepEqual(cfg.standard_metrics, {
    latency: true, cost: true, latency_metric: "latency_total_s", cost_metric: "cost_per_item_usd", min_efficiency_gain: 0.1,
  });
  assert.deepEqual(efficiencyMetrics(cfg), ["cost_per_item_usd", "latency_total_s"]);
  const off = parseConfig(BASE_YAML + "standard_metrics: { latency: false, cost: false }\n", ROOT);
  assert.deepEqual(efficiencyMetrics(off), []);
  const lat = parseConfig(BASE_YAML + "standard_metrics: { cost: false, latency_metric: latency_query_p95_ms }\n", ROOT);
  assert.deepEqual(efficiencyMetrics(lat), ["latency_query_p95_ms"]);
  assert.throws(() => parseConfig(BASE_YAML + "standard_metrics: { latency_metric: p95_ms }\n", ROOT), /latency_metric/);
  assert.throws(() => parseConfig(BASE_YAML + "standard_metrics: { min_efficiency_gain: 0 }\n", ROOT), /min_efficiency_gain/);
  assert.throws(() => parseConfig(BASE_YAML + "standard_metrics: { cost: yes please }\n", ROOT), /true or false/);
});

test("efficiency: tie-break, efficiency keep and its guards", () => {
  const parent: Kept = { expId: "n-r1-b0", sha: "p", score: 0.9, metrics: null, metricsPath: null, rescored: true };
  const code = (sha: string) => ({
    ok: true, sha, hypothesis: `h-${sha}`, stop: "done" as const, coder_usd: 0.1, dev_usd: 0, tokens: 10,
    t_provision: 1, t_code: 2, t_teardown: 1, infra_errors: 0, resumed: false,
  });
  const ev = (accuracy: number, cost: number, lat: number, instance = "i1") => ({
    ok: true, metrics: { accuracy, schema_violations: 0, cost_per_item_usd: cost, latency_total_s: lat }, metricsPath: "/m.json",
    program_usd: 0, t_provision: 1, t_eval: 1, t_teardown: 1, wall_s: 3, infra_errors: 0, evaluator_instance: instance, eval_order: 0,
  });
  const branch = (b: number, e: ReturnType<typeof ev>) => ({ ok: true as const, expId: `n-r2-b${b}`, branch: b, model: "p/a", code: code(`s${b}`), eval: e });
  const round = (branches: ReturnType<typeof branch>[], over: Partial<Parameters<typeof decideRound>[0]> = {}) =>
    decideRound({
      cfg, nightId: "n", round: 2, parent, sigma: 0, effSigma: {}, bestPrimary: 0.9, rescore: null,
      baseline: { ok: true, evalId: "n-r2-baseline", result: ev(0.9, 0.01, 2.0) }, hypotheses: [null, null, null], branches, ...over,
    });

  // Tied on a primary gain: the clearly cheaper branch wins over the higher branch index order.
  const tie = round([branch(0, ev(0.95, 0.01, 2.0)), branch(1, ev(0.95, 0.005, 2.0))]);
  assert.deepEqual([tie.keep?.expId, tie.keep?.reason], ["n-r2-b1", "primary"]);
  // Within 10%: not meaningfully cheaper, so the first branch keeps it.
  assert.equal(round([branch(0, ev(0.95, 0.01, 2.0)), branch(1, ev(0.95, 0.0095, 2.0))]).keep?.expId, "n-r2-b0");

  // No primary gain: a branch at the same primary that is >10% faster is an efficiency keep.
  const eff = round([branch(0, ev(0.9, 0.01, 2.0)), branch(1, ev(0.9, 0.01, 1.5))]);
  assert.deepEqual([eff.keep?.expId, eff.keep?.reason], ["n-r2-b1", "efficiency"]);
  assert.equal(eff.rows.find((r) => r.exp_id === "n-r2-b1")?.keep_reason, "efficiency");
  assert.equal(eff.summaries.find((x) => x.expId === "n-r2-b1")?.decision, "keep (cheaper/faster)");
  assert.deepEqual(eff.parentRun?.latency_total_s, 2.0);
  // ...but not when the cut is within 2σ of latency noise.
  assert.equal(round([branch(1, ev(0.9, 0.01, 1.5))], { effSigma: { latency_total_s: 0.3 } }).keep, null);
  // ...not when it raises the other objective by as much,
  assert.equal(round([branch(1, ev(0.9, 0.02, 1.5))]).keep, null);
  // ...not below the night's best kept primary (drift guard),
  assert.equal(round([branch(1, ev(0.9, 0.01, 1.5))], { bestPrimary: 0.95 }).keep, null);
  // ...not on latency measured by another evaluator instance (cost still compares across instances),
  assert.equal(round([branch(1, ev(0.9, 0.01, 1.5, "i2"))]).keep, null);
  assert.equal(round([branch(1, ev(0.9, 0.005, 2.0, "i2"))]).keep?.reason, "efficiency");
  // ...and not when the standard metrics are not optimized.
  const off = parseConfig(BASE_YAML + "standard_metrics: { latency: false, cost: false }\n", ROOT);
  assert.equal(round([branch(1, ev(0.9, 0.005, 1.0))], { cfg: off }).keep, null);
  // A primary drop is never an efficiency keep, however fast.
  assert.equal(round([branch(1, ev(0.89, 0.001, 0.1))]).keep, null);
  for (const r of eff.rows) assert.deepEqual(validateRow(r), []);
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

test("coder prompt names the dev endpoint only when the program may call models", () => {
  const dev = coderPrompt("spec", "", null, 10, undefined, { models: ["openrouter/x/y"], budgetUsd: 0.05 });
  assert.match(dev, /OPENAI_BASE_URL/);
  assert.match(dev, /openrouter\/x\/y/);
  assert.match(dev, /\$0\.05/);
  assert.doesNotMatch(coderPrompt("spec", "", null, 10), /OPENAI_BASE_URL/);
});

test("config paths travel relative and resolve against the worker's checkout", () => {
  const sent = relativeConfig(cfg);
  assert.equal(sent.base_dir, ".");
  assert.equal(sent.scenario_dir, "scenarios/capitals");
  assert.ok(!sent.results_path.startsWith("/"));
  const used = rootConfig(sent, "/srv/codeclimb");
  assert.equal(used.base_dir, "/srv/codeclimb");
  assert.equal(used.results_path, cfg.results_path.replace(ROOT, "/srv/codeclimb"));
  assert.equal(used.scenario_dir, "/srv/codeclimb/scenarios/capitals");
  // Configs from older CLIs carry absolute paths, which stay as they are.
  assert.deepEqual(rootConfig(cfg, "/srv/codeclimb"), cfg);
});
