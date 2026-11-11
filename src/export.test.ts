import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExperimentRepo } from "./experiments.ts";
import { exportExperiment, resolveExpId, validateRemote } from "./export.ts";
import { writeJson } from "./night/files.ts";

const git = (...args: string[]) => {
	const r = spawnSync("git", args, { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.trim();
};

/** A results directory: a starter, a kept r1-e0 on it, and an r2-e0 on r1-e0; plus a finished night keeping r1-e0. */
async function results() {
	const dir = mkdtempSync(join(tmpdir(), "cc-export-"));
	const starter = join(dir, "starter");
	mkdirSync(starter);
	writeFileSync(join(starter, "main.py"), "print(1)\n");
	const repo = await ExperimentRepo.open(join(dir, "experiments.git"));
	const s0 = await repo.importStarter(starter, "n-r0-starter");
	const commit = (parent: string, id: string, msg: string) => {
		const tree = git("--git-dir", repo.dir, "rev-parse", `${parent}^{tree}`);
		const sha = git("--git-dir", repo.dir, "commit-tree", tree, "-p", parent, "-m", msg);
		git("--git-dir", repo.dir, "update-ref", `refs/exp/${id}`, sha);
		return sha;
	};
	const r1 = commit(s0, "n-r1-e0", "r1");
	const r2 = commit(r1, "n-r2-e0", "r2");
	writeJson(join(dir, "nights", "old", "done.json"), { kept: { exp_id: "n-r0-starter" }, finished_at: "2026-01-01T00:00:00Z" });
	writeJson(join(dir, "nights", "n", "done.json"), { kept: { exp_id: "n-r1-e0" }, finished_at: "2026-01-02T00:00:00Z" });
	return { dir, gitDir: repo.dir, s0, r1, r2 };
}

test("export to a folder: plain files; a non-empty folder only with force", async () => {
	const r = await results();
	assert.equal(resolveExpId(r.dir, "best"), "n-r1-e0", "best: the kept commit of the most recently finished night");
	const out = join(r.dir, "out");
	const done = await exportExperiment(r.gitDir, "n-r1-e0", { kind: "dir", path: out });
	assert.equal(done.sha, r.r1);
	assert.deepEqual(readdirSync(out), ["main.py"]);
	await assert.rejects(exportExperiment(r.gitDir, "n-r1-e0", { kind: "dir", path: out }), /not empty/);
	writeFileSync(join(out, "main.py"), "changed\n");
	await exportExperiment(r.gitDir, "n-r1-e0", { kind: "dir", path: out, force: true });
	assert.equal(readFileSync(join(out, "main.py"), "utf8"), "print(1)\n");
	await assert.rejects(exportExperiment(r.gitDir, "nope", { kind: "dir", path: join(r.dir, "x") }), /has no commit/);
	await assert.rejects(exportExperiment(r.gitDir, "--upload-pack=x", { kind: "dir", path: join(r.dir, "x") }), /invalid experiment id/);
});

test("export with history: a git repository holding only the lineage, on codeclimb/<exp id>", async () => {
	const r = await results();
	const out = join(r.dir, "hist");
	const done = await exportExperiment(r.gitDir, "n-r1-e0", { kind: "dir", path: out, withHistory: true });
	assert.equal(done.branch, "codeclimb/n-r1-e0");
	assert.equal(git("-C", out, "rev-parse", "--abbrev-ref", "HEAD"), "codeclimb/n-r1-e0");
	assert.deepEqual(git("-C", out, "rev-list", "--all").split("\n"), [r.r1, r.s0], "r2-e0 is not in the lineage");
	await assert.rejects(exportExperiment(r.gitDir, "n-r1-e0", { kind: "dir", path: out, withHistory: true }), /not empty/);
});

test("export to a remote: pushes the lineage to a branch, never forced; refuses options and command transports", async () => {
	const r = await results();
	const bare = join(r.dir, "remote.git");
	git("init", "--bare", "-q", bare);
	const pushed = await exportExperiment(r.gitDir, "n-r2-e0", { kind: "remote", url: bare });
	assert.equal(pushed.branch, "codeclimb/n-r2-e0");
	assert.equal(git("--git-dir", bare, "rev-parse", "refs/heads/codeclimb/n-r2-e0"), r.r2);
	await exportExperiment(r.gitDir, "n-r1-e0", { kind: "remote", url: `file://${bare}`, branch: "main" });
	// main holds r1; pushing the starter there would rewind it: rejected, not forced.
	await assert.rejects(exportExperiment(r.gitDir, "n-r0-starter", { kind: "remote", url: bare, branch: "main" }), /failed/);
	assert.equal(git("--git-dir", bare, "rev-parse", "refs/heads/main"), r.r1);
	for (const bad of ["--upload-pack=touch /tmp/x", "ext::sh -c touch% /tmp/x", "fd::3", "http://example.com/r.git", "a b"]) assert.throws(() => validateRemote(bad), Error, bad);
	for (const ok of ["https://github.com/a/b.git", "ssh://git@host/r.git", "git@github.com:a/b.git", "git://host/r.git", "/tmp/r.git"]) validateRemote(ok);
	await assert.rejects(exportExperiment(r.gitDir, "n-r1-e0", { kind: "remote", url: bare, branch: "-f" }), /invalid branch/);
});
