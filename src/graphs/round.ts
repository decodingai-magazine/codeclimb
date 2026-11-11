// One round after its stop check: experiment, review, record, learn, keep (spec: Round loop).
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { ExperimentRepo } from "../experiments.ts";
import type { NightPaths } from "../night/files.ts";
import { buildTrajectory, type Guidance, type HistoryEntry, historyLine, movesText, nextGuidance, notePath, noteText, rejectedDiffPath, writeFileAtomic } from "../night/memory.ts";
import { type Checkpoint, experimentRow } from "../night/rows.ts";
import { appendRow } from "../results.ts";
import { type ReviewResult, runReview } from "../review/reviewer.ts";
import { step } from "../runtime/step.ts";
import { rethrowControl, runExperiment } from "./parts.ts";

export interface RoundState {
	checkpoint: Checkpoint;
	guidance: Guidance;
	history: HistoryEntry[];
	failures?: string;
}

export interface RoundResult extends RoundState {
	kept: boolean;
	/** The round's spend: its row plus one review. */
	spendUsd: number;
	tokens: number;
}

export async function runRound(root: string, night: string, config: NightConfig, paths: NightPaths, mock: boolean, round: number, s: RoundState): Promise<RoundResult> {
	const exp = await runExperiment(root, night, config, paths, {
		round,
		checkpoint: s.checkpoint,
		hypothesis: s.guidance.hypothesis,
		mock,
		history: s.history,
		...(s.failures ? { failures: s.failures } : {}),
	});
	const { facts, decision } = exp;

	// Review: always, also of a revert; a failed review keeps the last guidance and never ends the night.
	let review: ReviewResult | null = null;
	try {
		review = await step(`${exp.expId}/review`, (ctx) =>
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
				},
				ctx.signal,
			),
		)();
	} catch (error) {
		rethrowControl(error);
		console.error(`review of ${exp.expId} failed:`, error);
	}
	const reviewerUsd = review?.reviewer_usd ?? 0;
	const tokens = facts.tokens + (review?.tokens ?? 0);

	const row = { ...experimentRow(night, config, facts), reviewer_usd: reviewerUsd, t_review: review?.t_review ?? 0, tokens };
	row.wall_s += row.t_review;
	await step(`${exp.expId}/record`, async () => appendRow(paths.results, row))();

	// Learn, in order: log entry and history line (state), the note, the rejected diff, the next guidance.
	const line = historyLine(round, facts.hypothesis, movesText(config, s.checkpoint.metrics, decision), decision, exp.errors);
	const changedCode = exp.code !== null && !exp.code.unchanged;
	await step(`${exp.expId}/learn`, async () => {
		writeFileAtomic(notePath(paths.bundle, round, 0), noteText(round, 0, decision.decision, decision.reason, exp.code?.notes ?? "", review?.review?.verdict ?? ""));
		if (decision.decision !== "keep" && changedCode && exp.code) {
			const repo = await ExperimentRepo.open(paths.repo);
			writeFileAtomic(rejectedDiffPath(paths.bundle, round), `${await repo.diff(s.checkpoint.commit, exp.code.commit)}\n`);
		}
		return true;
	})();
	const kept = decision.decision === "keep";
	return {
		checkpoint: kept ? { exp_id: exp.expId, commit: facts.commit, metrics: decision.metrics } : s.checkpoint,
		guidance: nextGuidance(s.guidance, review?.review ?? null),
		history: [...s.history, { round, line }],
		...(decision.score === undefined && !decision.unchanged && exp.errors ? { failures: exp.errors } : {}),
		kept,
		spendUsd: facts.coderUsd + facts.devUsd + facts.programUsd + reviewerUsd,
		tokens,
	};
}
