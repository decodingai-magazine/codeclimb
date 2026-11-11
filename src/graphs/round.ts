// One round after its stop check: experiment, review, record, learn, keep (spec: Round loop).
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import type { NightPaths } from "../night/files.ts";
import { buildTrajectory, type Guidance, type HistoryEntry, historyLine, movesText, nextGuidance, notePath, noteText, rejectedDiffPath, writeFileAtomic } from "../night/memory.ts";
import { type Checkpoint, evaluationRow, experimentRow } from "../night/rows.ts";
import { appendRow } from "../results.ts";
import { type ReviewResult, runReview } from "../review/reviewer.ts";
import { step } from "../runtime/step.ts";
import { rethrowControl, runEvaluation, runExperiment } from "./parts.ts";
import { aaMove, type NoiseState, noiseDue, weightedScore } from "../decision.ts";
import { devEvalId, experimentId, noiseEvalId, sandboxPrefix } from "../ids.ts";
import { RESCORE_HYPOTHESIS } from "../night/variation.ts";
import { writeJson } from "../night/files.ts";
import type { Pauses } from "./pause.ts";
import { existsSync } from "node:fs";
import { type LoopState, softStop } from "../night/loop.ts";
import { maskText, type Scanner } from "../night/scan.ts";
import { withRoot } from "../spans.ts";

export interface RoundState {
	checkpoint: Checkpoint;
	guidance: Guidance;
	history: HistoryEntry[];
	failures?: string;
	noise: NoiseState & { base: number | null };
	/** The operator's direction on a continued night, masked: every coder and reviewer of the variation reads it. */
	direction?: string;
}

export interface RoundResult extends RoundState {
	kept: boolean;
	/** The round's spend: its row plus one review. */
	spendUsd: number;
	tokens: number;
	/** The costliest evaluation of the round. */
	maxEvalUsd: number;
}

/** The A/A run: the checkpoint evaluated on dev once more; its move becomes the noise margin's base (spec: Noise margin). */
async function runNoise(root: string, night: string, config: NightConfig, paths: NightPaths, round: number, s: RoundState, mock: boolean, spentUsd: number, pauses: Pauses): Promise<{ noise: RoundState["noise"]; spendUsd: number }> {
	const cp = s.checkpoint;
	const evalId = noiseEvalId(cp.exp_id, round);
	const e = await runEvaluation(root, night, config, paths, { evalId, sandboxName: `${sandboxPrefix(night)}-r${round}-noise`, split: "dev", commit: cp.commit, mock, capUsd: config.budget_usd.night - spentUsd, noCache: true, round, pauses, expId: cp.exp_id });
	const first = weightedScore(cp.metrics, config.thresholds, config.weights);
	const second = e.ok ? weightedScore(e.metrics, config.thresholds, config.weights) : undefined;
	const margin = e.ok ? aaMove(cp.metrics, e.metrics, config.thresholds, config.weights) : undefined;
	await step(`${evalId}/record`, async () => {
		appendRow(paths.results, evaluationRow(night, config, "noise", evalId, round, cp, e, second !== undefined ? { score: second } : {}));
		if (margin !== undefined) {
			const moves = Object.fromEntries(Object.keys(config.thresholds).map((m) => [m, [cp.metrics[m] ?? null, e.metrics[m] ?? null]]));
			writeJson(join(paths.nightDir, "noise.json"), { margin, expId: cp.exp_id, first, second, moves });
		}
		return true;
	})();
	const runs = s.noise.runs + 1;
	const noise: RoundState["noise"] =
		margin === undefined
			? { ...s.noise, runs }
			: { runs, measured: true, remeasureOn: margin > config.noise_margin.max ? cp.exp_id : null, base: margin };
	return { noise, spendUsd: e.program_usd };
}

