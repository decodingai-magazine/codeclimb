// Experiments and evaluations: plain functions inside the night's entrypoint that call steps (spec: Durable runtime on LangGraph).
import { isGraphInterrupt } from "@langchain/langgraph";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { type EvalRequest, type EvalResult, evaluate } from "../eval/evaluator.ts";
import type { NightPaths } from "../night/files.ts";
import { sandboxes } from "../night/sandboxes.ts";
import { isOwnFailure, step } from "../runtime/step.ts";
import { closeLedger, openLedger, proxyPort } from "../meter/proxy.ts";
import { ensureMeterPath, METER_NETWORK, meterEnv } from "../meter/relay.ts";
import { type CodeResult, runCoder } from "../coder/coder.ts";
import { checkpointScore } from "../coder/prompt.ts";
import { type Decision, decide, guardrails, marginFor, outcomeOf } from "../decision.ts";
import { ExperimentRepo } from "../experiments.ts";
import { devEvalId, experimentId, sandboxPrefix } from "../ids.ts";
import type { Checkpoint, ExperimentFacts } from "../night/rows.ts";
import { buildTrajectory, type HistoryEntry } from "../night/memory.ts";
import type { CreditStop } from "../night/pause.ts";
import type { Pauses } from "./pause.ts";
import { writeJson } from "../night/files.ts";
import { addedLines, checkCommit, distinctNames, scanText } from "../night/scan.ts";
import { withRoot } from "../spans.ts";
import { mirroredKeys, mirrorScores } from "../tracing.ts";

export interface EvalOutcome extends EvalResult {
	/** A credit stop of this attempt: the night pauses and reruns the evaluation. */
	credit?: CreditStop;
	t_teardown: number;
	/** The evaluator run failed out of its retries: an error with no repair. */
	failed_out: boolean;
}

export interface EvalSpec {
	evalId: string;
	sandboxName: string;
	split: "dev" | "test";
	commit: string;
	mock: boolean;
	/** The night's budget left when the evaluation starts: its meter token's cap. */
	capUsd: number;
	/** The A/A run: no replayed calls, nothing cached. */
	noCache?: boolean;
	/** The round it runs in, for a pause. */
	round: number;
	pauses: Pauses;
	/** The experiment it evaluates, for its trace root's metadata. */
	expId?: string;
	/** The experiment's trace root (a dev evaluation of an experiment): its scores are mirrored there as feedback. */
	traceRun?: string;
}

/** An error that is a pause or an abort of the server run travels on; anything else becomes an outcome. */
export function rethrowControl(error: unknown): void {
	if (isGraphInterrupt(error) || !isOwnFailure(error)) throw error;
}

/** One evaluation: the evaluate step, then the destroy step, which runs after a failed evaluation too. A credit stop pauses the night, then both rerun as `-resume<n>` under the same `eval_id`. */
export async function runEvaluation(root: string, night: string, config: NightConfig, paths: NightPaths, spec: EvalSpec): Promise<EvalOutcome> {
	let suffix = "";
	let pausedUsd = 0;
	let teardown = 0;
	for (;;) {
		const attempt = await evaluateOnce(root, night, config, paths, spec, suffix);
		teardown += attempt.t_teardown;
		if (!attempt.credit) return { ...attempt, program_usd: attempt.program_usd + pausedUsd, t_teardown: teardown };
		pausedUsd += attempt.program_usd;
		suffix = await spec.pauses.pause(spec.round, `the evaluation ${spec.evalId} of round ${spec.round}`, attempt.credit);
	}
}

