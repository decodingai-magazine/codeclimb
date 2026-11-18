// Seed and rescore without LangGraph: a night's state from its rows, seed resolution (spec: Continue, seed and rescore).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { weightedScore } from "../decision.ts";
import { isMockConfig, pendingRounds } from "../lessons.ts";
import { type ResultRow, readRows } from "../results.ts";
import { type NightPaths, nightPaths, readJson } from "./files.ts";
import type { PauseJson, PauseLogEntry } from "./pause.ts";
import { scoringHashes } from "./init.ts";
import type { NightJson, SeedInfo } from "./types.ts";
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
	// Its coders' lessons would be lost: the night applies lessons that lessons.md doesn't hold yet.
	const sc = pick.night.config;
	if (sc.lessons === "apply" && !isMockConfig(sc) && sc.scenario_spec.lessons && pendingRounds(root, sc, pick.id) > 0) {
		return { refused: `seed night ${pick.id} applies lessons that are not in lessons.md yet: run \`npm run lessons -- distill --config … --night ${pick.id} --apply\` first` };
	}
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
