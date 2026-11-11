// Init: the bundle, the round-0 commit, night.json (spec: Init). Safe to run again: a retried init finds its own files.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deadlineAt, type NightConfig } from "../config.ts";
import type { Decision, NoiseState } from "../decision.ts";
import { type ResultRow, readRows } from "../results.ts";
import { ExperimentRepo } from "../experiments.ts";
import { fillPlaceholders, runHostCommand } from "../hostcmd.ts";
import { seedId, starterId } from "../ids.ts";
import { NonRetriableError, type StepContext } from "../runtime/step.ts";
import { type NightPaths, nightPaths, readJson, writeJson } from "./files.ts";
import type { NightInput, NightJson, SeedInfo } from "./types.ts";
import { type Guidance, type HistoryEntry, historyLine, movesText } from "./memory.ts";
import type { Checkpoint } from "./rows.ts";
import { maskText, type Scanner } from "./scan.ts";
import { isRescoreRow, keptOf, lastRound, pausesUsed, resolveSeed, seedInfo, spendOf } from "./variation.ts";

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
	start: StartState;
}

/** Where a variation's loop starts: a new night from round 0, a seeded one from its seed, a continued one from its rows. */
export interface StartState {
	checkpoint: Checkpoint;
	lastRound: number;
	spentUsd: number;
	guidance: Guidance;
	/** Masked history lines. */
	history: HistoryEntry[];
	noise: NoiseState & { base: number | null };
	/** Pause numbers already used: the variation's pauses number on from it. */
	pauses: number;
	/** The operator's direction, masked. */
	direction?: string;
	/** Rescore the checkpoint first: the scoring hashes changed since it was scored. */
	rescore: boolean;
}

const noNoise = (): StartState["noise"] => ({ runs: 0, measured: false, remeasureOn: null, base: null });

/** The A/A run's margin as measured noise, re-keyed to the checkpoint that carries it. */
function noiseFrom(file: string, config: NightConfig, checkpointId: string): StartState["noise"] {
	const n = readJson<{ margin?: number }>(file);
	if (typeof n?.margin !== "number") return noNoise();
	return { runs: 0, measured: true, remeasureOn: n.margin > config.noise_margin.max ? checkpointId : null, base: n.margin };
}

/** A continued night's state from its rows, notes and reviews (spec: Continue, seed and rescore, the state table). */
async function continuedStart(ctx: StepContext, root: string, input: NightInput, night: NightJson, paths: NightPaths): Promise<StartState> {
	const { config } = input;
	const sc: Scanner = { scenarioDir: join(root, config.scenario), ...(config.scenario_spec.scan ? { scan: config.scenario_spec.scan } : {}), signal: ctx.signal };
	const rows = readRows(paths.results).filter((r) => r.night_id === input.night_id);
	const last = lastRound(rows);
	const k = keptOf(rows, night);
	// One history line per round from the experiment rows; in a repaired round the last row stands.
	const byRound = new Map<number, ResultRow>();
	for (const r of rows) if (r.kind === "experiment") byRound.set(r.round, r);
	const history: HistoryEntry[] = [];
	let cp: Record<string, number> = night.seed?.metrics ?? {};
	for (const [round, r] of [...byRound].sort((a, b) => a[0] - b[0])) {
		if (isRescoreRow(r)) {
			cp = r.metrics;
			continue;
		}
		const d: Decision = { decision: r.decision, reason: r.decision_reason ?? "", metrics: r.metrics, ...(r.score !== undefined ? { score: r.score } : {}), ...(r.unchanged ? { unchanged: true as const } : {}) };
		history.push({ round, line: await maskText(sc, historyLine(round, r.hypothesis, movesText(config, cp, d), d)) });
		if (r.decision === "keep") cp = r.metrics;
	}
	let review: { feedback?: string; hypothesis?: string } | null = null;
	for (let n = last; n >= 1 && !review; n--) review = readJson(join(paths.nightDir, "reviews", `r${n}.json`));
	const direction = input.continue?.direction ? await maskText(sc, input.continue.direction) : undefined;
	const rescore = input.continue?.rescore === true;
	return {
		checkpoint: { exp_id: k.exp_id, commit: k.commit, metrics: k.metrics },
		lastRound: last,
		spentUsd: spendOf(rows),
		// A direction replaces the hypothesis the night had reached.
		guidance: { feedback: review?.feedback ?? "", hypothesis: direction ? null : (review?.hypothesis ?? null) },
		history,
		noise: rescore ? noNoise() : noiseFrom(join(paths.nightDir, "noise.json"), config, k.exp_id),
		pauses: pausesUsed(paths),
		...(direction ? { direction } : {}),
		rescore,
	};
}

