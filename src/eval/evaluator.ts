// One evaluation of one commit in its own sandbox: reset, environment, per stage inputs → run → score (spec: Evaluator).
// A failed evaluation is an outcome with ok: false; an inputs or infrastructure failure throws.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Scenario } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { fillPlaceholders, runHostCommand, tail } from "../hostcmd.ts";
import type { SandboxBackend, Sandbox } from "../sandbox/types.ts";
import { pushCommit } from "../sandbox/transfer.ts";
import { costMetrics, flattenReport, type LedgerCall, latencyMetrics, type Metrics, parseTimings, type Timing } from "./metrics.ts";

export interface EvalRequest {
	night: string;
	evalId: string;
	sandboxName: string;
	split: "dev" | "test";
	commit: string;
	/** experiments.git, absolute. */
	repoDir: string;
	/** Absolute. */
	scenarioDir: string;
	scenario: Scenario;
	image: string;
	evalMin: number;
	primary: string;
	/** nights/<id>/evals/<eval id>, absolute. */
	evalDir: string;
	network?: string;
	/** The meter variables for the run, on a metered night. */
	meterEnv?: Record<string, string>;
	/** The evaluation's ledger calls, read at close (empty when unmetered). */
	ledgerCalls?: () => LedgerCall[];
	/** On a metered night: throws when the path to the proxy is down. */
	checkMeterPath?: () => Promise<void>;
}

export interface EvalResult {
	ok: boolean;
	metrics: Metrics;
	error?: string;
	program_usd: number;
	t_provision: number;
	t_eval: number;
	instance: string;
}

const RESET_TIMEOUT_MS = 2 * 60_000;
const ENV_TIMEOUT_MS = 3 * 60_000;

/** Kill everything but init and this exec's own chain; wipe the work directories; keep the pid files. */
const RESET = [
	'for p in /proc/[0-9]*; do pid=${p#/proc/}; case "$pid" in 1|$$|$PPID) ;; *) kill -9 "$pid" 2>/dev/null ;; esac; done',
	"rm -rf /repo /work /eval ~/.cache",
	"find /tmp -mindepth 1 -maxdepth 1 ! -name .cc-pid -exec rm -rf {} +",
	"mkdir -p /eval /work",
].join("; ");

class EvalFailure extends Error {}

async function must(sb: Sandbox, command: string, what: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
	const r = await sb.exec(command, { cwd: "/", timeoutMs, signal });
	if (r.aborted) throw signal.reason;
	if (r.exitCode !== 0 || r.timedOut) throw new Error(`${what} failed${r.timedOut ? " (timeout)" : ""}: ${tail(r.stderr || r.stdout)}`);
}

function dirBytes(dir: string, skip: string): number {
	let n = 0;
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const s = statSync(p);
		if (s.isDirectory()) n += dirBytes(p, "");
		else if (name !== skip) n += s.size;
	}
	return n;
}

const countLines = (file: string) => readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length;

