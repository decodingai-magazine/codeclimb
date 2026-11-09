// `run-night --config <yaml>`: parse and validate once, on the CLI side. The config
// travels in the night.start event with paths relative to the checkout root, and the
// worker resolves them against its own checkout (`rootConfig`), so a remote worker works.
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { loadScenario, type Scenario } from "./scenario";

/** Codeclimb's standard metrics as objectives. Off: still measured and reported, but not optimized. */
export type StandardMetricsConfig = {
  latency: boolean;
  cost: boolean;
  /** The latency metric optimized when `latency` is on (lower is better). */
  latency_metric: string;
  /** The cost metric optimized when `cost` is on (lower is better). */
  cost_metric: string;
  /** Relative cut (0.1 = 10%) a cost or latency change needs, to count. */
  min_efficiency_gain: number;
};

/** Pi's thinking effort. */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export type NightConfig = {
  /** The scenario directory (docs/scenario-contract.md). */
  scenario_dir: string;
  /** Its `scenario.yaml`, parsed on the CLI side; holds no paths outside the scenario dir. */
  scenario: Scenario;
  sandbox: "docker" | "inngest";
  max_rounds: number;
  /** Cap on the night's model tokens (coders + reviewer); null = no cap. Checked between rounds, like the $ cap. */
  max_tokens: number | null;
  /** Stop after this many rounds in a row with nothing kept; 0 = never. */
  plateau_rounds: number;
  /** ISO timestamp, or a duration from night start like "90m" / "8h". */
  deadline: string;
  timeouts: { experiment_min: number; eval_min: number };
  /** The coder's model. */
  model: string;
  reviewer_model: string;
  /** Pi's effort for the coders. */
  coder_thinking: ThinkingLevel;
  /** Pi's effort for the reviewer. */
  reviewer_thinking: ThinkingLevel;
  /** Models the built program may call through the metering proxy (unused by stdlib-only scenarios). */
  allowed_models: string[];
  primary_metric: string;
  standard_metrics: StandardMetricsConfig;
  /** Targets, higher is better. The night stops once the kept commit meets all; their weighted score decides a keep. */
  thresholds: Record<string, number>;
  /** Weight of each threshold metric in the weighted score; unset metrics weigh 1. */
  weights: Record<string, number>;
  gates: Record<string, number>;
  /**
   * `experiment` caps one experiment: the coder's tokens plus the model calls its runs of the program
   * make while it develops. `night` caps the whole run: every experiment, review and evaluation,
   * including the program's model calls in each eval.
   */
  budget_usd: { experiment: number; night: number };
  /**
   * How much an experiment's weighted score must beat the checkpoint's by. The base is the A/A run's
   * measured move, or `fixed` (which skips that run). With `scale_by_replay`, the base shrinks by the
   * square root of the share of the experiment's model calls that were not replayed: a replayed call
   * repeats the checkpoint's answer and adds no noise. `min` floors the result and `max` caps it: one A/A
   * pair is a single sample, and one bad run (a document that came back empty) gave 0.058, which reverted
   * a round that beat the checkpoint on every threshold metric by 0.010.
   */
  noise_margin: { min: number; max: number; fixed: number | null; scale_by_replay: boolean };
  results_path: string;
  /** Directory relative paths resolve against. */
  base_dir: string;
  /** Scripted models and canned program calls, for a free end-to-end check; see `mockConfig`. */
  mock?: boolean;
  /**
   * After each night, distill its rounds into the scenario's lessons (codeclimb/lessons.ts): `propose`
   * writes the change beside the night's runs for review, `apply` writes it into the scenario too.
   * Defaults to `propose` when the scenario declares lessons, else `off`.
   */
  lessons: LessonsMode;
};

export const LESSONS_MODES = ["off", "propose", "apply"] as const;
export type LessonsMode = (typeof LESSONS_MODES)[number];

function req<T>(raw: Record<string, unknown>, key: string, type: string): T {
  const v = raw[key];
  const ok = type === "array" ? Array.isArray(v) : typeof v === type && v !== null;
  if (!ok) throw new Error(`config: "${key}" must be a ${type}`);
  return v as T;
}

