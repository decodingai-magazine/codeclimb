// Memory within a night: notes, history lines, rejected diffs and the trajectory (spec: Notes, trajectory and rejected diffs).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { NightConfig } from "../config.ts";
import type { Decision } from "../decision.ts";
import { weightedScore } from "../decision.ts";
import { type Review, TRAJECTORY_CHARS, type TrajectoryRound, trajectory } from "../review/evidence.ts";
import { readJson } from "./files.ts";

export const NOTE_REASON_CHARS = 300;
export const HISTORY_ERROR_CHARS = 300;
const CODER_HEADING = "### Coder, before the evaluation";
const REVIEWER_HEADING = "### Reviewer, after the evaluation";

export function writeFileAtomic(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, text);
	renameSync(tmp, path);
}

export const notePath = (bundleDir: string, round: number, attempt: number) => join(bundleDir, "history", "notes", `r${round}-e${attempt}.md`);
export const rejectedDiffPath = (bundleDir: string, round: number) => join(bundleDir, "history", `r${round}.diff`);

/** `## r<N>-e<n> · <decision>: <reason>`, the coder part, and the reviewer part when there is a verdict. */
export function noteText(round: number, attempt: number, decision: string, reason: string, coderNotes: string, verdict: string | null): string {
	const parts = [`## r${round}-e${attempt} · ${decision}: ${reason.slice(0, NOTE_REASON_CHARS)}`, CODER_HEADING, coderNotes.trim() || "(no notes)"];
	if (verdict !== null) parts.push(REVIEWER_HEADING, verdict.trim() || "(no verdict)");
	return `${parts.join("\n\n")}\n`;
}

export function readNote(path: string): { coder: string; verdict: string } {
	if (!existsSync(path)) return { coder: "", verdict: "" };
	const text = readFileSync(path, "utf8");
	const c = text.indexOf(CODER_HEADING);
	const v = text.indexOf(REVIEWER_HEADING);
	return {
		coder: c < 0 ? "" : text.slice(c + CODER_HEADING.length, v < 0 ? undefined : v).trim(),
		verdict: v < 0 ? "" : text.slice(v + REVIEWER_HEADING.length).trim(),
	};
}

const signed = (d: number) => `${d >= 0 ? "+" : ""}${d.toFixed(4)}`;

/** The weighted score's change, then the primary (no headlines) or each headline, and each optimized metric, against the checkpoint. */
export function movesText(config: NightConfig, checkpoint: Record<string, number>, d: Decision): string {
	if (d.unchanged) return "no change";
	if (d.score === undefined) return "not scored";
	const moves = [`score ${signed(d.score - weightedScore(checkpoint, config.thresholds, config.weights))}`];
	const sm = config.standard_metrics;
	const names = [...(config.scenario_spec.headline.length ? config.scenario_spec.headline : [config.primary_metric]), ...(sm.cost ? [sm.cost_metric] : []), ...(sm.latency ? [sm.latency_metric] : [])];
	for (const n of names) {
		const v = d.metrics[n];
		if (typeof v !== "number") continue;
		const before = checkpoint[n];
		moves.push(typeof before === "number" ? `${n} ${signed(v - before)}` : `${n} ${v}`);
	}
	return moves.join(", ");
}

/** `- r<N>: <hypothesis> → <moves> (<decision>: <reason>)`; an error's reason is its last 300 characters. */
export function historyLine(round: number, hypothesis: string | null, moves: string, d: Decision, errors?: string): string {
	const reason = d.decision === "error" && errors ? errors.replace(/\s+/g, " ").trim().slice(-HISTORY_ERROR_CHARS) : d.reason;
	return `- r${round}: ${hypothesis ?? "(none)"} → ${moves} (${d.decision}: ${reason})`;
}

export interface Guidance {
	feedback: string;
	hypothesis: string | null;
}

/** A failed review keeps the last feedback and hypothesis. */
export function nextGuidance(prev: Guidance, review: Review | null): Guidance {
	return review ? { feedback: review.feedback, hypothesis: review.hypothesis } : prev;
}

export interface HistoryEntry {
	round: number;
	line: string;
}

/** Rounds 1..N-1 with their notes and the reviewer's feedback, read from disk. */
export function buildTrajectory(bundleDir: string, nightDir: string, history: HistoryEntry[], budget = TRAJECTORY_CHARS): string {
	const rounds: TrajectoryRound[] = history.map((h) => {
		const notes = [1, 0].map((e) => readNote(notePath(bundleDir, h.round, e)));
		const note = notes.find((n) => n.coder || n.verdict) ?? { coder: "", verdict: "" };
		const feedback = readJson<{ feedback?: string }>(join(nightDir, "reviews", `r${h.round}.json`))?.feedback ?? "";
		return { round: h.round, line: h.line, coder: note.coder, verdict: note.verdict, feedback };
	});
	return trajectory(rounds, budget);
}
