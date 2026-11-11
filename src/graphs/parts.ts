// Experiments and evaluations: plain functions inside the night's entrypoint that call steps (spec: Durable runtime on LangGraph).
import { isGraphInterrupt } from "@langchain/langgraph";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { type EvalRequest, type EvalResult, evaluate } from "../eval/evaluator.ts";
import type { NightPaths } from "../night/files.ts";
import { sandboxes } from "../night/sandboxes.ts";
import { isOwnFailure, step } from "../runtime/step.ts";
import { type CodeResult, runCoder } from "../coder/coder.ts";
import { checkpointScore } from "../coder/prompt.ts";
import { type Decision, decide, guardrails, marginFor, type Outcome } from "../decision.ts";
import { ExperimentRepo } from "../experiments.ts";
import { devEvalId, experimentId, sandboxPrefix } from "../ids.ts";
import type { Checkpoint, ExperimentFacts } from "../night/rows.ts";
import { buildTrajectory, type HistoryEntry } from "../night/memory.ts";

export interface EvalOutcome extends EvalResult {
	t_teardown: number;
	/** The evaluator run failed out of its retries: an error with no repair. */
	failed_out: boolean;
}

export interface EvalSpec {
	evalId: string;
	sandboxName: string;
	split: "dev" | "test";
	commit: string;
}

/** An error that is a pause or an abort of the server run travels on; anything else becomes an outcome. */
export function rethrowControl(error: unknown): void {
	if (isGraphInterrupt(error) || !isOwnFailure(error)) throw error;
}

/** One evaluation: the evaluate step, then the destroy step, which runs after a failed evaluation too. */
export async function runEvaluation(root: string, night: string, config: NightConfig, paths: NightPaths, spec: EvalSpec): Promise<EvalOutcome> {
	const scenario = config.scenario_spec;
	const req: EvalRequest = {
		night,
		evalId: spec.evalId,
		sandboxName: spec.sandboxName,
		split: spec.split,
		commit: spec.commit,
		repoDir: paths.repo,
		scenarioDir: join(root, config.scenario),
		scenario,
		image: scenario.image,
		evalMin: config.timeouts.eval_min,
		primary: config.primary_metric,
		evalDir: join(paths.nightDir, "evals", spec.evalId),
	};
	const backstopMin = config.timeouts.eval_min * scenario.stages.length * 3 + 15;
	let result: EvalResult & { failed_out: boolean };
	try {
		result = { ...(await step(`${spec.evalId}/evaluate`, (ctx) => evaluate(sandboxes, req, ctx.signal), { backstopMin, live: { id: spec.evalId, night } })()), failed_out: false };
	} catch (error) {
		rethrowControl(error);
		const message = error instanceof Error ? error.message : String(error);
		result = { ok: false, metrics: {}, error: message.slice(-2000), program_usd: 0, t_provision: 0, t_eval: 0, instance: "", failed_out: true };
	}
	const teardown = await step(`${spec.evalId}/destroy`, async () => {
		const t = Date.now();
		const sb = await sandboxes.find(spec.sandboxName);
		await sb?.destroy();
		return (Date.now() - t) / 1000;
	})();
	return { ...result, t_teardown: teardown };
}

export interface ExperimentSpec {
	round: number;
	checkpoint: Checkpoint;
	/** The reviewer's hypothesis for the round; none in round 1. */
	hypothesis: string | null;
	mock: boolean;
	/** The history lines so far, for the trajectory. */
	history: HistoryEntry[];
	/** The last experiment's errors, when it was never scored. */
	failures?: string;
	/** The noise margin's base: `fixed`, else the A/A move, else 0. */
	aaBase: number;
}

export interface ExperimentOutcome {
	expId: string;
	evalId: string;
	code: (CodeResult & { unchanged: boolean }) | null;
	evaluation: EvalOutcome | null;
	guardrails: string[];
	decision: Decision;
	facts: ExperimentFacts;
	/** The errors when it was never scored. */
	errors?: string;
}

