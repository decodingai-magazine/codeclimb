// Continue, seed and rescore without LangGraph: a night's state from its rows, the host-side reopen, seed resolution
// (spec: Continue, seed and rescore).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { deadlineAt, type NightConfig } from "../config.ts";
import { weightedScore } from "../decision.ts";
import { type ResultRow, readRows } from "../results.ts";
import { type NightPaths, nightPaths, readJson, writeJson } from "./files.ts";
import type { PauseJson, PauseLogEntry } from "./pause.ts";
import { scoringHashes } from "./init.ts";
import type { NightInput, NightJson, SeedInfo } from "./types.ts";
import type { Checkpoint } from "./rows.ts";

/** A rescore row: an `experiment` row with no model. */
export const isRescoreRow = (r: ResultRow) => r.kind === "experiment" && r.model === null;
export const RESCORE_HYPOTHESIS = "Rescore: the kept commit evaluated again on dev after the scoring changed";

const experimentRows = (rows: ResultRow[]) => rows.filter((r) => r.kind === "experiment");

/** The highest round among the night's experiment rows; 0 when it has none. */
export const lastRound = (rows: ResultRow[]) => experimentRows(rows).reduce((m, r) => Math.max(m, r.round), 0);

/** The night's last `keep` experiment row (a rescore row counts); else its round-0 commit, with the seed's metrics if seeded. */
export function keptOf(rows: ResultRow[], night: Pick<NightJson, "round0" | "seed">): Checkpoint & { kept: boolean } {
	const keep = experimentRows(rows).filter((r) => r.decision === "keep").pop();
	if (keep) return { exp_id: keep.exp_id, commit: keep.commit, metrics: keep.metrics, kept: true };
	return { exp_id: night.round0.exp_id, commit: night.round0.sha, metrics: night.seed?.metrics ?? {}, kept: night.seed !== null && night.seed !== undefined };
}

/** Spend over all the night's rows: coder + dev + program, plus each round's review once. */
export function spendOf(rows: ResultRow[]): number {
	const review = new Map<number, number>();
	let usd = 0;
	for (const r of rows) {
		usd += r.coder_usd + (r.dev_usd ?? 0) + r.program_usd;
		if (r.kind === "experiment") review.set(r.round, Math.max(review.get(r.round) ?? 0, r.reviewer_usd));
	}
	for (const v of review.values()) usd += v;
	return usd;
}

/** Every continuation's night budget: what the night spent plus the run budget kept from the first continuation. Never compounds. */
export const continuedBudget = (spentUsd: number, runBudgetUsd: number) => spentUsd + runBudgetUsd;

/** The highest pause number the night used: a new variation's pauses number on from it. */
export function pausesUsed(paths: NightPaths): number {
	const log = join(paths.nightDir, "pauses.jsonl");
	const logged = existsSync(log)
		? readFileSync(log, "utf8")
				.split("\n")
				.filter(Boolean)
				.map((l) => (JSON.parse(l) as PauseLogEntry).pause)
		: [];
	return Math.max(0, ...logged, readJson<PauseJson>(paths.pauseJson)?.pause ?? 0);
}

