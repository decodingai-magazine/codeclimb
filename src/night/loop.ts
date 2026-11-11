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
	reason: SoftStop | null;
}

export type SoftStop = "max_rounds" | "deadline" | "budget" | "tokens" | "plateau";

/** What the round-start check reads; the night carries it across rounds. */
export interface LoopState {
	spentUsd: number;
	tokens: number;
	maxRoundUsd: number;
	maxRoundTokens: number;
	/** The costliest single evaluation so far: the test evaluation's estimate. */
	maxEvalUsd: number;
	roundsWithoutKeep: number;
}

export const emptyLoop = (): LoopState => ({ spentUsd: 0, tokens: 0, maxRoundUsd: 0, maxRoundTokens: 0, maxEvalUsd: 0, roundsWithoutKeep: 0 });

/** The first five soft stops, in order; the first wins. */
export function softStop(config: NightConfig, s: LoopState, nextRound: number, now: number, deadlineMs: number): SoftStop | null {
	if (nextRound > config.max_rounds) return "max_rounds";
	if (now >= deadlineMs) return "deadline";
	if (s.spentUsd + s.maxRoundUsd + s.maxEvalUsd > config.budget_usd.night) return "budget";
	if (config.max_tokens !== undefined && s.tokens + s.maxRoundTokens > config.max_tokens) return "tokens";
	if (config.plateau_rounds > 0 && s.roundsWithoutKeep >= config.plateau_rounds) return "plateau";
	return null;
}

/** The round-start check: a hard stop on disk first, then the soft stops. */
export function stopCheck(paths: NightPaths, config: NightConfig, init: InitResult, nextRound: number, s: LoopState): StopCheck {
	if (existsSync(paths.stopJson)) return { hard: true, reason: null };
	return { hard: false, reason: softStop(config, s, nextRound, Date.now(), init.deadlineMs) };
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
