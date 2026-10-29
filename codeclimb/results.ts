// results.jsonl: append-only, one line per experiment and per extra eval
// (re-score, noise, validation, test). With git, the source of truth.
import { appendFileSync, existsSync, readFileSync } from "node:fs";

export type Split = "opt" | "val" | "test" | "noise";
export type Decision = "keep" | "revert" | "error";

export interface ResultRow {
  exp_id: string;
  parent_id: string | null;
  round: number;
  stack: "inngest";
  split: Split;
  val_fold: number;
  model: string | null;
  reviewer_model: string;
  hypothesis: string | null;
  commit: string;
  metrics: Record<string, number>;
  coder_usd: number;
  program_usd: number;
  reviewer_usd: number;
  tokens: number;
  wall_s: number;
  decision: Decision;
  backend: "docker" | "inngest";
  t_provision: number;
  t_code: number;
  t_eval: number;
  t_review: number;
  t_teardown: number;
  infra_errors: number;
  /**
   * Not in the contract: which extra eval a row is (experiment | rescore | noise | validation | test). `baseline`
   * is the already re-scored parent's run in a round's evaluator: recorded for comparison, its score unchanged.
   */
  kind: "experiment" | "rescore" | "baseline" | "noise" | "validation" | "test";
  /** Not in the contract: unique per row (an experiment's own eval, a re-score, a noise run, ...). */
  eval_id: string;
  night_id: string;
  /** Not in the contract: the evaluator incarnation that ran the eval, and the eval's position in it. */
  evaluator_instance?: string;
  eval_order?: number;
  /** Not in the contract: why a kept experiment was kept (a primary gain, or cost/latency at an unchanged primary). */
  keep_reason?: "primary" | "efficiency";
}

const num = { type: "number" };
const str = { type: "string" };
const nullable = (t: string) => ({ type: [t, "null"] });

/** JSON Schema (draft 2020-12) for one results.jsonl line. */
export const RESULT_ROW_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "CodeClimb results.jsonl row",
  type: "object",
  required: [
    "exp_id", "parent_id", "round", "stack", "split", "val_fold", "model", "reviewer_model", "hypothesis",
    "commit", "metrics", "coder_usd", "program_usd", "reviewer_usd", "tokens", "wall_s", "decision", "backend",
    "t_provision", "t_code", "t_eval", "t_review", "t_teardown", "infra_errors",
  ],
  properties: {
    exp_id: str,
    parent_id: nullable("string"),
    round: { type: "integer", minimum: 0 },
    stack: { type: "string", enum: ["inngest", "langchain"] },
    split: { type: "string", enum: ["opt", "val", "test", "noise"] },
    val_fold: { type: "integer", minimum: 0 },
    model: nullable("string"),
    reviewer_model: str,
    hypothesis: nullable("string"),
    commit: str,
    metrics: { type: "object", additionalProperties: { type: "number" } },
    coder_usd: num,
    program_usd: num,
    reviewer_usd: num,
    tokens: { type: "integer", minimum: 0 },
    wall_s: num,
    decision: { type: "string", enum: ["keep", "revert", "error"] },
    backend: { type: "string", enum: ["docker", "inngest"] },
    t_provision: num,
    t_code: num,
    t_eval: num,
    t_review: num,
    t_teardown: num,
    infra_errors: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["experiment", "rescore", "baseline", "noise", "validation", "test"] },
    eval_id: str,
    night_id: str,
    evaluator_instance: str,
    eval_order: { type: "integer", minimum: 0 },
    keep_reason: { type: "string", enum: ["primary", "efficiency"] },
  },
} as const;

/** Validates a row against RESULT_ROW_SCHEMA (the subset of JSON Schema it uses). Returns error messages. */
export function validateRow(row: unknown): string[] {
  const errors: string[] = [];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return ["row is not an object"];
  const r = row as Record<string, unknown>;
  for (const key of RESULT_ROW_SCHEMA.required) if (!(key in r)) errors.push(`missing ${key}`);
  for (const [key, spec] of Object.entries(RESULT_ROW_SCHEMA.properties) as [string, Record<string, unknown>][]) {
    if (!(key in r)) continue;
    const v = r[key];
    const types = ([] as string[]).concat(spec.type as string | string[]);
    const typeOk = types.some((t) =>
      t === "null" ? v === null
      : t === "integer" ? Number.isInteger(v)
      : t === "number" ? typeof v === "number" && Number.isFinite(v)
      : t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v)
      : typeof v === t,
    );
    if (!typeOk) errors.push(`${key}: expected ${types.join("|")}`);
    else if (spec.enum && !(spec.enum as unknown[]).includes(v)) errors.push(`${key}: ${String(v)} not in enum`);
    else if (typeof spec.minimum === "number" && typeof v === "number" && v < spec.minimum) errors.push(`${key} < ${spec.minimum}`);
    else if (key === "metrics") {
      for (const [mk, mv] of Object.entries(v as object)) {
        if (typeof mv !== "number" || !Number.isFinite(mv)) errors.push(`metrics.${mk}: expected number`);
      }
    }
  }
  return errors;
}

export function readRows(path: string): ResultRow[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ResultRow);
}

const rowKey = (r: Pick<ResultRow, "eval_id">) => r.eval_id;

/** Append rows, skipping any already written (a replayed step must not duplicate lines). */
export function appendRows(path: string, rows: ResultRow[]): void {
  const seen = new Set(readRows(path).map(rowKey));
  const fresh = rows.filter((r) => !seen.has(rowKey(r)));
  for (const r of fresh) {
    const errors = validateRow(r);
    if (errors.length) throw new Error(`invalid results row ${r.exp_id}: ${errors.join("; ")}`);
  }
  if (fresh.length) appendFileSync(path, fresh.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