/** Run the evaluation. The sandbox is found by name and reused after its reset, else created. */
export async function evaluate(backend: SandboxBackend, req: EvalRequest, signal: AbortSignal): Promise<EvalResult> {
	const t0 = Date.now();
	let sb = await backend.find(req.sandboxName);
	if (!sb) sb = await backend.create({ name: req.sandboxName, image: req.image, labels: { night: req.night, run: req.evalId }, ...(req.network ? { network: req.network } : {}) });
	await must(sb, RESET, "reset", RESET_TIMEOUT_MS, signal);
	await pushCommit(sb, await ExperimentRepo.open(req.repoDir), req.commit);
	const tProvision = (Date.now() - t0) / 1000;
	const t1 = Date.now();
	const multi = req.scenario.stages.length > 1;
	const metrics: Metrics = {};
	let items = 0;
	const timings: Timing[] = [];
	const finish = (ok: boolean, error?: string): EvalResult => {
		const calls = req.ledgerCalls?.() ?? [];
		Object.assign(metrics, latencyMetrics(timings), costMetrics(calls, items));
		const programUsd = calls.reduce((a, c) => a + c.cost_usd, 0);
		const okNow = ok && typeof metrics[req.primary] === "number";
		const result: EvalResult = { ok: okNow, metrics, program_usd: programUsd, t_provision: tProvision, t_eval: (Date.now() - t1) / 1000, instance: (sb as Sandbox).instanceId };
		const err = error ?? (okNow ? undefined : `the evaluation reported no \`${req.primary}\``);
		if (err) result.error = err;
		writeFileSync(join(req.evalDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
		if (calls.length) writeFileSync(join(req.evalDir, "meter.jsonl"), calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
		return result;
	};
	rmSync(req.evalDir, { recursive: true, force: true });
	mkdirSync(req.evalDir, { recursive: true });

	if ((await sb.exec("test -e /repo/uv.lock", { cwd: "/" })).exitCode === 0) {
		const r = await sb.exec("uv venv -q --system-site-packages .venv && uv sync -q --frozen --no-dev --inexact", { cwd: "/repo", timeoutMs: ENV_TIMEOUT_MS, signal, env: { UV_PROJECT_ENVIRONMENT: "/repo/.venv" } });
		if (r.aborted) throw signal.reason;
		if (r.exitCode !== 0 || r.timedOut) return finish(false, `uv.lock: ${r.timedOut ? "environment build timed out" : tail(r.stderr || r.stdout)}`);
	}

	try {
		for (const stage of req.scenario.stages) {
			const dir = join(req.evalDir, stage.name);
			mkdirSync(dir, { recursive: true });
			const inputs = join(dir, "inputs.jsonl");
			await runHostCommand(fillPlaceholders(stage.inputs, { split: req.split, inputs }), { cwd: req.scenarioDir, signal });
			items += countLines(inputs);
			const box = `/eval/${stage.name}`;
			await sb.writeFile(`${box}/inputs.jsonl`, readFileSync(inputs));
			for (const [target, source] of Object.entries(stage.files)) {
				const host = join(req.scenarioDir, source);
				if (statSync(host).isDirectory()) await sb.uploadDir(host, target);
				else await sb.writeFile(target, readFileSync(host));
			}
			const command = fillPlaceholders(stage.run, { inputs: `${box}/inputs.jsonl`, out: `${box}/out` });
			const run = await sb.exec(`mkdir -p ${box}/out && export PATH=/repo/.venv/bin:$PATH && ( ${command} ) > ${box}/run.log 2>&1`, {
				cwd: "/repo",
				timeoutMs: req.evalMin * 60_000,
				signal,
				...(req.meterEnv ? { env: req.meterEnv } : {}),
			});
			if (run.aborted) throw signal.reason;
			const log = (await sb.exec(`cat ${box}/run.log`, { cwd: "/" })).stdout;
			writeFileSync(join(dir, "run.log"), log);
			if (run.timedOut) throw new EvalFailure(`stage ${stage.name}: the run passed eval_min (${req.evalMin} min)\n${tail(log)}`);
			if (run.exitCode !== 0) throw new EvalFailure(`stage ${stage.name}: the run exited ${run.exitCode}\n${tail(log)}`);
			await req.checkMeterPath?.();
			await must(sb, `mkdir -p /cc && tar -c -C ${box}/out -f /cc/outputs.tar .`, "tar of the outputs", RESET_TIMEOUT_MS, signal);
			writeFileSync(join(dir, "outputs.tar"), await sb.readFile("/cc/outputs.tar"));
			const outputs = join(dir, "outputs");
			mkdirSync(outputs, { recursive: true });
			const untar = spawnSync("tar", ["-x", "-f", join(dir, "outputs.tar"), "-C", outputs]);
			if (untar.status !== 0) throw new Error(`untar of ${stage.name}'s outputs failed: ${untar.stderr}`);
			const bytes = dirBytes(outputs, "timings.jsonl");
			metrics[multi ? `${stage.name}.output_bytes` : "output_bytes"] = bytes;
			if (req.split === "dev" && bytes === 0) throw new EvalFailure(`stage ${stage.name}: the run exited clean but wrote no output`);
			const timingsFile = join(outputs, "timings.jsonl");
			if (existsSync(timingsFile)) {
				try {
					timings.push(...parseTimings(readFileSync(timingsFile, "utf8")));
				} catch (error) {
					throw new EvalFailure(`stage ${stage.name}: ${(error as Error).message}`);
				}
			}
			const report = join(dir, "report.json");
			const scorer = req.split === "dev" && stage.details ? stage.details : stage.score;
			try {
				await runHostCommand(fillPlaceholders(scorer, { split: req.split, out: outputs, report }), { cwd: req.scenarioDir, signal });
				Object.assign(metrics, flattenReport(JSON.parse(readFileSync(report, "utf8")), stage.name, multi));
			} catch (error) {
				if (signal.aborted) throw error;
				throw new EvalFailure(`stage ${stage.name}: the scorer failed: ${tail((error as Error).message)}`);
			}
		}
	} catch (error) {
		if (error instanceof EvalFailure) return finish(false, error.message);
		throw error;
	}
	return finish(true);
}
