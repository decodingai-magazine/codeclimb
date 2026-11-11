// Experiments and evaluations: plain functions inside the night's entrypoint that call steps (spec: Durable runtime on LangGraph).
import { isGraphInterrupt } from "@langchain/langgraph";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { type EvalRequest, type EvalResult, evaluate } from "../eval/evaluator.ts";
import type { NightPaths } from "../night/files.ts";
import { sandboxes } from "../night/sandboxes.ts";
import { isOwnFailure, step } from "../runtime/step.ts";

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
