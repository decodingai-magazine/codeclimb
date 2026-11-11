// Where a night's files live and how they are written (spec: Files a night writes).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface NightPaths {
	resultsDir: string;
	results: string;
	repo: string;
	nightDir: string;
	bundle: string;
	nightJson: string;
	doneJson: string;
	stopJson: string;
	pauseJson: string;
}

export function nightPaths(root: string, resultsPath: string, nightId: string): NightPaths {
	const results = join(root, resultsPath);
	const resultsDir = dirname(results);
	const nightDir = join(resultsDir, "nights", nightId);
	return {
		resultsDir,
		results,
		repo: join(resultsDir, "experiments.git"),
		nightDir,
		bundle: join(nightDir, "bundle"),
		nightJson: join(nightDir, "night.json"),
		doneJson: join(nightDir, "done.json"),
		stopJson: join(nightDir, "stop.json"),
		pauseJson: join(nightDir, "pause.json"),
	};
}

/** A night's folder, found by scanning `runs/*` and `runs/mock/*` (the stop input holds only the night id). A night in init has its folder before night.json. */
export function findNightDir(root: string, nightId: string): string | null {
	for (const base of [join(root, "runs"), join(root, "runs", "mock")]) {
		if (!existsSync(base)) continue;
		for (const name of readdirSync(base)) {
			const dir = join(base, name, "nights", nightId);
			if (existsSync(dir)) return dir;
		}
	}
	return null;
}

/** Write JSON whole, through a temporary file, so a reader never sees half a file. */
export function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
}

export function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export type StopReason = "manual" | "app" | "failed" | "cancelled";

/** Write `stop.json` unless the night has a `done.json` or a `stop.json` already: the first stop wins. Returns whether it wrote. */
export function writeStopIfMissing(nightDir: string, reason: StopReason, at = new Date()): boolean {
	if (existsSync(join(nightDir, "done.json"))) return false;
	mkdirSync(nightDir, { recursive: true });
	try {
		writeFileSync(join(nightDir, "stop.json"), `${JSON.stringify({ at: at.toISOString(), reason }, null, 2)}\n`, { flag: "wx" });
		return true;
	} catch {
		return false;
	}
}
