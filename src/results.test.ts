import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendRow, readRows, type ResultRow, rowErrors } from "./results.ts";

const row: ResultRow = {
	night_id: "n", exp_id: "n-r0-starter", parent_id: null, eval_id: "n-test-r2", round: 2, stack: "langchain", backend: "docker",
	kind: "test", split: "test", model: null, reviewer_model: "a/b", hypothesis: null, commit: "abc", metrics: { accuracy: 0.1 },
	decision: "keep", coder_usd: 0, dev_usd: 0, program_usd: 0, reviewer_usd: 0, tokens: 0, wall_s: 3, t_provision: 1, t_code: 0,
	t_eval: 2, t_review: 0, t_teardown: 0.5, infra_errors: 0,
};

test("a complete row is valid; a row missing a required field is not", () => {
	assert.deepEqual(rowErrors(row), []);
	const { commit: _, ...missing } = row;
	assert.deepEqual(rowErrors(missing), ["missing `commit`"]);
	assert.match(rowErrors({ ...row, round: -1 }).join(), /round/);
	assert.match(rowErrors({ ...row, metrics: { a: "x" } }).join(), /metric/);
	assert.match(rowErrors({ ...row, stack: "other" }).join(), /stack/);
});

test("a row is appended once per eval_id", () => {
	const file = join(mkdtempSync(join(tmpdir(), "cc-rows-")), "results.jsonl");
	assert.equal(appendRow(file, row), true);
	assert.equal(appendRow(file, row), false);
	assert.equal(readRows(file).length, 1);
	assert.throws(() => appendRow(file, { ...row, eval_id: "x", decision: "maybe" as "keep" }), /decision/);
});
