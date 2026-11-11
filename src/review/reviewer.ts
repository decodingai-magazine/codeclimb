// The round's review: one Pi session with no tools, in memory, on the reviewer model. It decides nothing (spec: Reviewer).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import type { Decision } from "../decision.ts";
import { ExperimentRepo } from "../experiments.ts";
import { readJson, writeJson } from "../night/files.ts";
import { type CreditStop, isCreditMessage } from "../night/pause.ts";
import { writeFileAtomic } from "../night/memory.ts";
import { sessionModel } from "../pi/models.ts";
import { openSession } from "../pi/session.ts";
import { trainProblem } from "../coder/sendback.ts";
import { askForReview, CODER_PART_CHARS, capItems, capRunLog, capText, DIFF_CHARS, type Review, SOURCE_CHARS } from "./evidence.ts";
import { specFiles } from "../coder/prompt.ts";

type Metrics = Record<string, number>;

export const REVIEWER_SYSTEM = [
	"You review one experiment of an optimization loop: a coding agent changed a program, an evaluation scored it, and a fixed rule kept or reverted it. You decide nothing; your feedback and hypothesis guide the next round.",
	"Rules:",
	"- Each run is one sample: read small moves against the ci95 and the share of replayed model calls.",
	"- Describe categories of error. Never write a dev entity, document name, query id or query text; quote no dev counts or sizes, only metric values and their changes.",
	"- Follow the operator's direction when there is one.",
	"- Open spec interpretations are tested one round at a time.",
	"- After a revert, or a round that barely moved a target, propose a clearly different change.",
	'Reply with one JSON object: {"feedback": "...", "hypothesis": "...", "verdict": "..."}.',
	"- feedback: what worked, what regressed, which metric families are weakest; why a revert scored worse; what is fragile in a keep.",
	"- hypothesis: the next round's plan from the whole night: one concrete change per threshold metric still short, largest weighted shortfall first, one or two sentences each, at most four changes; nothing an earlier round tried and lost unless something is different now.",
	"- verdict: at most 8 lines for the experiment's note: which change moved which metric and why, which coder notes the scores confirm or contradict, what not to try again.",
].join("\n");

export interface ReviewRequest {
	night: string;
	round: number;
	expId: string;
	config: NightConfig;
	mock: boolean;
	scenarioDir: string;
	bundleDir: string;
	nightDir: string;
	repoDir: string;
	checkpoint: { exp_id: string; commit: string; metrics: Metrics; starter: boolean };
	experiment: {
		commit: string | null;
		hypothesis: string | null;
		decision: Decision;
		guardrails: string[];
		unchanged: boolean;
		closing: string;
		notes: string;
		evalId: string;
		evalError?: string;
	};
	trajectory: string;
	direction?: string;
}

export interface ReviewResult {
	review: Review | null;
	reviewer_usd: number;
	t_review: number;
	tokens: number;
	/** A credit error: the review just stops; the night pauses and runs it again. */
	credit?: CreditStop;
}

class CreditError extends Error {}

const tag = (name: string, body: string) => `<${name}>\n${body.trim()}\n</${name}>`;
const fmt = (v: number | undefined) => (typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : "none");
const signed = (d: number) => `${d >= 0 ? "+" : ""}${Math.round(d * 1e4) / 1e4}`;

/** Thresholds, gates and headlines always; with headlines the rest only as diagnostics; without, every scorer metric and the optimized standard ones. */
export function visibleMetrics(config: NightConfig, metrics: Metrics): { main: string[]; diagnostics: string[] } {
	const s = config.scenario_spec;
	const always = new Set([...Object.keys(config.thresholds), ...Object.keys(config.gates), ...s.headline, config.primary_metric]);
	const optimized = new Set([config.standard_metrics.cost ? config.standard_metrics.cost_metric : "", config.standard_metrics.latency ? config.standard_metrics.latency_metric : ""]);
	const standard = (n: string) => /(^|\.)latency_|(^|\.)cost_|^model_calls/.test(n);
	const main: string[] = [];
	const diagnostics: string[] = [];
	const regexes = s.diagnostics.map((d) => new RegExp(d));
	for (const name of Object.keys(metrics).sort()) {
		if (always.has(name) || optimized.has(name)) main.push(name);
		else if (s.headline.length) {
			if (regexes.some((r) => r.test(name))) diagnostics.push(name);
		} else if (!standard(name)) main.push(name);
	}
	return { main, diagnostics };
}

function stageHash(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const h = createHash("sha256");
	const walk = (d: string, rel: string) => {
		for (const name of readdirSync(d).sort()) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p, `${rel}${name}/`);
			else if (!(rel === "" && name === "timings.jsonl")) h.update(`${rel}${name}\0`).update(readFileSync(p));
		}
	};
	walk(dir, "");
	return h.digest("hex");
}

