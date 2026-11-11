// The start input of a night's server run, and what the night records (spec: Control operations; Files a night writes).
import type { NightConfig } from "../config.ts";

export interface NightInput {
	night_id: string;
	config: NightConfig;
	mock: boolean;
	/** `--mock-offline N`: the coder's model calls 2 to N+1 of the first experiment fail. */
	mock_offline?: number;
	continue?: { rescore: boolean; direction?: string };
}

export interface NightJson {
	night_id: string;
	startedAt: string;
	deadlineMs: number;
	round0: { exp_id: string; sha: string };
	seed: null;
	config: NightConfig;
	metric_script_sha256: Record<string, string>;
	/** One per variation: the lessons.md its coders read. */
	lessons_sha256: string[];
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
