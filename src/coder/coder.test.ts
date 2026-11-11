// Crash resume of the coder against the local Docker daemon and the mock model. Skipped, with a message, when Docker is not running.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { loadNightConfig } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { DockerBackend } from "../sandbox/docker.ts";
import { type CodeRequest, RESTART_PROMPT, runCoder } from "./coder.ts";

const IMAGE = "codeclimb-python";
const probe = spawnSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" });
const skip = probe.status === 0 && probe.stdout.trim() !== "" ? false : `Docker is not running or image ${IMAGE} is missing: coder test skipped`;
if (skip) console.log(`# ${skip}`);

const ROOT = process.cwd();
const night = `tc${randomBytes(3).toString("hex")}`;
const backend = new DockerBackend();

/** Make the finished attempt look like one a crash interrupted. */
function unfinish(expDir: string): void {
	rmSync(join(expDir, "code-result.json"), { force: true });
	const file = join(expDir, "code-state.json");
	const s = JSON.parse(readFileSync(file, "utf8"));
	delete s.finishedAt;
	delete s.stop;
	writeFileSync(file, JSON.stringify(s));
}

describe("coder crash resume", { skip }, () => {
	after(async () => {
		await backend.sweep({ prefix: `cc-${night}` });
	});

	test("live sandbox → session resume; dead → one fresh restart; lost twice → the experiment fails", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cc-coder-"));
		const bundle = join(dir, "bundle");
		mkdirSync(join(bundle, "spec"), { recursive: true });
		writeFileSync(join(bundle, "spec", "SPEC.md"), "Make it better.\n");
		const repo = await ExperimentRepo.open(join(dir, "experiments.git"));
		const parent = await repo.importStarter(join(ROOT, "scenarios/datenorm/starter"), `${night}-r0-starter`);
		const config = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
		const expId = `${night}-r1-e0`;
		const expDir = join(dir, "exps", expId);
		const req: CodeRequest = { night, expId, round: 1, parentSha: parent, repoDir: repo.dir, bundleDir: bundle, expDir, config, mock: true, hypothesis: null, checkpointMetrics: {} };
		const ac = new AbortController();

		const first = await runCoder(backend, req, ac.signal);
		assert.equal(first.stop, "done");
		// Finished: a rerun returns the saved result without coding again.
		assert.deepEqual(await runCoder(backend, req, ac.signal), first);

		// The sandbox is still alive (the step's teardown never ran): a session resume with the restart prompt.
		unfinish(expDir);
		const resumed = await runCoder(backend, req, ac.signal);
		assert.equal(resumed.infraErrors, 0);
		const sessions = readdirSync(join(expDir, "session"));
		assert.equal(sessions.length, 1);
		assert.ok(readFileSync(join(expDir, "session", sessions[0] as string), "utf8").includes(RESTART_PROMPT));

		// Dead: one fresh restart, counted in infra_errors.
		unfinish(expDir);
		await (await backend.find(`cc-${expId}`))?.destroy();
		const fresh = await runCoder(backend, req, ac.signal);
		assert.equal(fresh.infraErrors, 1);
		assert.equal(JSON.parse(readFileSync(join(expDir, "code-state.json"), "utf8")).freshRestarts, 1);

		// Lost twice: the experiment fails.
		unfinish(expDir);
		await (await backend.find(`cc-${expId}`))?.destroy();
		await assert.rejects(runCoder(backend, req, ac.signal), /sandbox lost twice/);
	});
});