function details(report: unknown): string[] {
	const d = (report as { details?: unknown } | null)?.details;
	if (Array.isArray(d)) return d.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
	if (d && typeof d === "object") return Object.entries(d).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
	return [];
}

const readText = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

export async function reviewPrompt(r: ReviewRequest): Promise<string> {
	const { config } = r;
	const s = config.scenario_spec;
	const repo = await ExperimentRepo.open(r.repoDir);
	const parts: string[] = [];
	parts.push(tag("spec", specFiles(r.bundleDir).map((f) => `## ${f.name}\n\n${f.text}`).join("\n\n")));
	const protocol = s.protocol
		.map((ref) => {
			const [file, heading] = ref.split("#");
			const text = readText(join(r.scenarioDir, file as string));
			if (!text || !heading) return text ?? "";
			const m = text.split(/^## /m).find((sec) => sec.startsWith(`${heading}\n`) || sec.startsWith(`${heading}\r\n`));
			return m ? `## ${m}` : "";
		})
		.filter(Boolean);
	if (protocol.length) parts.push(tag("protocol", protocol.join("\n\n")));
	const goal = [
		`Primary metric: ${config.primary_metric}.`,
		`Thresholds (weight): ${Object.entries(config.thresholds).map(([m, t]) => `${m} ≥ ${t} (${config.weights[m] ?? 1})`).join(", ")}.`,
		...(Object.keys(config.gates).length ? [`Gates (cap): ${Object.entries(config.gates).map(([m, c]) => `${m} ≤ ${c}`).join(", ")}.`] : []),
		`Efficiency: mention a change of more than ${config.standard_metrics.min_efficiency_gain * 100}% in an optimized standard metric; propose an efficiency hypothesis only when one blocks the goal.`,
	];
	parts.push(tag("goal", goal.join("\n")));
	if (r.direction) parts.push(tag("direction", r.direction));

	const cp = r.checkpoint;
	const cpView = visibleMetrics(config, cp.metrics);
	const source = capText(await repo.source(cp.commit), SOURCE_CHARS, "checkpoint source");
	parts.push(
		tag(
			"checkpoint",
			[cp.starter ? "The checkpoint is the unscored starter." : `Checkpoint ${cp.exp_id}, dev metrics:\n${cpView.main.map((n) => `- ${n}: ${fmt(cp.metrics[n])}`).join("\n")}`, `Source:\n${source}`].join("\n\n"),
		),
	);

	const e = r.experiment;
	const m = e.decision.metrics;
	const view = visibleMetrics(config, m);
	const lines = [`Hypothesis: ${e.hypothesis ?? "(none)"}`, `Decision: ${e.decision.decision}: ${e.decision.reason}`];
	if (e.unchanged) lines.push("The commit changed no file: nothing was tested. The checkpoint's scores stand.", `The coder's closing message:\n${e.closing}`);
	else if (e.decision.score !== undefined) {
		lines.push(`Metrics:\n${view.main.map((n) => `- ${n}: ${fmt(m[n])}`).join("\n")}`);
		if (view.diagnostics.length) lines.push(`Diagnostics:\n${view.diagnostics.map((n) => `- ${n}: ${fmt(m[n])}`).join("\n")}`);
		const changes = [config.primary_metric, ...s.headline.filter((h) => h !== config.primary_metric)].map((n) => {
			const half = m[`${n.replace(/\.mean$/, "")}.ci95_half`];
			const before = cp.metrics[n];
			const delta = typeof before === "number" && typeof m[n] === "number" ? ` (${signed((m[n] as number) - before)})` : "";
			return `- ${n}: ${fmt(before)} → ${fmt(m[n])}${delta}${typeof half === "number" ? `, ci95_half ${fmt(half)}` : ""}`;
		});
		lines.push(`Changes against the checkpoint:\n${changes.join("\n")}`);
		if ((m.model_calls ?? 0) > 0) lines.push(`Model calls: ${m.model_calls}, replayed ${m.model_calls_replayed ?? 0}, failed ${m.model_calls_failed ?? 0}.`);
	} else if (e.evalError) lines.push(`Errors:\n${e.evalError}`);
	if (e.guardrails.length) lines.push(`Guardrails: ${e.guardrails.join(", ")}`);
	const check = readJson<{ notes?: string[] }>(join(r.nightDir, "exps", r.expId, "check.json"));
	if (check?.notes?.length) lines.push(`Repository-check notes:\n${check.notes.map((n) => `- ${n}`).join("\n")}`);
	parts.push(tag("experiment", lines.join("\n\n")));

	const expDir = join(r.nightDir, "exps", r.expId);
	const tasks = readText(join(expDir, "tasks.json"));
	const train = readText(join(expDir, "train-score.json"));
	const coder = [`Notes:\n${capText(e.notes || "(none)", CODER_PART_CHARS, "notes")}`];
	if (tasks) coder.push(`Tasks:\n${capText(tasks, CODER_PART_CHARS, "task list")}`);
	if (train) {
		coder.push(`Train measurements:\n${capText(train, CODER_PART_CHARS, "train measurement")}`);
		if (/fell with no/.test(trainProblem(train) ?? "")) coder.push("Flag: the coder's own train measurement fell with no `why`.");
	}
	parts.push(tag("coder", coder.join("\n\n")));

	if (!e.unchanged && e.commit) {
		const evidence: string[] = [];
		const evalDir = join(r.nightDir, "evals", e.evalId);
		const cpEval = join(r.nightDir, "evals", `${cp.exp_id}-eval`);
		const same: string[] = [];
		for (const st of s.stages) {
			const log = readText(join(evalDir, st.name, "run.log"));
			if (log !== null) evidence.push(`Run log of ${st.name}:\n${capRunLog(log)}`);
			const items = capItems(details(readJson(join(evalDir, st.name, "report.json"))));
			if (items.length) evidence.push(`Per-item errors of ${st.name}:\n${items.join("\n")}`);
			const a = stageHash(join(evalDir, st.name, "outputs"));
			if (a && a === stageHash(join(cpEval, st.name, "outputs"))) same.push(st.name);
		}
		if (same.length) evidence.push(`Stages whose outputs did not change: ${same.join(", ")}`);
		evidence.push(`Diff against the checkpoint:\n${capText(await repo.diff(cp.commit, e.commit), DIFF_CHARS, "diff")}`);
		parts.push(tag("evidence", evidence.join("\n\n")));
	}

	const noise = readJson<{ first: number; second: number; margin: number }>(join(r.nightDir, "noise.json"));
	const fragile = Object.entries(config.thresholds)
		.filter(([n, t]) => {
			const v = m[n];
			const half = m[`${n.replace(/\.mean$/, "")}.ci95_half`];
			return n.endsWith(".mean") && typeof v === "number" && typeof half === "number" && v >= t && v - t <= half;
		})
		.map(([n]) => n);
	const nz = [noise ? `A/A pair: ${fmt(noise.first)} and ${fmt(noise.second)}, move ${fmt(noise.margin)}.` : "", fragile.length ? `Past their target by less than their ci95_half: ${fragile.join(", ")}.` : ""].filter(Boolean);
	if (nz.length) parts.push(tag("noise", nz.join("\n")));
	if (r.trajectory) parts.push(tag("trajectory", r.trajectory));
	return parts.join("\n\n");
}

/** Run the review; persist the prompt before the call and the review after. A failed review returns `review: null`. */
export async function runReview(r: ReviewRequest, signal: AbortSignal): Promise<ReviewResult> {
	const t0 = Date.now();
	const dir = join(r.nightDir, "reviews");
	const prompt = await reviewPrompt(r);
	writeFileAtomic(join(dir, `r${r.round}.prompt.md`), prompt);
	const session = await openSession({ model: await sessionModel(r.config.reviewer_model, "reviewer", r.mock), thinking: r.config.reviewer_thinking, cwd: "/", systemPrompt: REVIEWER_SYSTEM });
	let usd = 0;
	let tokens = 0;
	let credit: CreditStop | undefined;
	session.subscribe((ev) => {
		if (ev.type === "message_end" && ev.message.role === "assistant") {
			if (ev.message.stopReason === "error" && isCreditMessage(ev.message.errorMessage ?? "")) credit ??= { who: "reviewer", model: r.config.reviewer_model, message: ev.message.errorMessage ?? "" };
			usd += ev.message.usage?.cost?.total ?? 0;
			tokens += ev.message.usage?.totalTokens ?? 0;
		}
	});
	const onAbort = () => void session.abort();
	signal.addEventListener("abort", onAbort, { once: true });
	let review: Review | null = null;
	try {
		review = await askForReview(async (p) => {
			signal.throwIfAborted();
			await session.prompt(p);
			// Pi does not throw on a failed call: without this the JSON retry would read a credit error as a bad reply.
			if (credit) throw new CreditError(credit.message);
			return session.getLastAssistantText() ?? "";
		}, prompt);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!signal.aborted && !credit && isCreditMessage(message)) credit = { who: "reviewer", model: r.config.reviewer_model, message };
		if (!credit || signal.aborted) throw error;
	} finally {
		signal.removeEventListener("abort", onAbort);
		session.dispose();
	}
	signal.throwIfAborted();
	const result: ReviewResult = { review, reviewer_usd: usd, t_review: (Date.now() - t0) / 1000, tokens, ...(credit ? { credit } : {}) };
	if (credit) return { ...result, review: null };
	if (review) writeJson(join(dir, `r${r.round}.json`), { round: r.round, model: r.config.reviewer_model, ...review, reviewer_usd: usd, t_review: result.t_review, tokens });
	return result;
}
