// Night config and scenario manifest: parse, validate, resolve (spec: Night config; Scenario contract, How a scenario is loaded).
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse } from "yaml";

/**
 * Where this build's nights write, under the checkout: its own folder, apart from the Inngest twin's `runs-inngest/`. A config's `results_path` is relative to it.
 * Mock nights go to its `mock/` subfolder.
 */
export const RUNS_DIR = "runs-langchain";
/** A mock night's results sit under `runs-langchain/mock/`. */
export const isMockResults = (resultsPath: string) => resultsPath.startsWith(`${RUNS_DIR}/mock/`);

export type Thinking = "off" | "minimal" | "low" | "medium" | "high";
export type LessonsMode = "off" | "propose" | "apply";
const THINKING: readonly Thinking[] = ["off", "minimal", "low", "medium", "high"];
const LESSONS: readonly LessonsMode[] = ["off", "propose", "apply"];

export interface Stage {
	name: string;
	inputs: string;
	files: Record<string, string>;
	run: string;
	score: string;
	details?: string;
}

export interface Scenario {
	name: string;
	image: string;
	bundle: string;
	stages: Stage[];
	headline: string[];
	diagnostics: string[];
	protocol: string[];
	check?: string;
	scan?: string;
	lessons?: string;
}

export interface NightConfig {
	/** Scenario directory, relative to the checkout. */
	scenario: string;
	scenario_spec: Scenario;
	sandbox: "docker";
	max_rounds: number;
	max_tokens?: number;
	plateau_rounds: number;
	deadline: string;
	timeouts: { experiment_min: number; eval_min: number };
	model: string;
	reviewer_model: string;
	coder_thinking: Thinking;
	reviewer_thinking: Thinking;
	allowed_models: string[];
	primary_metric: string;
	thresholds: Record<string, number>;
	weights: Record<string, number>;
	gates: Record<string, number>;
	standard_metrics: {
		latency: boolean;
		cost: boolean;
		latency_metric: string;
		cost_metric: string;
		min_efficiency_gain: number;
	};
	budget_usd: { experiment: number; night: number };
	noise_margin: { min: number; max: number; fixed?: number; scale_by_replay: boolean };
	lessons: LessonsMode;
	seed?: string;
	/** results.jsonl, relative to the checkout: `runs-langchain/<name>/<file>` or `runs-langchain/mock/<name>/<file>`. The yaml gives it relative to `runs-langchain/`. */
	results_path: string;
}

export class ConfigError extends Error {
	override name = "ConfigError";
}

const fail = (message: string): never => {
	throw new ConfigError(message);
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Obj, key: string, where: string): string {
	const v = o[key];
	if (typeof v !== "string" || v.trim() === "") fail(`${where}: \`${key}\` must be a non-empty string`);
	return v as string;
}

function optStr(o: Obj, key: string, where: string): string | undefined {
	return o[key] === undefined || o[key] === null ? undefined : str(o, key, where);
}

function num(v: unknown, what: string, check: (n: number) => boolean, rule: string): number {
	if (typeof v !== "number" || !Number.isFinite(v) || !check(v)) fail(`${what} must be ${rule}`);
	return v as number;
}

function numMap(v: unknown, what: string, check: (n: number) => boolean, rule: string): Record<string, number> {
	if (v === undefined || v === null) return {};
	if (!isObj(v)) fail(`${what} must be a map of metric to number`);
	const out: Record<string, number> = {};
	for (const [k, n] of Object.entries(v as Obj)) out[k] = num(n, `${what}.${k}`, check, rule);
	return out;
}

function strList(v: unknown, what: string): string[] {
	if (v === undefined || v === null) return [];
	if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) fail(`${what} must be a list of strings`);
	return v as string[];
}

const DURATION = /^(\d+)(s|m|h)$/;
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;