export function parseConfig(text: string, baseDir: string): NightConfig {
  const raw = parse(text) as Record<string, unknown>;
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(baseDir, p));
  const timeouts = req<NightConfig["timeouts"]>(raw, "timeouts", "object");
  const sm = (raw.standard_metrics as Partial<StandardMetricsConfig> | undefined) ?? {};
  const budget = req<NightConfig["budget_usd"]>(raw, "budget_usd", "object");
  const nm = (raw.noise_margin as Partial<NightConfig["noise_margin"]> | undefined) ?? {};
  for (const k of ["eval", "dev"]) {
    if (k in budget) throw new Error(`config: budget_usd.${k} is gone; budget_usd.experiment covers an experiment's development calls, and budget_usd.night every evaluation`);
  }
  const scenarioDir = abs(req(raw, "scenario", "string"));
  const scenario = loadScenario(scenarioDir);
  const cfg: NightConfig = {
    scenario_dir: scenarioDir,
    scenario,
    sandbox: req(raw, "sandbox", "string"),
    max_rounds: req(raw, "max_rounds", "number"),
    max_tokens: raw.max_tokens == null ? null : Number(raw.max_tokens),
    plateau_rounds: raw.plateau_rounds == null ? 3 : Number(raw.plateau_rounds),
    deadline: String(req(raw, "deadline", raw.deadline instanceof Date ? "object" : "string")),
    timeouts: { experiment_min: Number(timeouts.experiment_min), eval_min: Number(timeouts.eval_min) },
    model: req(raw, "model", "string"),
    reviewer_model: req(raw, "reviewer_model", "string"),
    coder_thinking: (raw.coder_thinking ?? "medium") as ThinkingLevel,
    reviewer_thinking: (raw.reviewer_thinking ?? "low") as ThinkingLevel,
    allowed_models: (raw.allowed_models as string[] | undefined) ?? [],
    primary_metric: req(raw, "primary_metric", "string"),
    standard_metrics: {
      latency: sm.latency ?? true,
      cost: sm.cost ?? true,
      latency_metric: sm.latency_metric ?? "latency_total_s",
      cost_metric: sm.cost_metric ?? "cost_per_item_usd",
      min_efficiency_gain: sm.min_efficiency_gain ?? 0.1,
    },
    thresholds: req(raw, "thresholds", "object"),
    weights: (raw.weights as Record<string, number> | undefined) ?? {},
    gates: (raw.gates as Record<string, number> | undefined) ?? {},
    budget_usd: {
      experiment: Number(budget.experiment), night: Number(budget.night),
    },
    noise_margin: { min: nm.min ?? 0.002, max: nm.max ?? 0.005, fixed: nm.fixed ?? null, scale_by_replay: nm.scale_by_replay ?? true },
    results_path: abs(req(raw, "results_path", "string")),
    base_dir: baseDir,
    lessons: (raw.lessons ?? (scenario.lessons ? "propose" : "off")) as LessonsMode,
  };
  if (raw.deadline instanceof Date) cfg.deadline = raw.deadline.toISOString();
  if (!["docker", "inngest"].includes(cfg.sandbox)) throw new Error(`config: sandbox must be docker | inngest`);
  for (const k of ["coder_thinking", "reviewer_thinking"] as const) {
    if (!THINKING_LEVELS.includes(cfg[k])) throw new Error(`config: ${k} must be ${THINKING_LEVELS.join(" | ")}`);
  }
  if (cfg.model === cfg.reviewer_model && (raw.reviewer_thinking == null || cfg.coder_thinking === cfg.reviewer_thinking)) {
    throw new Error("config: reviewer_model must differ from the coder's model, or set a different reviewer_thinking (no coder critiques its own work)");
  }
  for (const k of ["models", "parallel", "min_gain", "spec_dir", "dataset_dir", "run_cmd", "run_files", "score_cmd", "baseline", "hidden_fields", "overfit_gap", "max_validations"]) {
    if (k in raw) throw new Error(`config: "${k}" is gone; the scenario's scenario.yaml and fixed splits replace it (docs/scenario-contract.md)`);
  }
  if (!Object.keys(cfg.thresholds).length) throw new Error("config: thresholds must name at least one metric: their weighted score decides a keep");
  for (const [k, v] of Object.entries(cfg.thresholds)) {
    if (!(typeof v === "number" && v > 0)) throw new Error(`config: thresholds.${k} must be a number > 0`);
  }
  for (const [k, v] of Object.entries(cfg.weights)) {
    if (!(k in cfg.thresholds)) throw new Error(`config: weights.${k} names no threshold metric`);
    if (!(typeof v === "number" && v > 0)) throw new Error(`config: weights.${k} must be a number > 0`);
  }
  if (!LESSONS_MODES.includes(cfg.lessons)) throw new Error(`config: lessons must be ${LESSONS_MODES.join(" | ")}`);
  if (cfg.lessons !== "off" && !cfg.scenario.lessons) throw new Error(`config: lessons is ${cfg.lessons}, but scenario ${cfg.scenario.name} declares no lessons in its scenario.yaml`);
  if (cfg.max_rounds < 1) throw new Error("config: max_rounds must be >= 1");
  if (cfg.max_tokens !== null && !(Number.isInteger(cfg.max_tokens) && cfg.max_tokens > 0)) {
    throw new Error("config: max_tokens must be a positive integer, or omitted for no cap");
  }
  if (!(Number.isInteger(cfg.plateau_rounds) && cfg.plateau_rounds >= 0)) {
    throw new Error("config: plateau_rounds must be an integer >= 0 (0 = never stop on a plateau)");
  }
  const n = cfg.noise_margin;
  if (!(typeof n.min === "number" && n.min >= 0)) throw new Error("config: noise_margin.min must be a number >= 0");
  if (!(typeof n.max === "number" && n.max >= n.min)) throw new Error("config: noise_margin.max must be a number >= noise_margin.min");
  if (n.fixed !== null && !(typeof n.fixed === "number" && n.fixed >= 0)) throw new Error("config: noise_margin.fixed must be a number >= 0, or omitted to measure it");
  if (typeof n.scale_by_replay !== "boolean") throw new Error("config: noise_margin.scale_by_replay must be true or false");
  const st = cfg.standard_metrics;
  if (typeof st.latency !== "boolean" || typeof st.cost !== "boolean") {
    throw new Error("config: standard_metrics.latency and standard_metrics.cost must be true or false");
  }
  if (!st.latency_metric.startsWith("latency_")) throw new Error("config: standard_metrics.latency_metric must be a latency_* metric");
  if (!st.cost_metric.startsWith("cost_")) throw new Error("config: standard_metrics.cost_metric must be a cost_* metric");
  if (!(st.min_efficiency_gain > 0 && st.min_efficiency_gain < 1)) throw new Error("config: standard_metrics.min_efficiency_gain must be in (0, 1)");
  if (!Number.isFinite(cfg.timeouts.experiment_min) || !Number.isFinite(cfg.timeouts.eval_min)) {
    throw new Error("config: timeouts.experiment_min and timeouts.eval_min are required numbers");
  }
  checkSandboxLimits(cfg);
  resolveDeadline(cfg.deadline, Date.now()); // throws if malformed
  return cfg;
}