export async function runRound(root: string, night: string, config: NightConfig, paths: NightPaths, mock: boolean, round: number, s0: RoundState, loop: LoopState, pauses: Pauses): Promise<RoundResult> {
	const spentUsd = loop.spentUsd;
	const scenarioDir = join(root, config.scenario);
	const scanner = (signal: AbortSignal): Scanner => ({ scenarioDir, ...(config.scenario_spec.scan ? { scan: config.scenario_spec.scan } : {}), signal });
	let s = s0;
	let noiseUsd = 0;
	if (noiseDue(s.noise, s.checkpoint.exp_id, Object.keys(s.checkpoint.metrics).length > 0, config.noise_margin.fixed)) {
		const n = await runNoise(root, night, config, paths, round, s, mock, spentUsd, pauses);
		s = { ...s, noise: n.noise };
		noiseUsd = n.spendUsd;
	}
	const base = { aaBase: config.noise_margin.fixed ?? s.noise.base ?? 0, round, pauses, checkpoint: s.checkpoint, mock, history: s.history, ...(s.direction ? { direction: s.direction } : {}) };
	const e0 = await runExperiment(root, night, config, paths, { ...base, spentUsd: spentUsd + noiseUsd, hypothesis: s.guidance.hypothesis, ...(s.failures ? { failures: s.failures } : {}) });
	let exp = e0;
	let repaired: { usd: number; tokens: number; programUsd: number } | null = null;
	// Repair: one per round, for a commit that failed before it was scored, if a stop check passes with its spend added.
	if (e0.repairable && e0.code) {
		const failedCode = e0.code;
		const usd0 = e0.facts.coderUsd + e0.facts.devUsd + e0.facts.programUsd;
		const allowed = await step(`${e0.expId}/repair-check`, async () => !existsSync(paths.stopJson) && softStop(config, { ...loop, spentUsd: spentUsd + noiseUsd + usd0, tokens: loop.tokens + e0.facts.tokens }, round, Date.now(), pauses.deadlineMs) === null)();
		if (allowed) {
			// The failed attempt keeps its row (no review of its own) and its note, both written before `e1` starts.
			const failed = await step(`${e0.expId}/failed`, async (ctx) => {
				appendRow(paths.results, { ...experimentRow(night, config, e0.facts), reviewer_usd: 0, t_review: 0 });
				const sc = scanner(ctx.signal);
				writeFileAtomic(notePath(paths.bundle, round, 0), await maskText(sc, noteText(round, 0, e0.decision.decision, e0.decision.reason, failedCode.notes, null)));
				return { failures: await maskText(sc, e0.errors ?? ""), hypothesis: e0.facts.hypothesis === null ? null : await maskText(sc, e0.facts.hypothesis) };
			})();
			repaired = { usd: usd0, tokens: e0.facts.tokens, programUsd: e0.facts.programUsd };
			exp = await runExperiment(root, night, config, paths, { ...base, spentUsd: spentUsd + noiseUsd + usd0, hypothesis: failed.hypothesis, failures: failed.failures, repairOf: { commit: failedCode.commit } });
		}
	}
	const attempt = exp === e0 ? 0 : 1;
	const { facts, decision } = exp;

	// Review: always, also of a revert; a failed review keeps the last guidance and never ends the night.
	let review: ReviewResult | null = null;
	let pausedReviewUsd = 0;
	// A credit error: the review just stops, the night pauses, and the review runs again as `-resume<n>`.
	for (let suffix = ""; ; ) {
		review = null;
		try {
			review = await step(`${exp.expId}/review${suffix}`, (ctx) => withRoot(`${exp.expId}-review`, { night_id: night, exp_id: exp.expId }, () =>
				runReview(
					{
						night,
						round,
						expId: exp.expId,
						config,
						mock,
						scenarioDir: join(root, config.scenario),
						bundleDir: paths.bundle,
						nightDir: paths.nightDir,
						repoDir: paths.repo,
						checkpoint: { ...s.checkpoint, starter: Object.keys(s.checkpoint.metrics).length === 0 },
						experiment: {
							commit: exp.code?.commit ?? null,
							hypothesis: facts.hypothesis,
							decision,
							guardrails: exp.guardrails,
							unchanged: exp.code?.unchanged === true,
							closing: exp.code?.closing ?? "(no closing message)",
							notes: exp.code?.notes ?? "",
							evalId: exp.evalId,
							...(exp.errors ? { evalError: exp.errors } : {}),
						},
						trajectory: buildTrajectory(paths.bundle, paths.nightDir, s.history),
						...(s.direction ? { direction: s.direction } : {}),
					},
					ctx.signal,
				)),
			)();
		} catch (error) {
			rethrowControl(error);
			console.error(`review of ${exp.expId} failed:`, error);
		}
		if (!review?.credit) break;
		pausedReviewUsd += review.reviewer_usd;
		suffix = await pauses.pause(round, `the review of round ${round}`, review.credit);
	}
	const reviewerUsd = (review?.reviewer_usd ?? 0) + pausedReviewUsd;
	const tokens = facts.tokens + (review?.tokens ?? 0);
	const roundTokens = tokens + (repaired?.tokens ?? 0);

	const row = { ...experimentRow(night, config, facts), reviewer_usd: reviewerUsd, t_review: review?.t_review ?? 0, tokens };
	row.wall_s += row.t_review;
	await step(`${exp.expId}/record`, async () => appendRow(paths.results, row))();

	// Learn, in order: log entry and history line (state), the note, the rejected diff, the next guidance; everything a coder reads is masked.
	const line = historyLine(round, facts.hypothesis, movesText(config, s.checkpoint.metrics, decision), decision, exp.errors);
	const code = exp.code;
	const learned = await step(`${exp.expId}/learn`, async (ctx) => {
		const sc = scanner(ctx.signal);
		writeFileAtomic(notePath(paths.bundle, round, attempt), await maskText(sc, noteText(round, attempt, decision.decision, decision.reason, code?.notes ?? "", review?.review?.verdict ?? "")));
		// The rejected diff compares with the checkpoint: an `e1` equal to `e0` still changed code.
		if (decision.decision !== "keep" && code?.differs) {
			const repo = await ExperimentRepo.open(paths.repo);
			writeFileAtomic(rejectedDiffPath(paths.bundle, round), await maskText(sc, `${await repo.diff(s.checkpoint.commit, code.commit)}\n`));
		}
		return { line: await maskText(sc, line), failures: exp.errors ? await maskText(sc, exp.errors) : null };
	})();
	const kept = decision.decision === "keep";
	return {
		checkpoint: kept ? { exp_id: exp.expId, commit: facts.commit, metrics: decision.metrics } : s.checkpoint,
		guidance: nextGuidance(s.guidance, review?.review ?? null),
		history: [...s.history, { round, line: learned.line }],
		noise: s.noise,
		...(decision.score === undefined && !decision.unchanged && learned.failures ? { failures: learned.failures } : {}),
		kept,
		spendUsd: facts.coderUsd + facts.devUsd + facts.programUsd + reviewerUsd + noiseUsd + (repaired?.usd ?? 0),
		tokens: roundTokens,
		maxEvalUsd: Math.max(noiseUsd, facts.programUsd, repaired?.programUsd ?? 0),
	};
}

