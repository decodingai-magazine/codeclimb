// Integration tests of the evaluator against Docker and the datenorm scenario. Skipped, with a message, without Docker.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { loadScenario } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { DockerBackend } from "../sandbox/docker.ts";
import { evaluate, type EvalRequest } from "./evaluator.ts";

const IMAGE = "codeclimb-python";
const probe = spawnSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" });
const skip = probe.status === 0 && probe.stdout.trim() !== "" ? false : `Docker is not running or image ${IMAGE} is missing: evaluator tests skipped`;
if (skip) console.log(`# ${skip}`);

const NIGHT = `t${randomBytes(3).toString("hex")}`;
const backend = new DockerBackend();
const scenarioDir = resolve("scenarios/datenorm");
const scenario = loadScenario(scenarioDir);

async function request(name: string, overrides: Partial<EvalRequest> = {}): Promise<EvalRequest> {
	const tmp = mkdtempSync(join(tmpdir(), "cc-eval-"));
	const repo = await ExperimentRepo.open(join(tmp, "experiments.git"));
	const commit = await repo.importStarter(join(scenarioDir, "starter"), `${NIGHT}-r0-starter`);
	return {
		night: NIGHT, evalId: `${NIGHT}-${name}`, sandboxName: `cc-${NIGHT}-${name}`, split: "dev", commit, repoDir: repo.dir, scenarioDir, scenario,
		image: IMAGE, evalMin: 2, primary: "accuracy", evalDir: join(tmp, "evals", name), ...overrides,
	};
}

describe("evaluator", { skip, concurrency: true }, () => {
	after(async () => {
		await backend.sweep({ prefix: `cc-${NIGHT}` });
	});

	test("the datenorm starter scores 0.125 on dev, with standard metrics and the stage's files", async () => {
		const req = await request("dev");
		const r = await evaluate(backend, req, new AbortController().signal);
		assert.equal(r.ok, true, r.error);
		assert.equal(r.metrics.accuracy, 0.125);
		assert.ok((r.metrics.output_bytes ?? 0) > 0);
		assert.equal(typeof r.metrics.latency_total_s, "number");
		assert.equal(r.metrics.model_calls, 0);
		for (const f of ["inputs.jsonl", "run.log", "outputs.tar", "report.json"]) assert.ok(existsSync(join(req.evalDir, "answer", f)), f);
		assert.ok(JSON.parse(readFileSync(join(req.evalDir, "metrics.json"), "utf8")).accuracy === 0.125);
	});

	test("the same sandbox is reused after its reset on a retry", async () => {
		const req = await request("retry");
		const first = await evaluate(backend, req, new AbortController().signal);
		const second = await evaluate(backend, req, new AbortController().signal);
		assert.equal(second.instance, first.instance);
		assert.equal(second.metrics.accuracy, first.metrics.accuracy);
	});

	test("a crashing program gives ok: false with the log's tail", async () => {
		const stages = [{ ...scenario.stages[0]!, run: "echo the program broke; exit 3" }];
		const r = await evaluate(backend, await request("crash", { scenario: { ...scenario, stages } }), new AbortController().signal);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /exited 3[\s\S]*the program broke/);
	});

	test("a stage that passes eval_min gives ok: false", async () => {
		const stages = [{ ...scenario.stages[0]!, run: "echo started; sleep 600" }];
		const r = await evaluate(backend, await request("slow", { scenario: { ...scenario, stages }, evalMin: 0.05 }), new AbortController().signal);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /eval_min[\s\S]*started/);
	});
});
