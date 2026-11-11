import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { deadlineAt, loadNightConfig } from "./config.ts";
import { isValidNightId } from "./ids.ts";

const ROOT = process.cwd();

const base = {
	scenario: "scenarios/datenorm",
	sandbox: "docker",
	max_rounds: 2,
	deadline: "3h",
	timeouts: { experiment_min: 10, eval_min: 3 },
	model: "github-copilot/claude-haiku-5.5",
	reviewer_model: "github-copilot/claude-haiku-4.5",
	primary_metric: "accuracy",
	thresholds: { accuracy: 1.01 },
	budget_usd: { experiment: 1, night: 10 },
	results_path: "runs/datenorm-smoke/results.jsonl",
};

function load(overrides: Record<string, unknown>, opts: { mock?: boolean } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "cc-config-"));
	const file = join(dir, "night.yaml");
	writeFileSync(file, stringify({ ...base, ...overrides }));
	return loadNightConfig(file, { cwd: ROOT, root: ROOT, mock: opts.mock ?? false });
}

test("the given smoke config loads with its defaults and its scenario", () => {
	const config = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: false });
	assert.equal(config.scenario, "scenarios/datenorm");
	assert.equal(config.scenario_spec.name, "datenorm");
	assert.equal(config.scenario_spec.stages[0]?.name, "answer");
	assert.equal(config.plateau_rounds, 3);
	assert.equal(config.lessons, "off");
	assert.deepEqual(config.weights, { accuracy: 1 });
	assert.equal(config.results_path, "runs/datenorm-smoke/results.jsonl");
});

test("a mock night writes under runs/mock/", () => {
	const config = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
	assert.equal(config.results_path, "runs/mock/datenorm-smoke/results.jsonl");
});

test("graphrag declares lessons, so lessons default to apply", () => {
	const config = loadNightConfig("configs/graphrag-smoke.yaml", { cwd: ROOT, root: ROOT, mock: false });
	assert.equal(config.lessons, "apply");
	assert.equal(config.scenario_spec.stages.length, 3);
});

test("a reviewer equal to the coder is refused", () => {
	assert.throws(() => load({ reviewer_model: base.model }), /reviewer/);
	assert.throws(() => load({ reviewer_model: base.model, reviewer_thinking: "medium" }), /reviewer/);
});

test("the same model with another effort is a different reviewer", () => {
	assert.doesNotThrow(() => load({ reviewer_model: base.model, reviewer_thinking: "low" }));
});

test("an unparsable deadline is refused", () => {
	assert.throws(() => load({ deadline: "soon" }), /deadline/);
	assert.throws(() => load({ deadline: "90 minutes" }), /deadline/);
});

test("a threshold of 0 or less is refused", () => {
	assert.throws(() => load({ thresholds: { accuracy: 0 } }), /threshold/);
	assert.throws(() => load({ thresholds: { accuracy: -1 } }), /threshold/);
	assert.throws(() => load({ thresholds: {} }), /threshold/);
});

test("a results directory not directly under runs/ is refused", () => {
	assert.throws(() => load({ results_path: "out/x/results.jsonl" }), /runs/);
	assert.throws(() => load({ results_path: "runs/a/b/results.jsonl" }), /runs/);
});

test("lessons on a scenario without lessons are refused", () => {
	assert.throws(() => load({ lessons: "apply" }), /lessons/);
});

test("a weight on a metric that is no threshold is refused", () => {
	assert.throws(() => load({ weights: { latency: 1 } }), /weight/);
});

test("night ids: 1 to 48 letters, digits or hyphens, no leading hyphen", () => {
	assert.ok(isValidNightId("n20261111-120000"));
	assert.ok(isValidNightId("a"));
	assert.ok(isValidNightId("x".repeat(48)));
	assert.ok(!isValidNightId(""));
	assert.ok(!isValidNightId("-a"));
	assert.ok(!isValidNightId("x".repeat(49)));
	assert.ok(!isValidNightId("a_b"));
	assert.ok(!isValidNightId("a/b"));
});

test("a deadline is a duration from the start or an ISO time", () => {
	const start = Date.parse("2026-11-11T10:00:00Z");
	assert.equal(deadlineAt("90m", start), start + 90 * 60_000);
	assert.equal(deadlineAt("8h", start), start + 8 * 3_600_000);
	assert.equal(deadlineAt("30s", start), start + 30_000);
	assert.equal(deadlineAt("2026-11-12T06:00:00Z", start), Date.parse("2026-11-12T06:00:00Z"));
});
