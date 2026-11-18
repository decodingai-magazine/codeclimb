import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadNightConfig, type NightConfig } from "../config.ts";
import { appendRow, type ResultRow } from "../results.ts";
import { nightPaths, readJson, writeJson } from "./files.ts";
import type { NightJson } from "./types.ts";
import { keptOf, lastRound, resolveSeed, spendOf } from "./variation.ts";

const ROOT = process.cwd();

const row = (over: Partial<ResultRow>): ResultRow => ({
	night_id: "n",
	exp_id: "n-r1-e0",
	parent_id: "n-r0-starter",
	eval_id: "n-r1-e0-eval",
	round: 1,
	stack: "langchain",
	backend: "docker",
	kind: "experiment",
	split: "dev",
	model: "m",
	reviewer_model: "r",
	hypothesis: "h",
	commit: "c1",
	metrics: { f1: 0.1 },
	decision: "revert",
	coder_usd: 1,
	dev_usd: 0.5,
	program_usd: 0.25,
	reviewer_usd: 0.1,
	tokens: 10,
	wall_s: 1,
	t_provision: 0,
	t_code: 0,
	t_eval: 0,
	t_review: 0,
	t_teardown: 0,
	infra_errors: 0,
	...over,
});
const night = { round0: { exp_id: "n-r0-starter", sha: "c0" }, seed: null };

test("state from rows: the last keep is the checkpoint, a rescore row counts; else round 0, with a seed's metrics", () => {
	const rows = [row({ decision: "keep", exp_id: "n-r1-e0", commit: "c1", metrics: { f1: 0.3 } }), row({ round: 2, exp_id: "n-r2-e0", eval_id: "n-r2-e0-eval", commit: "c2" })];
	assert.deepEqual(keptOf(rows, night), { exp_id: "n-r1-e0", commit: "c1", metrics: { f1: 0.3 }, kept: true });
	const rescore = row({ round: 3, exp_id: "n-r3-e0", eval_id: "n-r3-e0-eval", model: null, parent_id: null, decision: "keep", commit: "c1", metrics: { f1: 0.35 } });
	assert.equal(keptOf([...rows, rescore], night).exp_id, "n-r3-e0");
	assert.deepEqual(keptOf([rows[1] as ResultRow], night), { exp_id: "n-r0-starter", commit: "c0", metrics: {}, kept: false });
	const seed = { night: "s", exp_id: "s-r2-e0", commit: "cs", round: 2, primary: 0.4, metrics: { f1: 0.4 }, rescore: false };
	assert.deepEqual(keptOf([], { round0: { exp_id: "n-r0-seed", sha: "cs" }, seed }), { exp_id: "n-r0-seed", commit: "cs", metrics: { f1: 0.4 }, kept: true });
	// Noise and test rows don't count as rounds.
	assert.equal(lastRound([...rows, row({ kind: "test", round: 9, eval_id: "n-test-r9" })]), 2);
	assert.equal(lastRound([]), 0);
});

test("spend over all rows: coder + dev + program, plus each round's review once", () => {
	const rows = [
		row({}),
		// A repaired round: two experiment rows share one review.
		row({ round: 2, exp_id: "n-r2-e0", eval_id: "n-r2-e0-eval", reviewer_usd: 0 }),
		row({ round: 2, exp_id: "n-r2-e1", eval_id: "n-r2-e1-eval", reviewer_usd: 0.2 }),
		row({ kind: "test", round: 2, eval_id: "n-test-r2", coder_usd: 0, dev_usd: 0, program_usd: 0.05, reviewer_usd: 0 }),
	];
	assert.equal(Math.round(spendOf(rows) * 1e6) / 1e6, Math.round((3 * 1.75 + 0.05 + 0.1 + 0.2) * 1e6) / 1e6);
});

test("seed: refused while the seed night applies lessons that lessons.md doesn't hold yet; a mock night never is", () => {
	const id = `tl${randomBytes(3).toString("hex")}`;
	const base = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: false });
	const config: NightConfig = { ...base, results_path: `runs-langchain/${id}/results.jsonl` };
	const ran: NightConfig = { ...config, lessons: "apply", scenario_spec: { ...config.scenario_spec, lessons: "spec/lessons.md" } };
	const paths = nightPaths(ROOT, config.results_path, id);
	try {
		mkdirSync(join(paths.bundle, "history", "notes"), { recursive: true });
		writeFileSync(join(paths.bundle, "history", "notes", "r1-e0.md"), "note");
		writeJson(paths.nightJson, { night_id: id, startedAt: "2026-01-01T00:00:00Z", deadlineMs: 0, round0: { exp_id: `${id}-r0-starter`, sha: "c0" }, seed: null, config: ran, metric_script_sha256: {}, lessons_sha256: [] } satisfies NightJson);
		writeJson(paths.doneJson, { stop_reason: "max_rounds" });
		appendRow(paths.results, row({ night_id: id, exp_id: `${id}-r1-e0`, eval_id: `${id}-r1-e0-eval`, decision: "keep" }));
		assert.match((resolveSeed(ROOT, config, id) as { refused: string }).refused, /not in lessons.md yet/);
		// Once a proposal through round 1 is applied, the seed resolves (the changed hashes ask for a rescore).
		writeJson(join(paths.resultsDir, "lessons", `${id}-r1`, "proposal.json"), { applied: true });
		assert.deepEqual(resolveSeed(ROOT, config, id), { id, rescore: true });
		// A mock night's lessons are never applied, so they never block a seed.
		writeJson(join(paths.resultsDir, "lessons", `${id}-r1`, "proposal.json"), { applied: false });
		writeJson(paths.nightJson, { ...readJson<NightJson>(paths.nightJson), config: { ...ran, results_path: `runs-langchain/mock/${id}/results.jsonl` } });
		assert.equal("refused" in resolveSeed(ROOT, config, id), false);
	} finally {
		rmSync(dirname(paths.results), { recursive: true, force: true });
	}
});
