// Init: the bundle, the round-0 commit, night.json (spec: Init). Safe to run again: a retried init finds its own files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deadlineAt } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { fillPlaceholders, runHostCommand } from "../hostcmd.ts";
import { starterId } from "../ids.ts";
import type { StepContext } from "../runtime/step.ts";
import { type NightPaths, nightPaths, readJson, writeJson } from "./files.ts";
import type { NightInput, NightJson } from "./types.ts";

/** Build the coder's bundle into `paths.bundle`, keeping a `history/` that is already there. */
export async function buildBundle(ctx: StepContext, scenarioDir: string, command: string, paths: NightPaths): Promise<void> {
	const history = join(paths.bundle, "history");
	const aside = join(paths.nightDir, `history.aside-${process.pid}`);
	if (existsSync(history)) renameSync(history, aside);
	rmSync(paths.bundle, { recursive: true, force: true });
	mkdirSync(paths.nightDir, { recursive: true });
	try {
		await runHostCommand(fillPlaceholders(command, { out: paths.bundle }), { cwd: scenarioDir, signal: ctx.signal });
		if (!existsSync(join(paths.bundle, "spec"))) throw new Error(`the scenario's bundle command wrote no spec/ into ${paths.bundle}`);
	} finally {
		mkdirSync(paths.bundle, { recursive: true });
		if (existsSync(aside)) renameSync(aside, history);
	}
	mkdirSync(join(paths.bundle, "history", "notes"), { recursive: true });
}

function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const name of readdirSync(dir).sort()) {
		if (name === "__pycache__") continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** The scoring hashes: checkout-relative path → sha256 over scenario.yaml, evaluators/ and gold/. */
export function scoringHashes(root: string, scenarioDir: string): Record<string, string> {
	const files = [join(scenarioDir, "scenario.yaml"), ...walk(join(scenarioDir, "evaluators")), ...walk(join(scenarioDir, "gold"))];
	return Object.fromEntries(files.map((f) => [relative(root, f), sha256(f)]));
}

export interface InitResult {
	startedAt: string;
	deadlineMs: number;
	round0: { exp_id: string; sha: string };
}

export async function initNight(ctx: StepContext, root: string, input: NightInput): Promise<InitResult> {
	const { night_id: id, config } = input;
	const paths = nightPaths(root, config.results_path, id);
	const existing = readJson<NightJson>(paths.nightJson);
	if (existing) return { startedAt: existing.startedAt, deadlineMs: existing.deadlineMs, round0: existing.round0 };

	const scenarioDir = join(root, config.scenario);
	await buildBundle(ctx, scenarioDir, config.scenario_spec.bundle, paths);
	const repo = await ExperimentRepo.open(paths.repo);
	const expId = starterId(id);
	const sha = await repo.importStarter(join(scenarioDir, "starter"), expId);
	const startedMs = Date.now();
	const lessonsFile = config.scenario_spec.lessons ? join(scenarioDir, config.scenario_spec.lessons) : undefined;
	const night: NightJson = {
		night_id: id,
		startedAt: new Date(startedMs).toISOString(),
		deadlineMs: deadlineAt(config.deadline, startedMs),
		round0: { exp_id: expId, sha },
		seed: null,
		config,
		metric_script_sha256: scoringHashes(root, scenarioDir),
		lessons_sha256: lessonsFile && existsSync(lessonsFile) ? [sha256(lessonsFile)] : [],
	};
	writeJson(paths.nightJson, night);
	return { startedAt: night.startedAt, deadlineMs: night.deadlineMs, round0: night.round0 };
}