/** A new night's state: round 0 is the starter, or the seed with the dev metrics it was kept on. */
function freshStart(root: string, config: NightConfig, night: NightJson, paths: NightPaths): StartState {
	const seed = night.seed;
	const checkpoint = { exp_id: night.round0.exp_id, commit: night.round0.sha, metrics: seed?.metrics ?? {} };
	const seedNoise = seed && !seed.rescore ? noiseFrom(join(nightPaths(root, config.results_path, seed.night).nightDir, "noise.json"), config, checkpoint.exp_id) : noNoise();
	return { checkpoint, lastRound: 0, spentUsd: 0, guidance: { feedback: "", hypothesis: null }, history: [], noise: seedNoise, pauses: pausesUsed(paths), rescore: seed?.rescore === true };
}

export async function initNight(ctx: StepContext, root: string, input: NightInput): Promise<InitResult> {
	const { night_id: id, config } = input;
	const paths = nightPaths(root, config.results_path, id);
	const scenarioDir = join(root, config.scenario);
	const existing = readJson<NightJson>(paths.nightJson);
	const result = async (night: NightJson): Promise<InitResult> => ({
		startedAt: night.startedAt,
		deadlineMs: night.deadlineMs,
		round0: night.round0,
		start: input.continue ? await continuedStart(ctx, root, input, night, paths) : freshStart(root, config, night, paths),
	});
	if (input.continue) {
		// The reopen already rewrote night.json; this step only rebuilds the bundle from the scenario as it stands, and the state.
		if (!existing) throw new NonRetriableError(`night ${id}: a continued night needs its night.json`);
		await buildBundle(ctx, scenarioDir, config.scenario_spec.bundle, paths);
		return result(existing);
	}
	if (existing) return result(existing);

	await buildBundle(ctx, scenarioDir, config.scenario_spec.bundle, paths);
	const repo = await ExperimentRepo.open(paths.repo);
	let round0: NightJson["round0"];
	let seed: SeedInfo | null = null;
	if (input.seed) {
		const resolved = resolveSeed(root, config, input.seed);
		if ("refused" in resolved) throw new NonRetriableError(resolved.refused);
		seed = seedInfo(root, config, resolved.id, resolved.rescore);
		round0 = { exp_id: seedId(id), sha: seed.commit };
		await repo.alias(round0.exp_id, seed.commit);
	} else {
		const expId = starterId(id);
		round0 = { exp_id: expId, sha: await repo.importStarter(join(scenarioDir, "starter"), expId) };
	}
	const startedMs = Date.now();
	const lessonsFile = config.scenario_spec.lessons ? join(scenarioDir, config.scenario_spec.lessons) : undefined;
	const night: NightJson = {
		night_id: id,
		startedAt: new Date(startedMs).toISOString(),
		deadlineMs: deadlineAt(config.deadline, startedMs),
		round0,
		seed,
		config,
		metric_script_sha256: scoringHashes(root, scenarioDir),
		lessons_sha256: lessonsFile && existsSync(lessonsFile) ? [sha256(lessonsFile)] : [],
	};
	writeJson(paths.nightJson, night);
	return result(night);
}
