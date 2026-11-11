// The start input of a night's server run, and what the night records (spec: Control operations; Files a night writes).
import type { NightConfig } from "../config.ts";
import type { MockCredit } from "../pi/models.ts";

export interface NightInput {
	night_id: string;
	config: NightConfig;
	mock: boolean;
	/** `--mock-offline N`: the coder's model calls 2 to N+1 of the first experiment fail. */
	mock_offline?: number;
	/** Tests only, with `mock`: one scripted credit error (spec: Mock mode). */
	mock_credit?: MockCredit;
	/** The variation number: 0 at start, +1 per continue. */
	variation?: number;
	continue?: { rescore: boolean; direction?: string };
	/** `--seed`, resolved by the CLI to a night id. */
	seed?: string;
}

/** night.json's `seed`: what a seeded night starts from. */
export interface SeedInfo {
	night: string;
	exp_id: string;
	commit: string;
	round: number;
	primary: number;
	metrics: Record<string, number>;
	rescore: boolean;
}

export interface NightJson {
	night_id: string;
	startedAt: string;
	deadlineMs: number;
	round0: { exp_id: string; sha: string };
	seed: SeedInfo | null;
	config: NightConfig;
	metric_script_sha256: Record<string, string>;
	/** One per variation: the lessons.md its coders read. */
	lessons_sha256: string[];
	/** The config's `budget_usd.night` at the first continuation: every continuation adds it to the night's spend. */
	run_budget_usd?: number;
	/** The variation number: 0 at start, +1 per continue. */
	variation?: number;
	/** The last pause whose time was added to `deadlineMs`. */
	pausesApplied?: number;
}

export interface DoneJson {
	night_id: string;
	stop_reason: string;
	rounds: number;
	kept: { exp_id: string; commit: string; dev_score: number };
	test_metrics: Record<string, number> | null;
	spend_usd: number;
	leftover_sandboxes_destroyed: number;
	finished_at: string;
}

/** The server resolves the paths a config carries against this checkout. */
export const serverRoot = () => process.env.CODECLIMB_ROOT ?? process.cwd();