/** The deadline as epoch ms: an ISO time, or a duration (`90m`, `8h`, `30s`) from `startMs`. */
export function deadlineAt(deadline: string, startMs: number): number {
	const m = DURATION.exec(deadline.trim());
	if (m) return startMs + Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
	if (/^\d{4}-\d{2}-\d{2}T/.test(deadline)) {
		const t = Date.parse(deadline);
		if (Number.isFinite(t)) return t;
	}
	return fail(`deadline \`${deadline}\` is neither an ISO time nor a duration such as 90m, 8h, 30s`);
}

const STAGE_NAME = /^[a-z][a-z0-9_-]*$/;

/** Parse and validate `<dir>/scenario.yaml`. `dir` is absolute. */
export function loadScenario(dir: string): Scenario {
	const manifest = join(dir, "scenario.yaml");
	if (!existsSync(manifest)) fail(`scenario ${dir}: scenario.yaml is missing`);
	if (!existsSync(join(dir, "starter")) || !statSync(join(dir, "starter")).isDirectory()) fail(`scenario ${dir}: starter/ is missing`);
	const raw: unknown = parse(readFileSync(manifest, "utf8"));
	if (!isObj(raw)) return fail(`${manifest}: not a map`);
	if (!Array.isArray(raw.stages) || raw.stages.length === 0) fail(`${manifest}: \`stages\` needs at least one stage`);
	const names = new Set<string>();
	const stages = (raw.stages as unknown[]).map((s, i): Stage => {
		if (!isObj(s)) return fail(`${manifest}: stage ${i} is not a map`);
		const name = str(s, "name", `${manifest} stage ${i}`);
		if (!STAGE_NAME.test(name)) fail(`${manifest}: stage name \`${name}\` must match ${STAGE_NAME}`);
		if (names.has(name)) fail(`${manifest}: stage name \`${name}\` is used twice`);
		names.add(name);
		const files = s.files ?? {};
		if (!isObj(files) || Object.values(files).some((v) => typeof v !== "string")) fail(`${manifest}: stage ${name}: \`files\` must map sandbox paths to host paths`);
		const stage: Stage = {
			name,
			inputs: str(s, "inputs", `${manifest} stage ${name}`),
			files: files as Record<string, string>,
			run: str(s, "run", `${manifest} stage ${name}`),
			score: str(s, "score", `${manifest} stage ${name}`),
		};
		const details = optStr(s, "details", `${manifest} stage ${name}`);
		if (details) stage.details = details;
		return stage;
	});
	const diagnostics = strList(raw.diagnostics, `${manifest}: diagnostics`);
	for (const d of diagnostics) {
		try {
			new RegExp(d);
		} catch {
			fail(`${manifest}: diagnostics regex \`${d}\` does not compile`);
		}
	}
	const protocol = typeof raw.protocol === "string" ? [raw.protocol] : strList(raw.protocol, `${manifest}: protocol`);
	const scenario: Scenario = {
		name: str(raw, "name", manifest),
		image: str(raw, "image", manifest),
		bundle: str(raw, "bundle", manifest),
		stages,
		headline: strList(raw.headline, `${manifest}: headline`),
		diagnostics,
		protocol,
	};
	for (const key of ["check", "scan", "lessons"] as const) {
		const v = optStr(raw, key, manifest);
		if (v) scenario[key] = v;
	}
	if (scenario.lessons && !existsSync(join(dir, scenario.lessons))) fail(`${manifest}: lessons file ${scenario.lessons} is missing`);
	return scenario;
}

export interface LoadOptions {
	/** Where `run-night` was started: relative config paths resolve against it. */
	cwd: string;
	/** The checkout: paths travel relative to it. */
	root: string;
	mock: boolean;
}

function underRoot(root: string, abs: string, what: string): string {
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) fail(`${what} ${abs} is outside the checkout ${root}`);
	return rel.split(sep).join("/");
}

/**
 * A config's `results_path` is relative to the stack's runs folder (`<name>/<file>`), so one config serves every stack.
 * Comes back relative to the checkout: `runs-langchain/<name>/<file>`, or `runs-langchain/mock/<name>/<file>` for a mock night.
 */
