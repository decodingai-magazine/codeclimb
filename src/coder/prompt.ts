// The coder's user prompt: sections in order, each only when it has content (spec: Prompt).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { NightConfig } from "../config.ts";
import { weightedScore } from "../decision.ts";

type Metrics = Record<string, number>;

const TASK_FILES = ["SPEC.md", "task.md"];

/** Every `.md` in the bundle's `spec/`, the task file first. */
export function specFiles(bundleDir: string): { name: string; text: string }[] {
	const dir = join(bundleDir, "spec");
	if (!existsSync(dir)) return [];
	const names = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
	names.sort((a, b) => Number(TASK_FILES.includes(b)) - Number(TASK_FILES.includes(a)));
	return names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

export interface TargetLines {
	targets: string[];
	met: string[];
	fragile: string[];
}

/** Threshold metrics split into not reached (largest weighted shortfall first), met by more than ci95_half, and fragile. */
export function targetLines(config: NightConfig, checkpoint: Metrics): TargetLines {
	const out: TargetLines = { targets: [], met: [], fragile: [] };
	const short: { line: string; gap: number }[] = [];
	for (const [name, target] of Object.entries(config.thresholds)) {
		const w = config.weights[name] ?? 1;
		const v = checkpoint[name];
		const shown = typeof v === "number" ? String(v) : "not measured";
		const line = `${name}: dev ${shown}, threshold ${target}, weight ${w}`;
		if (typeof v !== "number" || v < target) {
			short.push({ line, gap: w * (1 - Math.min(Math.max(v ?? 0, 0) / target, 1)) });
			continue;
		}
		const half = name.endsWith(".mean") ? checkpoint[`${name.slice(0, -".mean".length)}.ci95_half`] : undefined;
		if (typeof half === "number" && v - target <= half) out.fragile.push(`${line}, ci95_half ${half}`);
		else out.met.push(line);
	}
	out.targets = short.sort((a, b) => b.gap - a.gap).map((s) => s.line);
	return out;
}

export interface PromptInput {
	config: NightConfig;
	bundleDir: string;
	checkpoint: Metrics;
	/** The reviewer's hypothesis; none in round 1. */
	hypothesis: string | null;
	minutes: number;
	endsAt: Date;
	hasTrain: boolean;
	direction?: string;
	trajectory?: string;
	rejectedDiffs?: string[];
	failures?: string;
}

const tag = (name: string, body: string) => `<${name}>\n${body.trim()}\n</${name}>`;

export function coderPrompt(p: PromptInput): string {
	const { config } = p;
	const parts: string[] = [];
	const spec = specFiles(p.bundleDir);
	parts.push(
		[
			"You improve the program in /repo, a git repository, so that it scores better on a hidden evaluation. The task and how it is scored:",
			tag("spec", spec.map((f) => `## ${f.name}\n\n${f.text}`).join("\n\n")),
			`A copy of the spec is at /spec/spec.${p.hasTrain ? " /spec/train is the only labeled data you get." : ""}`,
		].join("\n\n"),
	);
	if (p.direction) parts.push(tag("direction", p.direction));
	if (p.trajectory) {
		const diffs = p.rejectedDiffs?.length ? `\n\nRejected diffs (read the part you need): ${p.rejectedDiffs.join(", ")}` : "";
		parts.push(tag("trajectory", `${p.trajectory}${diffs}`));
	}
	if (p.failures) parts.push(tag("failures", p.failures));
	const t = targetLines(config, p.checkpoint);
	if (t.targets.length) parts.push(tag("targets", `Raise all of these in this attempt, one task per metric:\n${t.targets.map((l) => `- ${l}`).join("\n")}`));
	if (t.met.length) parts.push(tag("met", `Reached on dev; plan no task for them, only check they don't fall:\n${t.met.map((l) => `- ${l}`).join("\n")}`));
	if (t.fragile.length) parts.push(tag("fragile", `Reached by less than their ci95_half; they can fall below on the next split:\n${t.fragile.map((l) => `- ${l}`).join("\n")}`));
	if (p.hypothesis) parts.push(tag("hypothesis", `Test this hypothesis, within the targets:\n${p.hypothesis}`));
	parts.push(
		[
			"Workflow:",
			"1. Research, at most a fifth of the time: run the program first, and score the starting code on train.",
			"2. Plan: write /tmp/tasks.json, a JSON list of {task, check, status}, status `todo`, `done`, or `dropped` plus a `note`.",
			"3. Implement.",
			"4. Review: check each task, measure again, close the tasks.",
		].join("\n"),
	);
	const weights = Object.entries(config.thresholds)
		.map(([m, v]) => `${m} ≥ ${v} (weight ${config.weights[m] ?? 1})`)
		.join(", ");
	const optimized = [config.standard_metrics.cost ? config.standard_metrics.cost_metric : "", config.standard_metrics.latency ? config.standard_metrics.latency_metric : ""].filter(Boolean);
	const rules = [
		"Test on cases you write; you never get the evaluation data.",
		"Where the spec leaves an interpretation open, choose one on purpose and say which.",
		`How the keep works: each threshold metric earns min(value / threshold, 1) times its weight; the weighted score is their sum over the sum of weights. Thresholds and weights: ${weights}. The change is kept only if its weighted score beats the current one by more than the noise margin of repeated runs.`,
		...(optimized.length ? [`${optimized.join(" and ")} are measured for the report, not for the keep.`] : []),
		`Each run of the program gets ${config.timeouts.eval_min} minutes in the evaluation; a longer one scores nothing. Evaluation inputs can be much longer than train's: leave room in token limits and timeouts.`,
		"Packages: `uv add` in /repo, commit pyproject.toml and uv.lock, run with .venv/bin/python.",
		"Simpler is better.",
		"Write /tmp/notes.md for the next coder: at most 20 plain lines of checked facts (tools, limits, runtimes, train measurements, what failed and why); no claim about dev or test.",
		...(p.hasTrain
			? ["Write /tmp/train-score.json: `before` and `after` objects of metric scores and the `command`; `why` if a metric fell. Score on train items no few-shot example comes from."]
			: []),
		"Send long output to a file. Commit only as a checkpoint: the harness commits /repo as it stands.",
		`You have ${p.minutes} minutes; the round ends at ${p.endsAt.toISOString()}. Check the clock (\`date -u\`) before you stop.`,
		"End your final message with `APPROACH: <one sentence>`.",
	];
	parts.push(`How to work:\n${rules.map((r) => `- ${r}`).join("\n")}`);
	return parts.join("\n\n");
}

/** The starter scores 0; any checkpoint's weighted score. */
export const checkpointScore = (config: NightConfig, metrics: Metrics) => weightedScore(metrics, config.thresholds, config.weights);
