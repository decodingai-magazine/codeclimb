// Builders of result rows (spec: Result row; Rows that are not experiments).
import type { NightConfig } from "../config.ts";
import type { Decision } from "../decision.ts";
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

export interface ExperimentFacts {
	expId: string;
	evalId: string;
	round: number;
	parent: Checkpoint;
	/** The experiment's commit; the parent's when the coder failed before committing. */
	commit: string;
	hypothesis: string | null;
	decision: Decision;
	coderUsd: number;
	devUsd: number;
	programUsd: number;
	tokens: number;
	tProvision: number;
	tCode: number;
	tEval: number;
	tTeardown: number;
	infraErrors: number;
	instance?: string;
}

/** An experiment row (spec: Result row). */
export function experimentRow(night: string, config: NightConfig, f: ExperimentFacts): ResultRow {
	const d = f.decision;
	return {
		night_id: night,
		exp_id: f.expId,
		parent_id: f.parent.exp_id,
		eval_id: f.evalId,
		round: f.round,
		stack: "langchain",
		backend: "docker",
		kind: "experiment",
		split: "dev",
		model: config.model,
		reviewer_model: config.reviewer_model,
		hypothesis: f.hypothesis,
		commit: f.commit,
		metrics: d.metrics,
		decision: d.decision,
		...(d.score !== undefined ? { score: d.score } : {}),
		decision_reason: d.reason,
		coder_usd: f.coderUsd,
		dev_usd: f.devUsd,
		program_usd: f.programUsd,
		reviewer_usd: 0,
		tokens: f.tokens,
		wall_s: f.tProvision + f.tCode + f.tEval + f.tTeardown,
		t_provision: f.tProvision,
		t_code: f.tCode,
		t_eval: f.tEval,
		t_review: 0,
		t_teardown: f.tTeardown,
		infra_errors: f.infraErrors,
		...(f.instance ? { evaluator_instance: f.instance } : {}),
		...(d.unchanged ? { unchanged: true } : {}),
	};
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