export function resultsUnderRuns(resultsPath: string, mock: boolean): string {
	const where = `results_path ${resultsPath}`;
	if (isAbsolute(resultsPath)) fail(`${where}: must be relative to ${RUNS_DIR}/, not absolute`);
	const parts = resultsPath.split(/[\\/]/).filter((p) => p !== "" && p !== ".");
	if (parts.includes("..")) fail(`${where}: must stay inside ${RUNS_DIR}/ (no \`..\`)`);
	if (parts.length !== 2 || parts[0] === "mock") fail(`${where}: must be <name>/<file>, relative to ${RUNS_DIR}/ (e.g. datenorm-smoke/results.jsonl)`);
	return [RUNS_DIR, ...(mock ? ["mock"] : []), ...parts].join("/");
}

/** Load a night config yaml, validate it, embed its parsed scenario. Paths come back relative to `root`. */
export function loadNightConfig(file: string, opts: LoadOptions): NightConfig {
	const path = resolve(opts.cwd, file);
	if (!existsSync(path)) fail(`config ${path} not found`);
	const raw: unknown = parse(readFileSync(path, "utf8"));
	if (!isObj(raw)) return fail(`${path}: not a map`);

	const scenarioDir = resolve(opts.cwd, str(raw, "scenario", path));
	const scenario = underRoot(opts.root, scenarioDir, "scenario");
	const spec = loadScenario(scenarioDir);

	const sandbox = str(raw, "sandbox", path);
	if (sandbox !== "docker") console.log(`note: sandbox \`${sandbox}\` is read as docker on this stack`);

	const maxRounds = num(raw.max_rounds, "max_rounds", (n) => Number.isInteger(n) && n >= 1, "an integer ≥ 1");
	const maxTokens = raw.max_tokens === undefined || raw.max_tokens === null ? undefined : num(raw.max_tokens, "max_tokens", (n) => Number.isInteger(n) && n > 0, "a positive integer");
	const plateau = raw.plateau_rounds === undefined ? 3 : num(raw.plateau_rounds, "plateau_rounds", (n) => Number.isInteger(n) && n >= 0, "an integer ≥ 0");

	const deadline = String(raw.deadline ?? "");
	deadlineAt(deadline, 0);

	if (!isObj(raw.timeouts)) fail("timeouts.experiment_min and timeouts.eval_min are required");
	const t = raw.timeouts as Obj;
	const timeouts = {
		experiment_min: num(t.experiment_min, "timeouts.experiment_min", (n) => n > 0, "> 0"),
		eval_min: num(t.eval_min, "timeouts.eval_min", (n) => n > 0, "> 0"),
	};

	const model = str(raw, "model", path);
	const reviewerModel = str(raw, "reviewer_model", path);
	for (const [k, m] of [["model", model], ["reviewer_model", reviewerModel]] as const) {
		if (!/^[^/\s]+\/\S+$/.test(m)) fail(`${k} \`${m}\` must be <provider>/<id>`);
	}
	const thinking = (key: string, dflt: Thinking): Thinking => {
		const v = raw[key] ?? dflt;
		if (!THINKING.includes(v as Thinking)) fail(`${key} must be one of ${THINKING.join(", ")}`);
		return v as Thinking;
	};
	const coderThinking = thinking("coder_thinking", "medium");
	const reviewerThinking = thinking("reviewer_thinking", "low");
	const reviewerThinkingSet = raw.reviewer_thinking !== undefined && raw.reviewer_thinking !== null;
	if (reviewerModel === model && (!reviewerThinkingSet || reviewerThinking === coderThinking)) {
		fail("the reviewer must differ from the coder: give reviewer_model another model or reviewer_thinking another effort");
	}

	const thresholds = numMap(raw.thresholds, "thresholds", (n) => n > 0, "> 0 (a threshold of 0 or less never stops a night)");
	if (Object.keys(thresholds).length === 0) fail("thresholds: at least one threshold is required");
	const weightsIn = numMap(raw.weights, "weights", (n) => n > 0, "> 0");
	for (const k of Object.keys(weightsIn)) if (!(k in thresholds)) fail(`weights: \`${k}\` is not a threshold metric; a weight applies only to thresholds`);
	const weights = Object.fromEntries(Object.keys(thresholds).map((k) => [k, weightsIn[k] ?? 1]));
	const gates = numMap(raw.gates, "gates", () => true, "a number");

	const sm = isObj(raw.standard_metrics) ? (raw.standard_metrics as Obj) : {};
	const standard = {
		latency: sm.latency === undefined ? true : sm.latency === true,
		cost: sm.cost === undefined ? true : sm.cost === true,
		latency_metric: typeof sm.latency_metric === "string" ? sm.latency_metric : "latency_total_s",
		cost_metric: typeof sm.cost_metric === "string" ? sm.cost_metric : "cost_per_item_usd",
		min_efficiency_gain: sm.min_efficiency_gain === undefined ? 0.1 : num(sm.min_efficiency_gain, "standard_metrics.min_efficiency_gain", (n) => n > 0 && n < 1, "in (0, 1)"),
	};
	if (!standard.latency_metric.startsWith("latency_")) fail("standard_metrics.latency_metric must start with latency_");
	if (!standard.cost_metric.startsWith("cost_")) fail("standard_metrics.cost_metric must start with cost_");

	if (!isObj(raw.budget_usd)) fail("budget_usd.experiment and budget_usd.night are required");
	const b = raw.budget_usd as Obj;
	const budget = {
		experiment: num(b.experiment, "budget_usd.experiment", (n) => n > 0, "> 0"),
		night: num(b.night, "budget_usd.night", (n) => n > 0, "> 0"),
	};

	const nm = isObj(raw.noise_margin) ? (raw.noise_margin as Obj) : {};
	const noise: NightConfig["noise_margin"] = {
		min: nm.min === undefined ? 0.002 : num(nm.min, "noise_margin.min", (n) => n >= 0, "≥ 0"),
		max: nm.max === undefined ? 0.005 : num(nm.max, "noise_margin.max", (n) => n >= 0, "≥ 0"),
		scale_by_replay: nm.scale_by_replay === undefined ? true : nm.scale_by_replay === true,
	};
	if (nm.fixed !== undefined && nm.fixed !== null) noise.fixed = num(nm.fixed, "noise_margin.fixed", (n) => n >= 0, "≥ 0");
	if (noise.min > noise.max) fail("noise_margin.min must not exceed noise_margin.max");

	const lessonsRaw = raw.lessons ?? (spec.lessons ? "apply" : "off");
	if (!LESSONS.includes(lessonsRaw as LessonsMode)) fail(`lessons must be one of ${LESSONS.join(", ")}`);
	const lessons = lessonsRaw as LessonsMode;
	if (lessons !== "off" && !spec.lessons) fail(`lessons: \`${lessons}\` needs a scenario that declares lessons; ${spec.name} has none`);

	const results = resultsUnderRuns(str(raw, "results_path", path), opts.mock);

	const config: NightConfig = {
		scenario,
		scenario_spec: spec,
		sandbox: "docker",
		max_rounds: maxRounds,
		plateau_rounds: plateau,
		deadline,
		timeouts,
		model,
		reviewer_model: reviewerModel,
		coder_thinking: coderThinking,
		reviewer_thinking: reviewerThinking,
		allowed_models: strList(raw.allowed_models, "allowed_models"),
		primary_metric: str(raw, "primary_metric", path),
		thresholds,
		weights,
		gates,
		standard_metrics: standard,
		budget_usd: budget,
		noise_margin: noise,
		lessons,
		results_path: results,
	};
	if (maxTokens !== undefined) config.max_tokens = maxTokens;
	if (optStr(raw, "seed", path)) fail("seed: starting from another night is not built yet");
	return config;
}
