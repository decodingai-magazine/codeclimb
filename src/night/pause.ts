// Step bodies of a pause for credits: no LangGraph (spec: Pause for credits; Files a night writes).
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type NightPaths, readJson, writeJson } from "./files.ts";
import type { NightJson } from "./types.ts";

export const PAUSE_TIMEOUT_S = 3 * 24 * 3600;
export const VARIATION_TIMEOUT_S = 4 * 24 * 3600;

const CREDIT = /\b402\b|payment required|insufficient (credits|quota|funds|balance)|credit balance|out of (credits|budget)|quota (exceeded|exhausted)|usage limit reached|key limit exceeded|billing/i;
/** A credit or quota message: a 429 rate limit is not one. */
export const isCreditMessage = (s: string) => CREDIT.test(s);

export interface CreditStop {
	who: "coder" | "reviewer" | "program";
	model: string;
	message: string;
}

export interface PauseStop extends CreditStop {
	/** The step that stopped: the experiment, the evaluation, or the review of round N. */
	where: string;
}

export interface PauseJson {
	pause: number;
	at: string;
	round: number;
	stops: PauseStop[];
}

export interface PauseLogEntry extends PauseJson {
	resumed_at: string;
	paused_ms: number;
}

const logPath = (paths: NightPaths) => join(paths.nightDir, "pauses.jsonl");

function readLog(paths: NightPaths): PauseLogEntry[] {
	if (!existsSync(logPath(paths))) return [];
	return readFileSync(logPath(paths), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as PauseLogEntry);
}

/** Write pause.json. A retry rewrites it with the time of the first write. */
export function beginPause(paths: NightPaths, p: Omit<PauseJson, "at">, now = new Date()): PauseJson {
	const prior = readJson<PauseJson>(paths.pauseJson);
	const pause: PauseJson = { ...p, at: prior?.pause === p.pause ? prior.at : now.toISOString() };
	writeJson(paths.pauseJson, pause);
	return pause;
}

export interface NightJsonWithPauses extends NightJson {
	/** The last pause whose time was added to `deadlineMs`. */
	pausesApplied?: number;
}

export type EndPause = { stopped: true } | { stopped: false; deadlineMs: number };

/**
 * End pause `n`, safe to retry: log it once to pauses.jsonl, add its paused time to `deadlineMs` in night.json once,
 * delete pause.json. A night stopped while paused stays stopped.
 */
export function endPause(paths: NightPaths, n: number, now = new Date()): EndPause {
	if (existsSync(paths.stopJson) || existsSync(paths.doneJson)) return { stopped: true };
	let entry = readLog(paths).find((e) => e.pause === n);
	if (!entry) {
		const pause = readJson<PauseJson>(paths.pauseJson);
		if (!pause || pause.pause !== n) throw new Error(`pause ${n}: no pause.json for it and no log entry`);
		entry = { ...pause, resumed_at: now.toISOString(), paused_ms: Math.max(0, now.getTime() - Date.parse(pause.at)) };
		appendFileSync(logPath(paths), `${JSON.stringify(entry)}\n`);
	}
	const night = readJson<NightJsonWithPauses>(paths.nightJson);
	if (!night) throw new Error(`pause ${n}: night.json is missing`);
	if ((night.pausesApplied ?? 0) < n) {
		night.deadlineMs += entry.paused_ms;
		night.pausesApplied = n;
		writeJson(paths.nightJson, night);
	}
	if (readJson<PauseJson>(paths.pauseJson)?.pause === n) rmSync(paths.pauseJson, { force: true });
	return { stopped: false, deadlineMs: night.deadlineMs };
}
