// The nights as their files show them, for the worker API and the watchdog: no LangGraph, no Agent Server
// (spec: Worker API). Status comes from files, so the app doesn't depend on the stack.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isMockResults, RUNS_DIR } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import { readJson } from "../night/files.ts";
import type { PauseJson } from "../night/pause.ts";
import type { DoneJson, NightJson } from "../night/types.ts";
import { spendOf } from "../night/variation.ts";
import { readRows, type ResultRow } from "../results.ts";

/** A night with no file written for this long, and no end file, is `stale`. */
export const STALE_MS = 60 * 60_000;

export type NightStatus = "finished" | "stopped" | "paused" | "stale" | "running";

export interface NightEntry {
	id: string;
	dir: string;
	night: NightJson;
}

/**
 * Every night with a night.json of this build under `<root>/runs-langchain/*` and `<root>/runs-langchain/mock/*`.
 * The Inngest twin writes to `runs/`; a night.json of its kind (its scenario is an object, with no `scenario_spec`)
 * is left out anyway, so neither the app nor the watchdog touches one.
 */
export function listNights(root: string): NightEntry[] {
	const out: NightEntry[] = [];
	for (const base of [join(root, RUNS_DIR), join(root, RUNS_DIR, "mock")]) {
		if (!existsSync(base)) continue;
		for (const folder of readdirSync(base)) {
			const nights = join(base, folder, "nights");
			if (!existsSync(nights)) continue;
			for (const id of readdirSync(nights)) {
				const night = readJson<NightJson>(join(nights, id, "night.json"));
				if (typeof night?.config?.scenario === "string" && night.config.scenario_spec) out.push({ id, dir: join(nights, id), night });
			}
		}
	}
	return out;
}

/** The newest mtime in a night's folder, two levels deep (exps/<id>/code-state.json). */
function lastWrite(dir: string): number {
	let t = statSync(dir).mtimeMs;
	for (const a of readdirSync(dir)) {
		const p = join(dir, a);
		const s = statSync(p);
		t = Math.max(t, s.mtimeMs);
		if (s.isDirectory()) for (const b of readdirSync(p)) t = Math.max(t, statSync(join(p, b)).mtimeMs);
	}
	return t;
}

/** done.json → finished, stop.json → stopped, pause.json → paused, no file written for an hour → stale, else running. */
export function nightStatus(dir: string, now = Date.now()): NightStatus {
	if (existsSync(join(dir, "done.json"))) return "finished";
	if (existsSync(join(dir, "stop.json"))) return "stopped";
	if (existsSync(join(dir, "pause.json"))) return "paused";
	return now - lastWrite(dir) > STALE_MS ? "stale" : "running";
}

const rowsOf = (root: string, n: NightEntry) => readRows(join(root, n.night.config.results_path)).filter((r) => r.night_id === n.id);
const roundOfExp = (e: string) => Number(/-r(\d+)-e\d+$/.exec(e)?.[1] ?? 0);

export function summary(root: string, n: NightEntry, now = Date.now()) {
	const cfg = n.night.config;
	const done = readJson<DoneJson>(join(n.dir, "done.json"));
	const stop = readJson<{ at: string; reason: string }>(join(n.dir, "stop.json"));
	const pause = readJson<PauseJson>(join(n.dir, "pause.json"));
	const status = nightStatus(n.dir, now);
	const rows = rowsOf(root, n);
	const exps = existsSync(join(n.dir, "exps")) ? readdirSync(join(n.dir, "exps")) : [];
	const kept = rows.filter((r) => r.kind === "experiment" && r.decision === "keep").at(-1);
	return {
		id: n.id,
		scenario: cfg.scenario,
		mock: isMockResults(cfg.results_path),
		status,
		stop_reason: done?.stop_reason ?? stop?.reason ?? null,
		pause: status === "paused" ? pause : null,
		round: Math.max(0, ...exps.map(roundOfExp)),
		max_rounds: cfg.max_rounds,
		primary_metric: cfg.primary_metric,
		best: done?.kept.dev_score ?? kept?.metrics[cfg.primary_metric] ?? n.night.seed?.primary ?? null,
		best_exp: done?.kept.exp_id ?? kept?.exp_id ?? null,
		threshold: cfg.thresholds[cfg.primary_metric] ?? null,
		spend_usd: done?.spend_usd ?? Math.round(spendOf(rows) * 10_000) / 10_000,
		budget_usd: cfg.budget_usd.night,
		started_at: n.night.startedAt,
		deadline_at: new Date(n.night.deadlineMs).toISOString(),
		finished_at: done?.finished_at ?? null,
		variation: n.night.variation ?? 0,
	};
}

