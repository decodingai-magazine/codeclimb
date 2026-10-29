// `run-night --config <yaml>`: parse, validate and resolve paths once, on the
// CLI side. The resolved config travels in the night.start event.
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { parse } from "yaml";

/** Codeclimb's standard metrics as objectives. Off: still measured and reported, but not optimized. */
export type StandardMetricsConfig = {
  latency: boolean;
  cost: boolean;
  /** The latency metric optimized when `latency` is on (lower is better). */
  latency_metric: string;
  /** The cost metric optimized when `cost` is on (lower is better). */
  cost_metric: string;
  /** Relative cut (0.1 = 10%) a cost or latency change needs, on top of beating 2σ, to count. */
  min_efficiency_gain: number;
};

export type NightConfig = {
  spec_dir: string;
  dataset_dir: string;
  run_cmd: string;
  /** Host files copied into the eval sandbox's /eval/ before `run_cmd` runs. */
  run_files: string[];
  score_cmd: string;
  sandbox: "docker" | "inngest";
  /** Baseline environment: the `autocode-base` image. */
  baseline: string;
  max_rounds: number;
  /** ISO timestamp, or a duration from night start like "90m" / "8h". */
  deadline: string;
  timeouts: { experiment_min: number; eval_min: number };
  models: string[];
  reviewer_model: string;
  /** Models the built program may call through the metering proxy (unused by stdlib-only scenarios). */
  allowed_models: string[];
  primary_metric: string;
  standard_metrics: StandardMetricsConfig;
  thresholds: Record<string, number>;
  gates: Record<string, number>;
  min_gain: number;
  overfit_gap: number;
  max_validations: number;
  /** `eval` caps the program's model calls in one eval (default: `experiment`). */
  budget_usd: { experiment: number; night: number; eval: number };
  results_path: string;
  /** Dataset fields never sent to a sandbox besides `gold` and `fold`. */
  hidden_fields: string[];
  /** Directory relative paths and `score_cmd` resolve against. */
  base_dir: string;
};

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
  const cfg: NightConfig = {
    spec_dir: abs(req(raw, "spec_dir", "string")),
    dataset_dir: abs(req(raw, "dataset_dir", "string")),
    run_cmd: req(raw, "run_cmd", "string"),
    run_files: ((raw.run_files as string[] | undefined) ?? []).map(abs),
    score_cmd: req(raw, "score_cmd", "string"),
    sandbox: req(raw, "sandbox", "string"),
    baseline: (raw.baseline as string | undefined) ?? "autocode-base",
    max_rounds: req(raw, "max_rounds", "number"),
    deadline: String(req(raw, "deadline", raw.deadline instanceof Date ? "object" : "string")),
    timeouts: { experiment_min: Number(timeouts.experiment_min), eval_min: Number(timeouts.eval_min) },
    models: req(raw, "models", "array"),
    reviewer_model: req(raw, "reviewer_model", "string"),
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
    gates: (raw.gates as Record<string, number> | undefined) ?? {},
    min_gain: req(raw, "min_gain", "number"),
    overfit_gap: req(raw, "overfit_gap", "number"),
    max_validations: req(raw, "max_validations", "number"),
    budget_usd: {
      experiment: Number(budget.experiment), night: Number(budget.night), eval: Number(budget.eval ?? budget.experiment),
    },
    results_path: abs(req(raw, "results_path", "string")),
    hidden_fields: (raw.hidden_fields as string[] | undefined) ?? [],
    base_dir: baseDir,
  };
  if (raw.deadline instanceof Date) cfg.deadline = raw.deadline.toISOString();
  if (!["docker", "inngest"].includes(cfg.sandbox)) throw new Error(`config: sandbox must be docker | inngest`);
  if (cfg.models.length < 1) throw new Error("config: models needs at least one model (one per branch)");
  if (cfg.models.includes(cfg.reviewer_model)) {
    throw new Error("config: reviewer_model must be none of the coder models (no coder critiques its own work)");
  }
  if (cfg.max_validations < 1 || cfg.max_validations > 5) throw new Error("config: max_validations must be 1..5");
  if (cfg.max_rounds < 1) throw new Error("config: max_rounds must be >= 1");
  if (!(cfg.budget_usd.eval > 0)) throw new Error("config: budget_usd.eval must be a positive number");
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
  resolveDeadline(cfg.deadline, Date.now()); // throws if malformed
  return cfg;
}

export function loadConfig(path: string, baseDir = process.cwd()): NightConfig {
  return parseConfig(readFileSync(path, "utf8"), baseDir ?? dirname(resolve(path)));
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
