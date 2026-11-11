// Builders of result rows that are not experiments (spec: Result row, Rows that are not experiments).
import type { NightConfig } from "../config.ts";
import type { ResultRow } from "../results.ts";

export interface Checkpoint {
	exp_id: string;
	commit: string;
	/** The dev metrics of its own evaluation; empty for the unscored starter. */
	metrics: Record<string, number>;
}

export interface EvalFacts {
	ok: boolean;
	metrics: Record<string, number>;
	program_usd: number;
	t_provision: number;
	t_eval: number;
	t_teardown: number;
	instance: string;
}

/** A noise or test row: the checkpoint's exp_id and commit, coder fields 0, a failed evaluation recorded as `error` with the primary at 0. */
export function evaluationRow(night: string, config: NightConfig, kind: "noise" | "test", evalId: string, round: number, checkpoint: Checkpoint, e: EvalFacts, extra: Partial<ResultRow> = {}): ResultRow {
	return {
		night_id: night,
		exp_id: checkpoint.exp_id,
		parent_id: null,
		eval_id: evalId,
		round,
		stack: "langchain",
		backend: "docker",
		kind,
		split: kind === "test" ? "test" : "dev",
		model: null,
		reviewer_model: config.reviewer_model,
		hypothesis: kind === "test" ? null : "A/A run: the checkpoint evaluated again on dev, with no replayed model calls",
		commit: checkpoint.commit,
		metrics: e.ok ? e.metrics : { [config.primary_metric]: 0 },
		decision: e.ok ? "keep" : "error",
		coder_usd: 0,
		dev_usd: 0,
		program_usd: e.program_usd,
		reviewer_usd: 0,
		tokens: 0,
		wall_s: e.t_provision + e.t_eval + e.t_teardown,
		t_provision: e.t_provision,
		t_code: 0,
		t_eval: e.t_eval,
		t_review: 0,
		t_teardown: e.t_teardown,
		infra_errors: e.ok ? 0 : 1,
		...(e.instance ? { evaluator_instance: e.instance } : {}),
		...extra,
	};
}
