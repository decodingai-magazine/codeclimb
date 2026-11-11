// Step bodies of the round loop that hold no LangGraph: the stop check and the finish (spec: Round loop; Stops).
import { existsSync } from "node:fs";
import type { NightConfig } from "../config.ts";
import { sandboxPrefix } from "../ids.ts";
import { type NightPaths, readJson, writeJson } from "./files.ts";
import { sandboxes } from "./sandboxes.ts";
import type { InitResult } from "./init.ts";
import type { DoneJson } from "./types.ts";

export interface StopCheck {
	/** A stop.json is on disk: a hard stop is already cleaning up; end quietly. */
	hard: boolean;
	reason: string | null;
}

/** The round-start check: a hard stop on disk first, then the soft stops in their order. */
export function stopCheck(paths: NightPaths, config: NightConfig, init: InitResult, nextRound: number): StopCheck {
	if (existsSync(paths.stopJson)) return { hard: true, reason: null };
	if (nextRound > config.max_rounds) return { hard: false, reason: "max_rounds" };
	if (Date.now() >= init.deadlineMs) return { hard: false, reason: "deadline" };
	return { hard: false, reason: null };
}

/** Every threshold metric of the checkpoint is present and at least its target. */
export function thresholdsMet(config: NightConfig, metrics: Record<string, number>): boolean {
	return Object.entries(config.thresholds).every(([name, target]) => typeof metrics[name] === "number" && (metrics[name] as number) >= target);
}

export interface FinishInput {
	nightId: string;
	stopReason: string;
	rounds: number;
	kept: DoneJson["kept"];
	testMetrics: DoneJson["test_metrics"];
	spendUsd: number;
}

/** Sweep the night's sandboxes, then write done.json (unless a stop came first). Rewriting it is harmless. */
export async function finishNight(paths: NightPaths, f: FinishInput): Promise<DoneJson | null> {
	const prior = readJson<DoneJson>(paths.doneJson);
	if (prior) return prior;
	const destroyed = await sandboxes.sweep({ prefix: sandboxPrefix(f.nightId) });
	if (existsSync(paths.stopJson)) return null;
	const done: DoneJson = {
		night_id: f.nightId,
		stop_reason: f.stopReason,
		rounds: f.rounds,
		kept: f.kept,
		test_metrics: f.testMetrics,
		spend_usd: Math.round(f.spendUsd * 1e4) / 1e4,
		leftover_sandboxes_destroyed: destroyed,
		finished_at: new Date().toISOString(),
	};
	writeJson(paths.doneJson, done);
	return done;
}