/** Inngest pauses a sandbox after one hour of active runtime; this leaves room for setup and export. */
const INNGEST_MAX_MIN = 50;

/** The backend's limits on the timeouts. Run it again after changing `sandbox` on a parsed config. */
export function checkSandboxLimits(cfg: NightConfig): void {
  if (cfg.sandbox !== "inngest") return;
  for (const [k, min] of [["experiment_min", cfg.timeouts.experiment_min], ["eval_min × stages", evalMinutes(cfg)]] as const) {
    if (min > INNGEST_MAX_MIN) throw new Error(`config: timeouts.${k} must be <= ${INNGEST_MAX_MIN} on inngest (a sandbox runs one hour at most)`);
  }
}

export function loadConfig(path: string, baseDir = process.cwd()): NightConfig {
  return parseConfig(readFileSync(path, "utf8"), baseDir ?? dirname(resolve(path)));
}

/** Minutes one candidate may take: `eval_min` applies to each stage. */
export const evalMinutes = (cfg: Pick<NightConfig, "timeouts" | "scenario">) => cfg.timeouts.eval_min * cfg.scenario.stages.length;

/** Maps every path field of a config (the scenario's commands run in `scenario_dir`, so they need none). */
function mapPaths(cfg: NightConfig, f: (p: string) => string): NightConfig {
  return { ...cfg, scenario_dir: f(cfg.scenario_dir), results_path: f(cfg.results_path), base_dir: f(cfg.base_dir) };
}

/** The config as the CLI sends it: paths under `base_dir` relative to it, `base_dir` itself ".". */
/**
 * The same night on scripted models: real sandboxes, evals and the whole loop, for free. Results go
 * to `runs/mock/<name>/`, so mock rows stay out of the real reports.
 */
export function mockConfig(cfg: NightConfig): NightConfig {
  const dir = dirname(cfg.results_path);
  return { ...cfg, mock: true, results_path: join(dirname(dir), "mock", basename(dir), basename(cfg.results_path)) };
}

export function relativeConfig(cfg: NightConfig): NightConfig {
  const base = cfg.base_dir;
  return mapPaths(cfg, (p) => {
    const rel = relative(base, p);
    return rel === "" ? "." : rel.startsWith("..") || isAbsolute(rel) ? p : rel;
  });
}

/** The config as the worker uses it: relative paths resolved against its checkout (CODECLIMB_ROOT, else cwd). */
export function rootConfig(cfg: NightConfig, root = process.env.CODECLIMB_ROOT ?? process.cwd()): NightConfig {
  return mapPaths(cfg, (p) => (isAbsolute(p) ? p : resolve(root, p)));
}

/** Deadline as epoch ms. Durations ("90m", "8h", "30s") count from `startedAt`. */
export function resolveDeadline(deadline: string, startedAt: number): number {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h)$/.exec(deadline.trim());
  if (m) return startedAt + Number(m[1]) * { s: 1_000, m: 60_000, h: 3_600_000 }[m[2] as "s" | "m" | "h"];
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) throw new Error(`config: deadline "${deadline}" is neither an ISO time nor a duration like 90m`);
  return t;
}

/** The optimized standard metrics, lower is better, in tie-break order: cost first, then latency. */
export function efficiencyMetrics(cfg: Pick<NightConfig, "standard_metrics">): string[] {
  const st = cfg.standard_metrics;
  return [...(st.cost ? [st.cost_metric] : []), ...(st.latency ? [st.latency_metric] : [])];
}
