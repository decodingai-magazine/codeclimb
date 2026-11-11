import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExperimentRepo } from "./experiments.ts";

const fresh = () => mkdtempSync(join(tmpdir(), "cc-exp-"));

test("the same starter tree gives the same SHA in two fresh repositories", async () => {
	const a = await ExperimentRepo.open(join(fresh(), "experiments.git"));
	const b = await ExperimentRepo.open(join(fresh(), "experiments.git"));
	const shaA = await a.importStarter("scenarios/datenorm/starter", "n1-r0-starter");
	const shaB = await b.importStarter("scenarios/datenorm/starter", "n2-r0-starter");
	assert.match(shaA, /^[0-9a-f]{40}$/);
	assert.equal(shaA, shaB);
	assert.equal(await a.resolve("n1-r0-starter"), shaA);
});

test("the starter commit honours the starter's .gitignore and has the fixed identity", async () => {
	const starter = fresh();
	writeFileSync(join(starter, ".gitignore"), "*.log\n");
	writeFileSync(join(starter, "keep.py"), "print(1)\n");
	writeFileSync(join(starter, "skip.log"), "noise\n");
	mkdirSync(join(starter, "pkg"));
	writeFileSync(join(starter, "pkg", "x.py"), "x = 1\n");
	const repo = await ExperimentRepo.open(join(fresh(), "experiments.git"));
	const sha = await repo.importStarter(starter, "n-r0-starter");
	const files = execFileSync("git", ["--git-dir", repo.dir, "ls-tree", "-r", "--name-only", sha], { encoding: "utf8" }).trim().split("\n");
	assert.deepEqual(files.sort(), [".gitignore", "keep.py", "pkg/x.py"]);
	const meta = execFileSync("git", ["--git-dir", repo.dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%aI|%s", sha], { encoding: "utf8" }).trim();
	assert.equal(meta, "codeclimb <codeclimb@localhost>|codeclimb <codeclimb@localhost>|2026-01-01T00:00:00Z|starter");
});

test("importing the starter again is idempotent", async () => {
	const repo = await ExperimentRepo.open(join(fresh(), "experiments.git"));
	const first = await repo.importStarter("scenarios/datenorm/starter", "n-r0-starter");
	const again = await repo.importStarter("scenarios/datenorm/starter", "n-r0-starter");
	assert.equal(first, again);
});

test("an alias points a new experiment id at an existing commit", async () => {
	const repo = await ExperimentRepo.open(join(fresh(), "experiments.git"));
	const sha = await repo.importStarter("scenarios/datenorm/starter", "a-r0-starter");
	await repo.alias("b-r0-seed", sha);
	assert.equal(await repo.resolve("b-r0-seed"), sha);
	assert.equal(await repo.resolve("missing"), null);
});