/** One experiment: code, teardown, dev evaluation unless unchanged or uncommitted, decide (spec: Round loop). */
export async function runExperiment(root: string, night: string, config: NightConfig, paths: NightPaths, spec: ExperimentSpec): Promise<ExperimentOutcome> {
	const expId = experimentId(night, spec.round);
	const evalId = devEvalId(expId);
	const { checkpoint } = spec;
	type Coded = CodeResult & { unchanged: boolean };
	let code: Coded | null = null;
	let codeError: string | undefined;
	try {
		code = await step(
			`${expId}/code`,
			async (ctx): Promise<Coded> => {
				const result = await runCoder(
					sandboxes,
					{
						night,
						expId,
						round: spec.round,
						parentSha: checkpoint.commit,
						repoDir: paths.repo,
						bundleDir: paths.bundle,
						expDir: join(paths.nightDir, "exps", expId),
						config,
						mock: spec.mock,
						hypothesis: spec.hypothesis,
						checkpointMetrics: checkpoint.metrics,
						trajectory: buildTrajectory(paths.bundle, paths.nightDir, spec.history),
						...(spec.failures ? { failures: spec.failures } : {}),
					},
					ctx.signal,
				);
				const repo = await ExperimentRepo.open(paths.repo);
				return { ...result, unchanged: (await repo.treeOf(result.commit)) === (await repo.treeOf(checkpoint.commit)) };
			},
			{ backstopMin: config.timeouts.experiment_min * 3 + 30, live: { id: expId, night } },
		)();
	} catch (error) {
		rethrowControl(error);
		codeError = error instanceof Error ? error.message : String(error);
		console.error(`experiment ${expId} failed:`, error);
	}
	const coderTeardown = await step(`${expId}/teardown`, async () => {
		const t = Date.now();
		await (await sandboxes.find(`cc-${expId}`))?.destroy();
		return (Date.now() - t) / 1000;
	})();

	let evaluation: EvalOutcome | null = null;
	if (code && !code.unchanged) {
		evaluation = await runEvaluation(root, night, config, paths, { evalId, sandboxName: `${sandboxPrefix(night)}-r${spec.round}-eval`, split: "dev", commit: code.commit });
	}
	const fired = evaluation?.ok ? guardrails(evaluation.metrics, config.gates, 0) : [];
	const outcome: Outcome = !code
		? { kind: "failed" }
		: code.unchanged
			? { kind: "unchanged", checkpointMetrics: checkpoint.metrics }
			: !evaluation?.ok
				? { kind: "not_scored" }
				: { kind: "scored", metrics: evaluation.metrics, guardrails: fired };
	const decision = decide({
		outcome,
		primary: config.primary_metric,
		thresholds: config.thresholds,
		weights: config.weights,
		checkpointScore: checkpointScore(config, checkpoint.metrics),
		margin: marginFor(spec.aaBase, config.noise_margin, evaluation?.metrics ?? {}),
		aaBase: spec.aaBase,
		scaleByReplay: config.noise_margin.scale_by_replay,
	});
	const facts: ExperimentFacts = {
		expId,
		evalId,
		round: spec.round,
		parent: checkpoint,
		commit: code?.commit ?? checkpoint.commit,
		hypothesis: code?.hypothesis ?? spec.hypothesis,
		decision,
		coderUsd: code?.coderUsd ?? 0,
		devUsd: 0,
		programUsd: evaluation?.program_usd ?? 0,
		tokens: code?.tokens ?? 0,
		tProvision: (code?.tProvision ?? 0) + (evaluation?.t_provision ?? 0),
		tCode: code?.tCode ?? 0,
		tEval: evaluation?.t_eval ?? 0,
		tTeardown: coderTeardown + (evaluation?.t_teardown ?? 0),
		infraErrors: (code?.infraErrors ?? 0) + (evaluation?.failed_out ? 1 : 0),
		...(evaluation?.instance ? { instance: evaluation.instance } : {}),
	};
	const errors = !code ? codeError : evaluation && !evaluation.ok ? evaluation.error : undefined;
	return { expId, evalId, code, evaluation, guardrails: fired, decision, facts, ...(errors ? { errors } : {}) };
}