const sameHashes = (a: Record<string, string>, b: Record<string, string>) => {
	const ka = Object.keys(a).sort();
	return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

const lessonsHashes = (root: string, config: NightConfig): string[] => {
	const file = config.scenario_spec.lessons ? join(root, config.scenario, config.scenario_spec.lessons) : undefined;
	return file && existsSync(file) ? [createHash("sha256").update(readFileSync(file)).digest("hex")] : [];
};

export interface EndedNight {
	id: string;
	dir: string;
	night: NightJson;
	end: "done" | "stop";
}

/** The ended nights (done.json or stop.json, and a night.json) under a results directory, newest `startedAt` first. */
export function endedNights(resultsDir: string): EndedNight[] {
	const base = join(resultsDir, "nights");
	if (!existsSync(base)) return [];
	const out: EndedNight[] = [];
	for (const id of readdirSync(base)) {
		const dir = join(base, id);
		const night = readJson<NightJson>(join(dir, "night.json"));
		const end = existsSync(join(dir, "done.json")) ? "done" : existsSync(join(dir, "stop.json")) ? "stop" : null;
		if (night && end) out.push({ id, dir, night, end });
	}
	// A night whose startedAt doesn't read as a time sorts last.
	const at = (n: EndedNight) => new Date(n.night.startedAt).getTime() || 0;
	return out.sort((a, b) => at(b) - at(a));
}

export type Refusal = { refused: string };

/** `latest`, `best` or an id → the seed night's id, under the config's own results directory. */
export function resolveSeed(root: string, config: NightConfig, which: string): { id: string; rescore: boolean } | Refusal {
	const paths = nightPaths(root, config.results_path, "_");
	const ended = endedNights(paths.resultsDir);
	const rows = readRows(paths.results);
	const kept = (n: EndedNight) => keptOf(rows.filter((r) => r.night_id === n.id), n.night);
	const current = scoringHashes(root, join(root, config.scenario));
	let pick: EndedNight | undefined;
	if (which === "latest") pick = ended[0];
	else if (which === "best") {
		const same = ended.filter((n) => n.night.config.scenario === config.scenario && sameHashes(n.night.metric_script_sha256, current) && kept(n).kept);
		let best = -1;
		// Newest first, so a strict > lets a tie go to the newer night.
		for (const n of same) {
			const s = weightedScore(kept(n).metrics, config.thresholds, config.weights);
			if (s > best) [best, pick] = [s, n];
		}
	} else pick = ended.find((n) => n.id === which);
	if (!pick) return { refused: which === "latest" || which === "best" ? `no ended night under ${paths.resultsDir} to seed from (${which})` : `night ${which} is not an ended night under ${paths.resultsDir}` };
	if (!kept(pick).kept) return { refused: `seed night ${pick.id} kept nothing` };
	return { id: pick.id, rescore: !sameHashes(pick.night.metric_script_sha256, current) };
}

/** The seed's record for night.json: the seed night, its kept experiment and commit, its last round and its metrics. */
export function seedInfo(root: string, config: NightConfig, seedNight: string, rescore: boolean): SeedInfo {
	const paths = nightPaths(root, config.results_path, seedNight);
	const night = readJson<NightJson>(paths.nightJson);
	if (!night) throw new Error(`seed night ${seedNight}: night.json is missing`);
	const rows = readRows(paths.results).filter((r) => r.night_id === seedNight);
	const k = keptOf(rows, night);
	return { night: seedNight, exp_id: k.exp_id, commit: k.commit, round: lastRound(rows), primary: k.metrics[config.primary_metric] ?? 0, metrics: k.metrics, rescore };
}

export interface ReopenOptions {
	/** Rounds to add; default the config's `max_rounds`. */
	rounds?: number;
	direction?: string;
	mock: boolean;
}

/**
 * Reopen an ended night for one more variation, before its server run exists (spec: Continue). In order: refusals, the
 * files of rounds past the last recorded one moved aside, the end file renamed, then night.json rewritten. Returns the
 * start input of the variation.
 */
export function reopenNight(root: string, nightId: string, config: NightConfig, o: ReopenOptions, now = new Date()): NightInput | Refusal {
	const paths = nightPaths(root, config.results_path, nightId);
	const night = readJson<NightJson>(paths.nightJson);
	if (!night) return { refused: `night ${nightId} has no night.json under ${paths.resultsDir}: it can't be continued` };
	const end = existsSync(paths.doneJson) ? "done" : existsSync(paths.stopJson) ? "stop" : null;
	if (!end) return { refused: `night ${nightId} has not ended (no done.json or stop.json): it may be running` };
	if (night.config.scenario !== config.scenario) return { refused: `night ${nightId} ran ${night.config.scenario}, not ${config.scenario}` };

	const rows = readRows(paths.results).filter((r) => r.night_id === nightId);
	const last = lastRound(rows);
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	// Files of rounds past the last recorded one (a night that failed mid-round): that round reruns from scratch.
	const aside = join(paths.nightDir, "unfinished", `after-r${last}-${stamp}`);
	// An evaluation with a row stays: a noise run at the start of the unfinished round is recorded, and noise.json stands.
	const recorded = new Set(rows.map((r) => r.eval_id));
	// The round a file belongs to: a noise run's is the round it ran in (`<exp>-noise-r<N>`), else the first `-r<N>-`.
	const roundOf = (name: string) => Number(/-noise-r(\d+)$/.exec(name)?.[1] ?? /-r(\d+)-/.exec(`${name}-`)?.[1] ?? /^r(\d+)[.-]/.exec(name)?.[1] ?? Number.NaN);
	const move = (path: string) => {
		const to = join(aside, relative(paths.nightDir, path));
		mkdirSync(dirname(to), { recursive: true });
		renameSync(path, to);
	};
	for (const sub of ["exps", "evals", "reviews", join("bundle", "history", "notes"), join("bundle", "history")]) {
		const dir = join(paths.nightDir, sub);
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			const n = roundOf(name.startsWith(`${nightId}-`) ? name.slice(nightId.length) : name);
			if (Number.isFinite(n) && n > last) move(join(dir, name));
		}
	}
	const endFile = end === "done" ? paths.doneJson : paths.stopJson;
	const renamed = join(paths.nightDir, `${end}-r${last}.json`);
	renameSync(endFile, existsSync(renamed) ? join(paths.nightDir, `${end}-r${last}-${stamp}.json`) : renamed);

	const current = scoringHashes(root, join(root, config.scenario));
	const rescore = !sameHashes(night.metric_script_sha256, current);
	const runBudget = night.run_budget_usd ?? config.budget_usd.night;
	const variation = (night.variation ?? 0) + 1;
	const next: NightConfig = {
		...config,
		max_rounds: last + (o.rounds ?? config.max_rounds) + (rescore ? 1 : 0),
		budget_usd: { ...config.budget_usd, night: continuedBudget(spendOf(rows), runBudget) },
	};
	writeJson(paths.nightJson, {
		...night,
		deadlineMs: deadlineAt(next.deadline, now.getTime()),
		config: next,
		metric_script_sha256: current,
		lessons_sha256: [...night.lessons_sha256, ...lessonsHashes(root, next)],
		run_budget_usd: runBudget,
		variation,
	} satisfies NightJson);
	return { night_id: nightId, config: next, mock: o.mock, variation, continue: { rescore, ...(o.direction ? { direction: o.direction } : {}) } };
}