/**
 * The rescore round: the kept commit under a new name `<night>-r<N>-e0`, evaluated on dev, recorded as `keep` with the
 * new metrics (the old ones if the evaluation failed), so a later continuation finds the commit (spec: Rescore).
 */
export async function runRescore(root: string, night: string, config: NightConfig, paths: NightPaths, mock: boolean, round: number, cp: Checkpoint, spentUsd: number, pauses: Pauses): Promise<{ checkpoint: Checkpoint; spendUsd: number }> {
	const expId = experimentId(night, round);
	const evalId = devEvalId(expId);
	await step(`${expId}/alias`, async () => {
		await (await ExperimentRepo.open(paths.repo)).alias(expId, cp.commit);
		return true;
	})();
	const e = await runEvaluation(root, night, config, paths, { evalId, sandboxName: `${sandboxPrefix(night)}-r${round}-rescore`, split: "dev", commit: cp.commit, mock, capUsd: config.budget_usd.night - spentUsd, round, pauses, expId: cp.exp_id });
	const metrics = e.ok ? e.metrics : cp.metrics;
	const checkpoint: Checkpoint = { exp_id: expId, commit: cp.commit, metrics };
	await step(`${evalId}/record`, async () =>
		appendRow(paths.results, {
			...evaluationRow(night, config, "noise", evalId, round, checkpoint, e),
			kind: "experiment",
			hypothesis: RESCORE_HYPOTHESIS,
			metrics,
			decision: "keep",
			score: weightedScore(metrics, config.thresholds, config.weights),
			decision_reason: e.ok ? "rescore: the scoring changed since the commit was scored" : "rescore: the evaluation failed; the old metrics stand",
		}),
	)();
	return { checkpoint, spendUsd: e.program_usd };
}
