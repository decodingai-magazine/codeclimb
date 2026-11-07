import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { coderPrompt, notesDir, openTasks, parseApproach, readNotes, rejectedDiffs, sendBack, trainScoreProblem, unmet, CODER_REVIEW, WORKFLOW } from "./coder";
import { checkSandboxLimits, efficiencyMetrics, mockConfig, type NightConfig, parseConfig, relativeConfig, resolveDeadline, rootConfig } from "./config";
import { ExperimentRepo } from "./git";
import { nightPaths } from "./paths";
import { emptyStageError, prepareEnvironment } from "./evaluate";
import type { Sandbox } from "./sandbox/types";
import { coderReply, reviewerReply } from "./pi/mock";
import { checkStop, decideRound, diffLeaks, type ExperimentOutcome, historyLine, type Kept, noteOutcome, recordNoise, repairable, saveRejected, spreadDetails, writeNote } from "./orchestrator";
import { validateRow } from "./results";
import { parseReview, reviewerPrompt, runReview } from "./reviewer";
import { flattenReport, lastLines, maskTerms, parseScenario, readProtocol } from "./scenario";
import { emptyStages, passesGates, passesThresholds, weightedScore } from "./stats";

// Config paths resolve against the repo root, where the real capitals scenario lives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_YAML = `
scenario: scenarios/capitals
sandbox: docker
max_rounds: 2
deadline: 90m
timeouts: { experiment_min: 10, eval_min: 3 }
model: p/a
reviewer_model: p/c
primary_metric: accuracy
thresholds: { accuracy: 0.9 }
gates: { schema_violations: 0 }
budget_usd: { experiment: 1, night: 5 }
results_path: runs/r.jsonl
`;
const cfg = parseConfig(BASE_YAML, ROOT);

test("weighted score: each threshold metric's share of its threshold, capped at 1, weighted", () => {
  const thresholds = { a: 0.8, b: 0.5 };
  assert.equal(weightedScore(null, thresholds), 0);
  assert.equal(weightedScore({ a: 0.4, b: 0.25 }, thresholds), 0.5);
  assert.equal(weightedScore({ a: 0.9, b: 0.25 }, thresholds), 0.75); // past its threshold, a counts 1
  assert.equal(weightedScore({ a: 0.8 }, thresholds), 0.5); // a missing metric counts 0
  assert.equal(weightedScore({ a: 0.8, b: 0 }, thresholds, { a: 3 }), 0.75);
  assert.equal(weightedScore({ a: 1 }, {}), 0);
});

test("scenario: headline, sandboxes, protocol, flattened reports", () => {
  const base = "name: s\nimage: i\nbundle: b\nstages:\n  - { name: a, inputs: i, run: r, score: s, details: d }\n";
  assert.equal(parseScenario(`${base}check: c --repo {repo}\n`).check, "c --repo {repo}");
  assert.equal(parseScenario(base).check, undefined);
  assert.deepEqual(parseScenario(`${base}diagnostics: ["^a$"]\n`).diagnostics, ["^a$"]);
  assert.throws(() => parseScenario(`${base}diagnostics: ["("]\n`), /Invalid regular expression/);
  const s = parseScenario(`${base}headline: [a.mean, b]\nprotocol: [x.md]\n`);
  assert.deepEqual([s.headline, s.protocol, s.stages[0].details], [["a.mean", "b"], ["x.md"], "d"]);
  assert.deepEqual(parseScenario(base).headline, []);
  assert.throws(() => parseScenario(`${base}headline: { a: 0.1 }\n`), /headline must list metric names/);
  assert.throws(() => parseScenario(`${base}override_limit: 0.005\n`), /override_limit is gone/);
  assert.deepEqual(
    flattenReport({ a: { mean: 0.5, ci95: [0.4, 0.8], n: 3 }, details: { x: 1 }, per_item: { y: 1 }, skip: null }, "st"),
    { "st.a.mean": 0.5, "st.a.ci95_half": (0.8 - 0.4) / 2, "st.a.n": 3 },
  );
  const scoring = readProtocol(join(ROOT, "scenarios/graphrag"), ["README.md#Scoring"]);
  assert.match(scoring, /^## Scoring\n/);
  assert.doesNotMatch(scoring, /\n## /);
  assert.throws(() => readProtocol(join(ROOT, "scenarios/graphrag"), ["README.md#Nope"]), /Nope/);
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
  assert.deepEqual(cfg.weights, {});
  assert.deepEqual(parseConfig(`${BASE_YAML}weights: { accuracy: 2 }\n`, ROOT).weights, { accuracy: 2 });
  assert.throws(() => parseConfig(`${BASE_YAML}weights: { nope: 2 }\n`, ROOT), /weights\.nope names no threshold/);
  assert.throws(() => parseConfig(`${BASE_YAML}weights: { accuracy: 0 }\n`, ROOT), /weights\.accuracy must be/);
  assert.throws(() => parseConfig(BASE_YAML.replace("{ accuracy: 0.9 }", "{}"), ROOT), /at least one metric/);
  assert.throws(() => parseConfig(BASE_YAML.replace("{ accuracy: 0.9 }", "{ accuracy: 0 }"), ROOT), /thresholds\.accuracy must be/);
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

const parentAt = (score: number, metrics: Record<string, number> | null): Kept => ({ expId: "n-r0", sha: "p", score, metrics });
const coded = (sha: string) => ({
  ok: true, sha, hypothesis: `h-${sha}`, stop: "done" as const, coder_usd: 0.1, dev_usd: 0, tokens: 10, t_provision: 1, t_code: 2, t_teardown: 1, infra_errors: 0, resumed: false,
});
const evaluated = (metrics: Record<string, number>) => ({
  ok: true, metrics: { schema_violations: 0, ...metrics }, metricsPath: "/m.json", program_usd: 0, t_provision: 1, t_eval: 1, t_teardown: 1, wall_s: 3, infra_errors: 0, evaluator_instance: "i1",
});
const run = (metrics: Record<string, number>): ExperimentOutcome => ({ ok: true, expId: "n-r1-e0", model: "p/a", code: coded("a"), eval: evaluated(metrics) });
const round = (parent: Kept, experiment: ExperimentOutcome, c = cfg, margin = 0) => decideRound({ cfg: c, nightId: "n", round: 1, parent, experiment, hypothesis: null, margin });

test("one experiment per round: kept when its weighted score beats the checkpoint's, else reverted", () => {
  const parent = parentAt(0.5, { accuracy: 0.5 });
  const d = round(parent, run({ accuracy: 0.6 }));
  assert.deepEqual([d.keep?.expId, d.keep?.sha, d.row.decision, d.row.parent_id], ["n-r1-e0", "a", "keep", "n-r0"]);
  assert.ok(Math.abs(d.row.score! - 0.6 / 0.9) < 1e-12);
  assert.equal(d.summary.reason, "weighted score 0.6667 > checkpoint 0.5556");
  assert.deepEqual(validateRow(d.row), []);

  const level = round(parent, run({ accuracy: 0.5 }));
  assert.deepEqual([level.keep, level.row.decision, level.row.decision_reason], [null, "revert", "weighted score 0.5556 <= checkpoint 0.5556"]);

  const gated = round(parent, run({ accuracy: 0.9, schema_violations: 2 }));
  assert.deepEqual([gated.keep, gated.row.decision], [null, "revert"]);
  assert.match(gated.summary.guardrails[0], /a gate failed: schema_violations=2 \(cap 0\)/);

  const failed = round(parent, { ok: false, expId: "n-r1-e0", model: "p/a", error: "boom" });
  assert.deepEqual([failed.row.decision, failed.row.infra_errors, failed.keep], ["error", 1, null]);
  assert.deepEqual(validateRow(failed.row), []);

  const long = `${"cmd ".repeat(200)}Traceback: boom`;
  const crashed = round(parent, { ok: true, expId: "n-r1-e0", model: "p/a", code: coded("c"), eval: { ...evaluated({ accuracy: 0 }), ok: false, error: long } });
  assert.deepEqual([crashed.row.decision, crashed.summary.errors, crashed.row.score], ["error", [long], undefined]);

  const leak = round(parent, { ok: true, expId: "n-r1-e0", model: "p/a", code: { ...coded("e"), check: { errors: ["leak"], notes: ["named"] } }, eval: null });
  assert.deepEqual([leak.row.decision, leak.summary.errors, leak.summary.notes, leak.row.infra_errors], ["error", ["leak"], ["named"], 0]);
});

test("a gain inside the noise margin reverts", () => {
  const parent = parentAt(0.5, { accuracy: 0.5 });
  assert.equal(round(parent, run({ accuracy: 0.52 }), cfg, 0.05).keep, null);
  const past = round(parent, run({ accuracy: 0.6 }), cfg, 0.05);
  assert.equal(past.keep?.expId, "n-r1-e0");
  assert.match(past.summary.reason, /\+ noise margin 0\.0500$/);
});

test("the score caps a metric at its threshold, so a loss elsewhere costs", () => {
  const two = { ...cfg, thresholds: { accuracy: 0.9, recall: 0.5 } };
  const parent = parentAt(0.95, { accuracy: 0.95, recall: 0.3 });
  assert.equal(round(parent, run({ accuracy: 1, recall: 0.3 }), two).keep, null); // past its threshold: no gain
  assert.equal(round(parent, run({ accuracy: 0.85, recall: 0.5 }), two).keep?.expId, "n-r1-e0");
  assert.equal(round(parent, run({ accuracy: 0.6, recall: 0.4 }), two).keep, null);
  assert.equal(round(parent, run({ accuracy: 0.85, recall: 0.32 }), { ...two, weights: { accuracy: 4 } }).keep, null);
});

test("held-out names in the diff: two block a keep, one is a note", () => {
  const parent = parentAt(0.5, { accuracy: 0.5 });
  const leaky = (leaks: string[]) => round(parent, { ok: true, expId: "n-r1-e0", model: "p/a", code: { ...coded("a"), leaks }, eval: evaluated({ accuracy: 0.9 }) });
  const two = leaky(["Gold Name", "Other Name"]);
  assert.equal(two.keep, null);
  assert.deepEqual(two.summary.guardrails, [`the diff's added lines name 2 held-out evaluation items`]);
  assert.doesNotMatch(JSON.stringify(two.row), /Gold Name/);
  const one = leaky(["Gold Name"]);
  assert.equal(one.keep?.expId, "n-r1-e0");
  assert.deepEqual(one.summary.notes, ["the diff's added lines name 1 held-out item"]);
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