async function evaluateOnce(root: string, night: string, config: NightConfig, paths: NightPaths, spec: EvalSpec, suffix: string): Promise<EvalOutcome> {
	const scenario = config.scenario_spec;
	const sandboxName = `${spec.sandboxName}${suffix}`;
	const req: EvalRequest = {
		night,
		evalId: spec.evalId,
		sandboxName,
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
	let result: EvalResult & { failed_out: boolean; credit?: CreditStop };
	try {
		result = {
			failed_out: false,
			...(await step(
				`${spec.evalId}/evaluate${suffix}`,
				(ctx) => withRoot(spec.evalId, { night_id: night, ...(spec.expId ? { exp_id: spec.expId } : {}) }, async (): Promise<EvalResult & { credit?: CreditStop }> => {
					const r = await evaluateMetered(night, config, spec, req, ctx.signal);
					// Never awaited: a feedback call that fails or hangs must not hold the step.
					if (r.ok && spec.split === "dev" && spec.traceRun) void mirrorScores(spec.traceRun, spec.evalId, r.metrics, mirroredKeys(r.metrics, config.primary_metric, scenario.headline));
					return r;
				}),
				{ backstopMin, live: { id: spec.evalId, night } },
			)()),
		};
	} catch (error) {
		rethrowControl(error);
		const message = error instanceof Error ? error.message : String(error);
		result = { ok: false, metrics: {}, error: message.slice(-2000), program_usd: 0, t_provision: 0, t_eval: 0, instance: "", failed_out: true };
	}
	const teardown = await step(`${spec.evalId}/destroy${suffix}`, async () => {
		const t = Date.now();
		const sb = await sandboxes.find(sandboxName);
		await sb?.destroy();
		return (Date.now() - t) / 1000;
	})();
	return { ...result, t_teardown: teardown };
}

/** The evaluator run, through the metering proxy on a metered night; a credit stop ends it with no score. */
async function evaluateMetered(night: string, config: NightConfig, spec: EvalSpec, req: EvalRequest, signal: AbortSignal): Promise<EvalResult & { credit?: CreditStop }> {
	const scenario = config.scenario_spec;
	if (!config.allowed_models.length) return evaluate(sandboxes, req, signal);
	const port = await proxyPort();
	const checkMeterPath = () => ensureMeterPath(scenario.image, port);
	await checkMeterPath();
	// The first credit call ends the stage: the evaluation reports no score, and the night pauses.
	let credit: CreditStop | undefined;
	const stage = new AbortController();
	const ledger = openLedger(night, {
		id: spec.evalId,
		allowedModels: config.allowed_models,
		capUsd: spec.capUsd,
		mock: spec.mock,
		...(spec.noCache ? { noCache: true } : {}),
		onCreditStop: (s) => {
			credit ??= s;
			stage.abort(new Error(`credit stop: ${s.message}`));
		},
	});
	const creditResult = (): EvalResult & { credit: CreditStop } => ({ ok: false, metrics: {}, error: `credit stop: ${credit?.message}`, program_usd: ledger.spentUsd, t_provision: 0, t_eval: 0, instance: "", credit: credit as CreditStop });
	try {
		const r = await evaluate(sandboxes, { ...req, network: METER_NETWORK, meterEnv: meterEnv(ledger.token), ledgerCalls: () => closeLedger(ledger), checkMeterPath }, AbortSignal.any([signal, stage.signal]));
		return credit ? creditResult() : r;
	} catch (error) {
		if (credit && !signal.aborted) return creditResult();
		throw error;
	} finally {
		closeLedger(ledger);
	}
}

export interface ExperimentSpec {
	round: number;
	checkpoint: Checkpoint;
	/** The reviewer's hypothesis for the round; none in round 1. A repair keeps its failed attempt's. */
	hypothesis: string | null;
	mock: boolean;
	/** The history lines so far, for the trajectory. */
	history: HistoryEntry[];
	/** The last experiment's masked errors, when it was never scored; for a repair, its own. */
	failures?: string;
	/** The noise margin's base: `fixed`, else the A/A move, else 0. */
	aaBase: number;
	/** The night's spend so far. */
	spentUsd: number;
	pauses: Pauses;
	/** The operator's direction, masked. */
	direction?: string;
	/** A repair `e1`: it starts from the failed commit, and its leak scan covers what it adds over it. */
	repairOf?: { commit: string };
}

export interface ExperimentOutcome {
	expId: string;
	evalId: string;
	code: Coded | null;
	evaluation: EvalOutcome | null;
	guardrails: string[];
	decision: Decision;
	facts: ExperimentFacts;
	/** The errors when it was never scored. */
	errors?: string;
	/** It has a commit, changed files, and `check` errors or a failed evaluation that was not out of retries. */
	repairable: boolean;
}

/** A coder's result, with its tree compared to the commit its sandbox started from and to the checkpoint. */
export type Coded = CodeResult & { unchanged: boolean; differs: boolean; trace_run?: string };

interface Checked {
	errors: string[];
	notes: string[];
	/** Distinct held-out names in the commit's added lines. */
	heldOut: number;
	/** The check command itself failed: an error with no repair. */
	failed?: string;
}

/** One experiment: code, teardown, check and leak scan, dev evaluation unless unchanged or blocked, decide (spec: Round loop). */
export async function runExperiment(root: string, night: string, config: NightConfig, paths: NightPaths, spec: ExperimentSpec): Promise<ExperimentOutcome> {
	const repair = spec.repairOf !== undefined;
	const expId = experimentId(night, spec.round, repair);
	const evalId = devEvalId(expId);
	const { checkpoint } = spec;
	const startSha = spec.repairOf?.commit ?? checkpoint.commit;
	const scenarioDir = join(root, config.scenario);
	let code: Coded | null = null;
	let codeError: string | undefined;
	let coderTeardown = 0;
	// A credit stop: the partial work is committed, the sandbox goes, the night pauses; then the coder carries on its session as `-resume<n>`.
	for (let suffix = ""; ; ) {
		code = null;
		try {
			code = await step(
				`${expId}/code${suffix}`,
				(ctx) => withRoot(expId, { night_id: night, exp_id: expId }, async (traceRun): Promise<Coded> => {
					const result = await runCoder(
						sandboxes,
						{
							night,
							expId,
							round: spec.round,
							parentSha: checkpoint.commit,
							...(repair ? { startSha, repair: true } : {}),
							repoDir: paths.repo,
							bundleDir: paths.bundle,
							expDir: join(paths.nightDir, "exps", expId),
							config,
							mock: spec.mock,
							hypothesis: spec.hypothesis,
							checkpointMetrics: checkpoint.metrics,
							trajectory: buildTrajectory(paths.bundle, paths.nightDir, spec.history),
							...(spec.failures ? { failures: spec.failures } : {}),
							...(spec.direction ? { direction: spec.direction } : {}),
						},
						ctx.signal,
					);
					const repo = await ExperimentRepo.open(paths.repo);
					const tree = await repo.treeOf(result.commit);
					return { ...result, unchanged: tree === (await repo.treeOf(startSha)), differs: tree !== (await repo.treeOf(checkpoint.commit)), ...(traceRun ? { trace_run: traceRun } : {}) };
				}),
				{ backstopMin: config.timeouts.experiment_min * 3 + 30, live: { id: expId, night } },
			)();
		} catch (error) {
			rethrowControl(error);
			codeError = error instanceof Error ? error.message : String(error);
			console.error(`experiment ${expId} failed:`, error);
		}
		coderTeardown += await step(`${expId}/teardown${suffix}`, async () => {
			const t = Date.now();
			await (await sandboxes.find(`cc-${expId}`))?.destroy();
			return (Date.now() - t) / 1000;
		})();
		if (!code?.credit) break;
		suffix = await spec.pauses.pause(spec.round, `the experiment ${expId} of round ${spec.round}`, code.credit);
	}

	// Check and leak scan, on the host: skipped with no commit or with unchanged files.
	let checked: Checked = { errors: [], notes: [], heldOut: 0 };
	if (code && !code.unchanged) {
		const commit = code.commit;
		checked = await step(`${expId}/check`, async (ctx): Promise<Checked> => {
			const repo = await ExperimentRepo.open(paths.repo);
			const scenario = config.scenario_spec;
			let report: Checked = { errors: [], notes: [], heldOut: 0 };
			if (scenario.check) {
				try {
					report = { ...(await checkCommit(scenarioDir, scenario.check, repo, commit, ctx.signal)), heldOut: 0 };
				} catch (error) {
					if (ctx.signal.aborted) throw error;
					report = { errors: [], notes: [], heldOut: 0, failed: `the check failed: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
			const found = await scanText({ scenarioDir, ...(scenario.scan ? { scan: scenario.scan } : {}), signal: ctx.signal }, await addedLines(repo, startSha, commit));
			report.heldOut = distinctNames(found);
			if (scenario.check || scenario.scan) writeJson(join(paths.nightDir, "exps", expId, "check.json"), { errors: report.errors, notes: report.notes, held_out_names: report.heldOut, ...(report.failed ? { failed: report.failed } : {}) });
			return report;
		})();
	}
	const blocked = checked.errors.length > 0 || checked.failed !== undefined;

	let evaluation: EvalOutcome | null = null;
	if (code && !code.unchanged && !blocked) {
		evaluation = await runEvaluation(root, night, config, paths, { evalId, sandboxName: `${sandboxPrefix(night)}-r${spec.round}-eval${repair ? "1" : ""}`, split: "dev", commit: code.commit, mock: spec.mock, capUsd: config.budget_usd.night - spec.spentUsd - code.coderUsd - code.devUsd, round: spec.round, pauses: spec.pauses, expId, ...(code.trace_run ? { traceRun: code.trace_run } : {}) });
	}
	const fired = evaluation?.ok ? guardrails(evaluation.metrics, config.gates, checked.heldOut) : [];
	const { outcome, repairable } = outcomeOf(
		{
			committed: code !== null,
			unchanged: code?.unchanged === true,
			checkErrors: checked.errors.length > 0,
			checkFailed: checked.failed !== undefined,
			evaluation: evaluation && { ok: evaluation.ok, failedOut: evaluation.failed_out, metrics: evaluation.metrics },
			guardrails: fired,
		},
		checkpoint.metrics,
	);
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
		devUsd: code?.devUsd ?? 0,
		programUsd: evaluation?.program_usd ?? 0,
		tokens: code?.tokens ?? 0,
		tProvision: (code?.tProvision ?? 0) + (evaluation?.t_provision ?? 0),
		tCode: code?.tCode ?? 0,
		tEval: evaluation?.t_eval ?? 0,
		tTeardown: coderTeardown + (evaluation?.t_teardown ?? 0),
		infraErrors: (code?.infraErrors ?? 0) + (evaluation?.failed_out ? 1 : 0),
		...(evaluation?.instance ? { instance: evaluation.instance } : {}),
	};
	const checkErrors = checked.failed ?? (checked.errors.length ? `check errors:\n${checked.errors.map((e) => `- ${e}`).join("\n")}` : undefined);
	const errors = !code ? codeError : (checkErrors ?? (evaluation && !evaluation.ok ? evaluation.error : undefined));
	return { expId, evalId, code, evaluation, guardrails: fired, decision, facts, repairable, ...(errors ? { errors } : {}) };
}
