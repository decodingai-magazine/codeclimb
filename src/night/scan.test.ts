import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExperimentRepo } from "../experiments.ts";
import { addedLines, checkCommit, distinctNames, mask, maskText, scanText } from "./scan.ts";

test("masking replaces every found name in any letter case, the longest name first", () => {
	assert.equal(mask("Acme Corp met acme and ACME CORP", ["Acme", "Acme Corp"]), "[hidden] met [hidden] and [hidden]");
	// One pass: a name inside `[hidden]` is not matched again.
	assert.equal(mask("hidden Zed", ["Zed", "hidden"]), "[hidden] [hidden]");
	assert.equal(mask("a.b and axb", ["a.b"]), "[hidden] and axb");
	assert.equal(mask("nothing", []), "nothing");
	assert.equal(distinctNames(["Acme", "ACME", "Zed"]), 2);
});

/** A fixture scenario whose scan finds `Zanzibar` and `Quixote` (any case) and whose check errors on a file named BAD. */
function fixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "cc-fixture-"));
	writeFileSync(
		join(dir, "scan.py"),
		["import json, re, sys", "text = open(sys.argv[1]).read()", 'found = sorted(set(re.findall(r"(?i)zanzibar|quixote", text)))', 'json.dump({"found": found}, open(sys.argv[2], "w"))'].join("\n"),
	);
	writeFileSync(
		join(dir, "check.py"),
		["import json, os, sys", "repo = sys.argv[1]", 'errors = ["BAD is not allowed"] if os.path.exists(os.path.join(repo, "BAD")) else []', 'json.dump({"errors": errors, "notes": sorted(os.listdir(repo))}, open(sys.argv[2], "w"))'].join("\n"),
	);
	return dir;
}

test("scan: the fixture's names are found as the text has them; no command or empty text finds nothing", async () => {
	const dir = fixture();
	const s = { scenarioDir: dir, scan: "python3 scan.py {text} {report}" };
	assert.deepEqual(await scanText(s, "to Zanzibar and quixote"), ["Zanzibar", "quixote"]);
	assert.equal(await maskText(s, "to Zanzibar and quixote"), "to [hidden] and [hidden]");
	assert.deepEqual(await scanText(s, "  "), []);
	assert.deepEqual(await scanText({ scenarioDir: dir }, "Zanzibar"), []);
});

test("check reads the commit's files; added lines are what a commit adds over its base", async () => {
	const dir = fixture();
	const work = mkdtempSync(join(tmpdir(), "cc-starter-"));
	mkdirSync(join(work, "src"));
	writeFileSync(join(work, "src", "a.py"), "x = 1\n");
	const repo = await ExperimentRepo.open(join(dir, "experiments.git"));
	const base = await repo.importStarter(work, "n-r0-starter");
	writeFileSync(join(work, "BAD"), "Zanzibar\n");
	writeFileSync(join(work, "src", "a.py"), "x = 1\ny = 'Quixote'\n");
	const next = await repo.importStarter(work, "n-r1-e0");
	const check = "python3 check.py {repo} {report}";
	assert.deepEqual(await checkCommit(dir, check, repo, base), { errors: [], notes: ["src"] });
	assert.deepEqual((await checkCommit(dir, check, repo, next)).errors, ["BAD is not allowed"]);
	const added = await addedLines(repo, base, next);
	assert.equal(added.split("\n").sort().join("|"), ["Zanzibar", "y = 'Quixote'"].sort().join("|"));
	assert.equal(readFileSync(join(work, "src", "a.py"), "utf8").includes("Quixote"), true);
});