interface CodeStateFile {
	startedAt: string;
	coderUsd: number;
	devUsd: number;
	tokens: number;
	finishedAt?: string;
	stop?: string;
}

/** The summary, the current round's experiment, the night's row count (the app refetches the report when it changes) and the exportable experiments. */
export function live(root: string, n: NightEntry, now = Date.now()) {
	const s = summary(root, n, now);
	const rows = rowsOf(root, n);
	let current = null;
	if (s.round > 0 && (s.status === "running" || s.status === "paused")) {
		const attempt = (e: number) => `${n.id}-r${s.round}-e${e}`;
		// A repair takes over from e0 once its folder exists.
		const expId = attempt(existsSync(join(n.dir, "exps", attempt(1))) ? 1 : 0);
		const state = readJson<CodeStateFile>(join(n.dir, "exps", expId, "code-state.json"));
		const row = rows.find((r) => r.exp_id === expId && r.kind === "experiment");
		const phase = row ? "evaluated" : !state ? "starting" : state.finishedAt ? "waiting for eval" : "coding";
		const end = state?.finishedAt ? Date.parse(state.finishedAt) : now;
		current = {
			exp_id: expId,
			model: n.night.config.model,
			phase,
			elapsed_s: state ? Math.round((end - Date.parse(state.startedAt)) / 1000) : 0,
			coder_usd: state?.coderUsd ?? 0,
			dev_usd: state?.devUsd ?? 0,
			tokens: state?.tokens ?? 0,
		};
	}
	// Exportable: every committed experiment, newest first.
	const experiments = rows
		.filter((r) => r.kind === "experiment" && r.commit)
		.map((r) => ({ exp_id: r.exp_id, round: r.round, decision: r.decision, score: r.metrics[n.night.config.primary_metric] ?? null, hypothesis: r.hypothesis }))
		.reverse();
	return { ...s, current, rows: rows.length, experiments };
}

interface ReviewFile {
	feedback: string;
	hypothesis: string;
	verdict: string;
}

/** The night's rows, reviews, a config extract and each experiment's diff against its parent. */
export async function report(root: string, n: NightEntry) {
	const cfg = n.night.config;
	const rows: ResultRow[] = rowsOf(root, n);
	const reviewsDir = join(n.dir, "reviews");
	const reviews = existsSync(reviewsDir)
		? readdirSync(reviewsDir)
				.filter((f) => /^r\d+\.json$/.test(f))
				.map((f) => ({ round: Number(/^r(\d+)/.exec(f)?.[1]), ...readJson<ReviewFile>(join(reviewsDir, f)) }))
				.sort((a, b) => a.round - b.round)
		: [];
	const gitDir = join(root, cfg.results_path, "..", "experiments.git");
	const diffs: Record<string, string> = {};
	if (existsSync(gitDir)) {
		const repo = await ExperimentRepo.open(gitDir);
		for (const r of rows) {
			if (r.kind !== "experiment" || !r.commit || !r.parent_id || diffs[r.exp_id] !== undefined) continue;
			diffs[r.exp_id] = await repo.diff(`refs/exp/${r.parent_id}`, `refs/exp/${r.exp_id}`).catch(() => "");
		}
	}
	return {
		night: summary(root, n),
		config: {
			scenario: cfg.scenario,
			model: cfg.model,
			reviewer_model: cfg.reviewer_model,
			primary_metric: cfg.primary_metric,
			thresholds: cfg.thresholds,
			weights: cfg.weights,
			gates: cfg.gates,
			max_rounds: cfg.max_rounds,
			budget_usd: cfg.budget_usd,
			headline: cfg.scenario_spec.headline,
			stages: cfg.scenario_spec.stages.map((s) => s.name),
		},
		done: readJson<DoneJson>(join(n.dir, "done.json")),
		rows,
		reviews,
		diffs,
	};
}