const REVIEW = {
  model: "m", mock: true, thinkingLevel: "low" as const, spec: "s", round: 3, primaryMetric: "e.f1", thresholds: {}, weights: {}, gates: {}, parentScore: 0.7,
  parentMetrics: { "e.f1": 0.7, "r.x.mean": 0.5, "r.x.ci95_half": 0.1 } as Record<string, number> | null,
  objectives: [], minEfficiencyGain: 0.1, log: [], headline: ["e.f1", "r.x.mean", "gone"], diagnostics: ["^e\\.(precision|recall)$"], protocol: "", parentSource: "",
  result: {
    expId: "b", model: "m", hypothesis: "h", decision: "revert", primary: 0, metrics: { "e.f1": 0.7 } as Record<string, number>, guardrails: [] as string[], notes: [], diff: "", details: "",
    score: 0.5, parentScore: 0.6, margin: 0, reason: "weighted score 0.5000 <= checkpoint 0.6000",
  },
};

test("the reviewer reads the experiment against the checkpoint's stored scores", () => {
  const input = REVIEW;
  const withMetrics = (metrics: Record<string, number>) => ({ ...input, result: { ...input.result, metrics } });
  const prompt = reviewerPrompt(withMetrics({ "e.f1": 0.75, "r.x.mean": 0.4, gone: 1 }));
  assert.match(prompt, /Change from the kept commit: e\.f1 \+0\.0500, r\.x\.mean -0\.1000 \(ci95 ±0\.1000\)/);
  assert.match(prompt, /scores from its own evaluation/);
  assert.match(prompt, /Headline metrics: e\.f1, r\.x\.mean, gone\./);
  assert.match(reviewerPrompt(input), /Change from the kept commit: (none|r\.x)/);
  assert.doesNotMatch(reviewerPrompt({ ...input, headline: [] }), /Headline metrics/);
  // The loop decided; the reviewer reads why and decides nothing.
  assert.match(reviewerPrompt(input), /The loop's decision: revert \(weighted score 0\.5000 <= checkpoint 0\.6000\)\./);
  assert.doesNotMatch(reviewerPrompt(input), /"keep"/);
  assert.match(reviewerPrompt({ ...input, thresholds: { "e.f1": 0.8, "r.x.mean": 0.5 }, weights: { "e.f1": 2 } }), /Weights in the score: \{"e\.f1":2,"r\.x\.mean":1\}/);
  const replayed = reviewerPrompt({ ...input, result: { ...input.result, metrics: { ...input.result.metrics, model_calls: 10, model_calls_replayed: 7 } } });
  assert.match(replayed, /Model calls: 7 of 10 were replayed/);
  assert.doesNotMatch(reviewerPrompt(input), /were replayed/);
  assert.match(reviewerPrompt({ ...input, direction: "work on retrieval" }), /direction for every round:\nwork on retrieval/);

  // Diagnostics sit under the metrics and skip the cells nobody listed.
  const diagnosed = reviewerPrompt(withMetrics({ "e.f1": 0.7, "e.precision": 0.6, "e.recall": 0.9, "e.tp": 5 }));
  assert.match(diagnosed, /metrics: e\.f1=0\.7000\nDiagnostics: e\.precision=0\.6000, e\.recall=0\.9000\n/);
  assert.doesNotMatch(diagnosed, /e\.tp/);

  // With headline metrics nothing frames the round as one number.
  const framed = (headline: string[]) => reviewerPrompt({ ...input, headline, result: { ...input.result, metrics: { "e.f1": 0.7 }, primary: 0.7 } });
  for (const framing of [/Primary metric/, /e\.f1=0\.7000; metrics/]) {
    assert.doesNotMatch(framed(["e.f1"]), framing);
    assert.match(framed([]), framing);
  }

  // The log says what moved and why it went, and that reverted code is gone.
  const entry = { round: 1, hypothesis: "h1", deltaPrimary: -0.1, decision: "revert", reason: "r.x fell" };
  const logged = reviewerPrompt({ ...input, log: [{ ...entry, deltaScore: -0.02, deltas: { "e.f1": -0.1, "r.x.mean": 0.2, "gone": 0 } }] });
  assert.match(logged, /- r1: h1 → Δscore=-0\.0200, Δe\.f1=-0\.1000, Δr\.x\.mean=\+0\.2000 \(revert: r\.x fell\)/);
  assert.match(logged, /survives only as a read-only diff at \/spec\/history/);
  assert.match(reviewerPrompt({ ...input, headline: [], log: [entry] }), /- r1: h1 → Δe\.f1=-0\.1000 \(revert/);
  assert.match(reviewerPrompt({ ...input, log: [entry] }), /- r1: h1 → no metric moved/);

  assert.match(reviewerPrompt({ ...input, parentSource: "### a.py" }), /## Kept commit source\n.*\n### a\.py/);
});

test("a commit's uv environment: built in the repo, and a failure says why", async () => {
  const seen: { cmd: string; env?: unknown; cwd?: string }[] = [];
  const sandbox = (exitCode: number, timedOut = false) =>
    ({ exec: async (cmd: string, o: { env?: unknown; cwd?: string }) => (seen.push({ cmd, env: o.env, cwd: o.cwd }), { exitCode, stdout: "", stderr: "lockfile needs to be updated", timedOut }) }) as unknown as Sandbox;
  assert.equal(await prepareEnvironment(sandbox(0)), null);
  assert.equal(seen[0].cwd, "/repo");
  assert.equal(seen[0].env, undefined); // a package's setup never sees the metered token
  assert.match((await prepareEnvironment(sandbox(1)))!, /uv exited 1: lockfile needs to be updated/);
  assert.match((await prepareEnvironment(sandbox(-1, true)))!, /timed out after 3 min/);
});

test("over the cap every detail item keeps a share", () => {
  const details = { a: "x".repeat(1000), b: "y".repeat(1000), c: "z" };
  assert.equal(spreadDetails({ a: 1 }, 100), '{"a":1}');
  const spread = spreadDetails(details, 300);
  assert.match(spread, /^a: "x{147}\nb: "y{147}\nc: "z"$/); // the short item's unused share goes to the long ones
});

test("the coders read a failed evaluation's error unedited", () => {
  const error = "cmd failed: row 3: extra field `doc_uri`\nTraceback";
  const prompt = coderPrompt("s", "", null, 10, undefined, undefined, undefined, [{ expId: "n-r1-e1", errors: [error] }]);
  assert.ok(prompt.includes(`- n-r1-e1: ${error}`));
  assert.doesNotMatch(coderPrompt("s", "", null, 10), /<failures>/);
  // A repair skips research and planning; every attempt reviews its work before the evaluator gets it.
  assert.ok(coderPrompt("s", "", null, 10).includes(`${WORKFLOW}\n4. Review. ${CODER_REVIEW}`));
  const repair = coderPrompt("s", "", null, 10, undefined, undefined, undefined, [{ expId: "n-r1-e1", errors: [error] }], [], [], true);
  assert.ok(!repair.includes("1. Research.") && repair.includes(`Before you stop, review:\n${CODER_REVIEW}`));
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
  assert.deepEqual(parseReview('noise {"feedback": "f", "hypothesis": " a "} trailing'), { feedback: "f", hypothesis: "a", verdict: "" });
  assert.equal(parseReview('{"feedback": "f"}'), null); // no hypothesis
  assert.equal(parseReview('{"feedback": "f", "hypothesis": " "}'), null);
});

test("coder prompt names the dev endpoint only when the program may call models", () => {
  const dev = coderPrompt("spec", "", null, 10, undefined, { models: ["openrouter/x/y"], budgetUsd: 0.05 });
  assert.match(dev, /OPENAI_BASE_URL/);
  assert.match(dev, /openrouter\/x\/y/);
  assert.match(dev, /\$0\.05/);
  assert.match(coderPrompt("spec", "", null, 10, undefined, { models: ["m"], budgetUsd: 1, evalBudgetUsd: 2 }), /own cap of \$2 for one run of every stage/);
  assert.doesNotMatch(coderPrompt("spec", "", null, 10), /OPENAI_BASE_URL/);
  assert.match(coderPrompt("spec", "", null, 10, undefined, undefined, 16), /each run of the program 16 minutes/);
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

const textOf = (m: ReturnType<typeof coderReply>) => m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");

test("the mock coder makes one change, then closes with its approach", () => {
  const first = coderReply([{ role: "user", content: "go", timestamp: 0 }]);
  assert.equal(first.stopReason, "toolUse");
  assert.deepEqual(first.content.map((c) => c.type), ["toolCall"]);
  const toolResult = { role: "toolResult" as const, toolCallId: "1", toolName: "bash", content: [], isError: false, timestamp: 0 };
  const last = coderReply([toolResult]);
  assert.equal(parseApproach(textOf(last)), "mock change, no real work");
});

test("the mock reviewer's answer parses", () => {
  assert.equal(parseReview(textOf(reviewerReply()))?.hypothesis, "mock hypothesis");
});

test("a mock config writes results apart from the real ones", () => {
  const cfg = { results_path: "/x/runs/capitals-smoke/results.jsonl" } as NightConfig;
  const mock = mockConfig(cfg);
  assert.equal(mock.mock, true);
  assert.equal(mock.results_path, "/x/runs/mock/capitals-smoke/results.jsonl");
});

test("a reviewer may share the coder's model only at another thinking level", () => {
  const yaml = (extra: string) => BASE_YAML.replace("reviewer_model: p/c", "reviewer_model: p/a") + extra;
  assert.throws(() => parseConfig(yaml("coder_thinking: high\nreviewer_thinking: high\n"), ROOT), /reviewer_model must differ/);
  assert.throws(() => parseConfig(yaml(""), ROOT), /reviewer_model must differ/);
  const cfg = parseConfig(yaml("coder_thinking: medium\nreviewer_thinking: high\n"), ROOT);
  assert.equal(cfg.reviewer_thinking, "high");
  assert.throws(() => parseConfig(yaml("coder_thinking: extreme\nreviewer_thinking: high\n"), ROOT), /coder_thinking must be/);
});

test("against the empty starter any experiment that worked and scored is kept", () => {
  const starter = parentAt(0, null);
  assert.equal(round(starter, run({ accuracy: 0.3, "g.output_bytes": 9 })).keep?.expId, "n-r1-e0");
  assert.equal(round(starter, run({ accuracy: 0, "g.output_bytes": 9 })).keep, null); // 0 doesn't beat 0
  const empty = round(starter, run({ accuracy: 0.9, "g.output_bytes": 0 }));
  assert.deepEqual([empty.keep, empty.summary.guardrails], [null, ["g wrote no output"]]);
  assert.deepEqual(emptyStages({ output_bytes: 0, "e.output_bytes": 4, accuracy: 0 }), ["the run wrote no output"]);

  const input = { ...REVIEW, parentMetrics: null, headline: ["accuracy"] };
  const entry = { round: 1, hypothesis: "h1", deltaPrimary: 0.5, decision: "revert" };
  const prompt = reviewerPrompt({ ...input, log: [{ ...entry, scores: { accuracy: 0.5 } }, { ...entry, hypothesis: "h2", scores: {} }] });
  assert.match(prompt, /is the empty starter and wasn't run/);
  assert.doesNotMatch(prompt, /scores from its own evaluation|Change from the kept commit/);
  assert.match(prompt, /- r1: h1 → accuracy=0\.5000 /);
  assert.match(prompt, /- r1: h2 → not scored /);
});

test("what the reviewer names of the held-out data never reaches a coder: one rewrite, then masked", async () => {
  const scanned: string[] = [];
  const review = await runReview(REVIEW, async (text) => {
    scanned.push(text);
    return ["MOCK"];
  });
  assert.equal(scanned.length, 2); // the reply, then the rewrite
  assert.equal(review.feedback, "[hidden] feedback");
  assert.equal(review.hypothesis, "[hidden] hypothesis");
  assert.equal((await runReview(REVIEW)).feedback, "mock feedback");
  assert.equal(maskTerms("see Foo Bar? and foo bar. a$b", ["foo", "foo bar", "a$b"]), "see [hidden]? and [hidden]. [hidden]");
});

/** A config whose scan finds `Gold Name`, with its experiments under a fresh directory. */
function scanning() {
  const dir = mkdtempSync(join(tmpdir(), "cc-history-"));
  const scan = `printf '{"found":["Gold Name"]}' > {report}`;
  return { dir, cfg: { ...cfg, results_path: join(dir, "r.jsonl"), scenario: { ...cfg.scenario, scan } } };
}

test("a later coder reads every earlier round, with held-out names masked", async () => {
  const { dir, cfg: masked } = scanning();
  try {
    const lines = [
      await historyLine(masked, { round: 1, hypothesis: "h1", deltaPrimary: 0.1, decision: "keep", reason: "better" }),
      await historyLine(masked, { round: 2, hypothesis: "h2", deltaPrimary: -0.2, deltas: { accuracy: -0.2 }, decision: "revert", reason: "lost gold name again" }),
    ];
    const prompt = coderPrompt("spec", "fb", "hyp", 10, undefined, undefined, undefined, [], lines, ["/spec/history/r2.diff"]);
    assert.match(prompt, /<history>[^]*- r1: h1[^]*keep: better[^]*- r2: h2[^]*revert: lost \[hidden\] again[^]*\/spec\/history\/r2\.diff[^]*<\/history>/);
    assert.doesNotMatch(prompt, /gold name/i);
    assert.doesNotMatch(coderPrompt("spec", "", null, 10), /<history>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rejected diff is masked, capped and listed for later coders", async () => {
  const { dir, cfg: masked } = scanning();
  try {
    const paths = nightPaths(masked, "n");
    const repo = new ExperimentRepo(paths.gitDir);
    await repo.ensure();
    const code = join(dir, "code");
    mkdirSync(code);
    writeFileSync(join(code, "a.py"), "x = 1\n");
    await repo.importDir(code, "parent");
    writeFileSync(join(code, "a.py"), `x = "Gold Name"\ny = "${"z".repeat(50_000)}"\n`);
    await repo.importDir(code, "exp");
    assert.deepEqual(rejectedDiffs(paths.bundleDir), []);
    await saveRejected(masked, "n", 2, "parent", "exp");
    await saveRejected(masked, "n", 10, "parent", "exp");
    assert.deepEqual(rejectedDiffs(paths.bundleDir), ["/spec/history/r2.diff", "/spec/history/r10.diff"]);
    const diff = readFileSync(join(paths.bundleDir, "history", "r2.diff"), "utf8");
    assert.match(diff, /\[hidden\]/);
    assert.doesNotMatch(diff, /gold name/i);
    assert.match(diff, /\[diff cut, \d+ chars\]$/);
    assert.ok(diff.length < 41_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no code change: nothing evaluated, the parent's scores, no infra error, the coder's report read", () => {
  const parent = parentAt(0.5, { accuracy: 0.5 });
  const code = { ...coded("c"), unchanged: "Second pass didn't help on train, reverted it." };
  const d = round(parent, { ok: true, expId: "n-r1-e0", model: "p/a", code, eval: null });
  assert.deepEqual([d.row.decision, d.row.unchanged, d.row.infra_errors, d.row.metrics], ["revert", true, 0, { accuracy: 0.5 }]);
  assert.deepEqual([d.keep, d.summary.primary, d.summary.guardrails, d.summary.errors, d.summary.reason], [null, 0.5, [], undefined, "no code change"]);
  assert.deepEqual(validateRow(d.row), []);
  assert.equal(round(parentAt(0, null), { ok: true, expId: "n-r1-e0", model: "p/a", code, eval: null }).row.decision, "revert");
  const prompt = reviewerPrompt({ ...REVIEW, result: { ...REVIEW.result, unchanged: code.unchanged } });
  assert.match(prompt, /committed no change[^]*Second pass didn't help/);
  assert.doesNotMatch(reviewerPrompt(REVIEW), /committed no change/);
});

test("sameTree: an empty commit holds the parent's files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-tree-"));
  try {
    const repo = new ExperimentRepo(join(dir, "x.git"));
    await repo.ensure();
    const code = join(dir, "code");
    mkdirSync(code);
    writeFileSync(join(code, "a.py"), "x = 1\n");
    await repo.importDir(code, "a");
    await repo.importDir(code, "same");
    writeFileSync(join(code, "a.py"), "x = 2\n");
    await repo.importDir(code, "other");
    assert.equal(await repo.sameTree("a", "same"), true);
    assert.equal(await repo.sameTree("a", "other"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repair: a commit that failed before scoring, not a scored, empty or uncommitted one", () => {
  const at = (code: ExperimentOutcome & { ok: true }) => repairable(code);
  const x = { ok: true as const, expId: "e", model: "m" };
  const evalWith = (over: object) => ({ ...evaluated({ accuracy: 0.5 }), ...over });
  assert.equal(at({ ...x, code: coded("a"), eval: evalWith({ ok: false, error: "stage a: run exited 1" }) }), true);
  assert.equal(at({ ...x, code: { ...coded("a"), check: { errors: ["leak"], notes: [] } }, eval: null }), true);
  assert.equal(at({ ...x, code: coded("a"), eval: evaluated({ accuracy: 0.5 }) }), false);
  assert.equal(at({ ...x, code: coded("a"), eval: null }), false); // the evaluator itself failed: nothing to fix in the code
  assert.equal(at({ ...x, code: coded("a"), eval: evalWith({ ok: false, credits: { model: "m", message: "out" } }) }), false);
  assert.equal(at({ ...x, code: { ...coded("a"), sha: null }, eval: null }), false);
  assert.equal(at({ ...x, code: { ...coded("a"), unchanged: "gave up" }, eval: null }), false);
  assert.equal(repairable({ ok: false, expId: "e", model: "m", error: "lost" }), false);
});

test("repair: the coder is told its commit is in /repo and to fix only this", () => {
  const failures = [{ expId: "e", errors: ["stage a: run exited 1"] }];
  const fix = coderPrompt("spec", "", "h", 10, undefined, undefined, undefined, failures, [], [], true);
  assert.match(fix, /now in \/repo[^]*no second repair[^]*run exited 1/);
  assert.match(coderPrompt("spec", "", "h", 10, undefined, undefined, undefined, failures), /Its code is gone/);
});

test("fail fast: an empty dev stage stops with its log; test runs on", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-empty-"));
  try {
    assert.match(emptyStageError("a", "dev", dir, `${"x".repeat(3000)}\nboom`) ?? "", /^stage a: the run exited clean but wrote no output.*boom$/);
    assert.ok((emptyStageError("a", "dev", dir, "x".repeat(3000)) ?? "").length < 2200);
    assert.equal(emptyStageError("a", "test", dir, ""), null);
    writeFileSync(join(dir, "timings.jsonl"), "{}\n");
    assert.notEqual(emptyStageError("a", "dev", dir, ""), null); // timings aren't output
    writeFileSync(join(dir, "out.jsonl"), "{}\n");
    assert.equal(emptyStageError("a", "dev", dir, ""), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the prompts carry the simplicity, output and near-miss rules", () => {
  const coder = coderPrompt("spec", "", null, 10);
  assert.match(coder, /Simpler is better/);
  assert.match(coder, /to a file and read it with grep or tail/);
  assert.doesNotMatch(coder, /<failures>/);
});

test("a cut never leaves half a held-out name for a coder", async () => {
  const log = `one https://held.out/secret-article attempt\ntwo\nthree`;
  assert.equal(lastLines(log, 1000), log);
  assert.equal(lastLines(log, 12), "two\nthree");
  assert.equal(lastLines("x".repeat(50), 10), "");

  const { dir, cfg: masked } = scanning();
  try {
    const error = `failed on Gold Name${" ".repeat(292)}end`; // the name straddles the last 300 characters
    const line = await historyLine(masked, { round: 1, hypothesis: "h", deltaPrimary: 0, decision: "error", reason: error });
    assert.doesNotMatch(line, /Name|Gold/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a coder's task list: every task done, or dropped with a note", () => {
  assert.equal(openTasks('[{"task": "a", "status": "done"}, {"task": "b", "status": "dropped", "note": "no gain"}]'), "");
  assert.match(openTasks(null), /wrote no \/tmp\/tasks\.json/);
  assert.match(openTasks("not json"), /not valid JSON/);
  assert.match(openTasks('{"task": "a"}'), /not a JSON list/);
  const open = openTasks('[{"task": "a", "status": "todo"}, {"task": "b", "status": "dropped"}, {"task": "c", "status": "done"}]');
  assert.match(open, /"a"; "b"/);
  assert.doesNotMatch(open, /"c"/);
  // The plan is JSON, and only its status and note change.
  assert.match(WORKFLOW, /\/tmp\/tasks\.json[^]*"status": "todo"[^]*Change only a task's status/);
});

test("a coder that stops too soon goes back once: open tasks, no train measurement, most of its time and budget left", () => {
  const done = '[{"task": "a", "status": "done"}]';
  const score = '{"before": {"f1": 0.5}, "after": {"f1": 0.6}, "command": "x"}';
  const base = { tasks: done, trainScore: score, hasTrain: true, minutesLeft: 5, minutes: 25, usdLeft: 2, usd: 2.5 };
  assert.equal(sendBack(base), "");
  assert.match(sendBack({ ...base, trainScore: null }), /wrote no \/tmp\/train-score\.json/);
  assert.equal(sendBack({ ...base, trainScore: null, hasTrain: false }), "");
  assert.match(sendBack({ ...base, trainScore: '{"before": {}, "after": {"f1": 1}}' }), /needs a "before" and an "after"/);
  assert.match(sendBack({ ...base, minutesLeft: 20 }), /20 of 25 minutes and \$2\.00 of \$2\.50 left/);
  assert.equal(sendBack({ ...base, minutesLeft: 20, usdLeft: 1 }), ""); // half the budget spent: it worked
  assert.match(sendBack({ ...base, tasks: '[{"task": "a", "status": "todo"}]' }), /not done/);
  assert.match(trainScoreProblem("nope"), /not valid JSON/);
});

test("one attempt aims at every threshold metric still short, largest weighted shortfall first", () => {
  const thresholds = { a: 0.9, b: 0.4, c: 0.5 };
  assert.deepEqual(unmet(thresholds, { a: 0.72, b: 0.3, c: 0.6 }, { b: 2 }), ["b: 0.300, threshold 0.4 (weight 2)", "a: 0.720, threshold 0.9"]);
  assert.equal(unmet(thresholds).length, 3); // the starter: nothing scored, all unmet
  const objectives = { primary: "a", metrics: [], thresholds, standing: { a: 0.72, b: 0.3, c: 0.6 } };
  const prompt = coderPrompt("s", "", "fix b", 10, objectives);
  assert.match(prompt, /<targets>\n[^]*- b: 0\.300[^]*- a: 0\.720[^]*Raise all of them[^]*at least one task per metric[^]*<\/targets>/);
  assert.doesNotMatch(prompt.match(/<targets>[^]*<\/targets>/)![0], /- c:/);
  assert.match(prompt, /<hypothesis>\nTest this hypothesis in this attempt, within the targets above[^]*fix b/);
  assert.doesNotMatch(coderPrompt("s", "", "fix b", 10, { ...objectives, standing: { a: 1, b: 1, c: 1 } }), /<targets>/);
  assert.doesNotMatch(coderPrompt("s", "", null, 10, objectives, undefined, undefined, [{ expId: "e", errors: ["x"] }], [], [], true), /<targets>/); // a repair fixes its failure only
});

test("the coder hears the score that decides a keep, and that cost and latency don't count", () => {
  const objectives = { primary: "a", metrics: ["latency_total_s"], thresholds: { a: 0.8, b: 0.5 }, weights: { b: 2 } };
  const prompt = coderPrompt("s", "", null, 10, objectives);
  assert.match(prompt, /weighted score on the hidden dev split[^\n]*a 0\.8, b 0\.5 \(weight 2\)/);
  assert.match(prompt, /latency_total_s\), lower is better, for the report: they don't count toward the keep/);
  assert.match(coderPrompt("s", "", null, 10), /First run the program in \/repo on two or three train items/);
});

test("each experiment leaves one note, coder and verdict, newest first, masked, shrunk to the budget", async () => {
  const { dir, cfg: masked } = scanning();
  try {
    const { bundleDir } = nightPaths(masked, "n");
    assert.equal(readNotes(bundleDir), "");
    await writeNote(masked, "n", "n-r1-e0", { outcome: noteOutcome("keep", "score up"), coder: "rerank 503s above 8 calls at once", reviewer: "the rerank raised recall" });
    await writeNote(masked, "n", "n-r2-e0", { outcome: noteOutcome("revert", ""), coder: "ladybug needs a fresh db per run; Gold Name" });
    await writeNote(masked, "n", "n-r2-e0", { outcome: "revert", coder: "a replayed step writes the same file" });
    await writeNote(masked, "n", "n-r10-e0", { outcome: "error: check failed", reviewer: "Gold Name broke the parser" });
    const notes = readNotes(bundleDir);
    assert.match(notes, /^## r10-e0 · error: check failed\n### Reviewer, after the evaluation\n\[hidden\] broke the parser\n\n## r2-e0 · revert\n### Coder, before the evaluation\na replayed step[^]*\n\n## r1-e0 · keep: score up\n### Coder[^]*rerank 503s[^]*### Reviewer[^]*recall$/);
    assert.doesNotMatch(notes, /Gold/);
    assert.equal(readdirSync(notesDir(bundleDir)).length, 3);
    assert.equal(rejectedDiffs(bundleDir).length, 0); // the notes are no rejected diff
    assert.match(coderPrompt("s", "", null, 10, undefined, undefined, undefined, [], [], [], false, "", notes), /<notes>[^]*\/spec\/history\/notes\/[^]*rerank 503s[^]*<\/notes>/);
    assert.doesNotMatch(coderPrompt("s", "", null, 10), /<notes>/);
    // Past the budget: the newest stay whole, then the coder part goes, then all but the heading.
    for (let i = 3; i < 10; i += 1) await writeNote(masked, "n", `n-r${i}-e0`, { outcome: "revert", coder: "c".repeat(400), reviewer: "v".repeat(200) });
    const shrunk = readNotes(bundleDir, 2_000);
    assert.ok(shrunk.length <= 2_000);
    assert.match(shrunk, /^## r10-e0/);
    assert.match(shrunk, /## r9-e0 · revert\n### Coder/);
    assert.match(shrunk, /## r[0-9]-e0 · revert\n### Reviewer[^]*v{200}/);
    assert.match(shrunk, /\n\n## r6-e0 · revert\n\n/); // heading only
    assert.match(shrunk, /## r1-e0 · keep: score up/); // every outcome stays
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the A/A run: the kept commit's score moved by the margin, with nothing replayed", () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-noise-"));
  try {
    const c = { ...cfg, results_path: join(dir, "r.jsonl") };
    mkdirSync(nightPaths(c, "n").nightDir, { recursive: true });
    const kept = parentAt(0.5, { accuracy: 0.45 });
    const ok = { ok: true as const, evalId: "n-r0-noise", result: evaluated({ accuracy: 0.54 }) };
    const noise = recordNoise({ cfg: c, nightId: "n", round: 2 }, kept, ok)!;
    assert.ok(Math.abs(noise.margin - 0.1) < 1e-9);
    assert.deepEqual(JSON.parse(readFileSync(nightPaths(c, "n").noiseJson, "utf8")), noise);
    const failed = recordNoise({ cfg: c, nightId: "n", round: 3 }, kept, { ok: false, evalId: "n-r0-noise2", error: "boom" });
    assert.equal(failed, null);
    const rows = readFileSync(c.results_path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { kind: string; decision: string });
    assert.deepEqual(rows.map((r) => [r.kind, r.decision]), [["noise", "keep"], ["noise", "error"]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("only the lines a commit adds are scanned for held-out names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cc-leaks-"));
  try {
    const scan = `if grep -q 'Gold Name' {text}; then printf '{"found":["Gold Name"]}'; else printf '{"found":[]}'; fi > {report}`;
    const c = { ...cfg, results_path: join(dir, "r.jsonl"), scenario: { ...cfg.scenario, scan } };
    const repo = new ExperimentRepo(nightPaths(c, "n").gitDir);
    await repo.ensure();
    const code = join(dir, "code");
    mkdirSync(code);
    writeFileSync(join(code, "a.py"), `x = "Gold Name"\n`);
    await repo.importDir(code, "parent");
    writeFileSync(join(code, "a.py"), "x = 1\n");
    await repo.importDir(code, "removes");
    writeFileSync(join(code, "a.py"), `x = 1\ny = "Gold Name"\n`);
    await repo.importDir(code, "adds");
    assert.deepEqual(await diffLeaks(c, "n", "parent", "removes"), []);
    assert.deepEqual(await diffLeaks(c, "n", "removes", "adds"), ["Gold Name"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
