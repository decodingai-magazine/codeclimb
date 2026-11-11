// results.jsonl: one JSON line per experiment, noise run and test evaluation; validated on append, deduplicated by eval_id (spec: Result row).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ResultRow {
	night_id: string;
	exp_id: string;
	parent_id: string | null;
	eval_id: string;
	round: number;
	stack: "langchain";
	backend: "docker";
	kind: "experiment" | "noise" | "test";
	split: "dev" | "test";
	model: string | null;
	reviewer_model: string;
	hypothesis: string | null;
	commit: string;
	metrics: Record<string, number>;
	decision: "keep" | "revert" | "error";
	score?: number;
	decision_reason?: string;
	coder_usd: number;
	dev_usd: number;
	program_usd: number;
	reviewer_usd: number;
	tokens: number;
	wall_s: number;
	t_provision: number;
	t_code: number;
	t_eval: number;
	t_review: number;
	t_teardown: number;
	infra_errors: number;
	evaluator_instance?: string;
	unchanged?: boolean;
}

const num = { type: "number" };
const nonNegInt = { type: "integer", minimum: 0 };
const str = { type: "string" };
const nullableStr = { type: ["string", "null"] };

/** The row's JSON Schema. Rows of both builds (Inngest and LangChain) validate against it. */
export const RESULT_ROW_SCHEMA = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	title: "CodeClimb result row",
	type: "object",
	required: [
		"exp_id", "parent_id", "round", "stack", "backend", "split", "model", "reviewer_model", "hypothesis", "commit", "metrics", "decision",
		"coder_usd", "program_usd", "reviewer_usd", "tokens", "wall_s", "t_provision", "t_code", "t_eval", "t_review", "t_teardown", "infra_errors",
	],
	properties: {
		night_id: str,
		exp_id: str,
		parent_id: nullableStr,
		eval_id: str,
		round: nonNegInt,
		stack: { enum: ["inngest", "langchain"] },
		backend: { enum: ["docker", "inngest", "langsmith"] },
		kind: { enum: ["experiment", "noise", "test"] },
		split: { enum: ["dev", "test"] },
		model: nullableStr,
		reviewer_model: str,
		hypothesis: nullableStr,
		commit: str,
		metrics: { type: "object", additionalProperties: num },
		decision: { enum: ["keep", "revert", "error"] },
		score: num,
		decision_reason: str,
		coder_usd: num,
		dev_usd: num,
		program_usd: num,
		reviewer_usd: num,
		tokens: nonNegInt,
		wall_s: num,
		t_provision: num,
		t_code: num,
		t_eval: num,
		t_review: num,
		t_teardown: num,
		infra_errors: nonNegInt,
		evaluator_instance: str,
		unchanged: { type: "boolean" },
	},
} as const;

type Prop = { type?: string | readonly string[]; enum?: readonly string[]; minimum?: number; additionalProperties?: { type: string } };

function typeOk(v: unknown, t: string): boolean {
	if (t === "null") return v === null;
	if (t === "integer") return Number.isInteger(v);
	if (t === "number") return typeof v === "number" && Number.isFinite(v);
	if (t === "object") return typeof v === "object" && v !== null && !Array.isArray(v);
	return typeof v === t;
}

/** The schema's problems with one row; empty when it is valid. */
export function rowErrors(row: unknown): string[] {
	if (!typeOk(row, "object")) return ["a row must be a JSON object"];
	const r = row as Record<string, unknown>;
	const errors: string[] = [];
	for (const k of RESULT_ROW_SCHEMA.required) if (!(k in r)) errors.push(`missing \`${k}\``);
	for (const [k, v] of Object.entries(r)) {
		const p = (RESULT_ROW_SCHEMA.properties as Record<string, Prop>)[k];
		if (!p) continue;
		if (p.enum && !p.enum.includes(v as string)) errors.push(`\`${k}\` must be one of ${p.enum.join(", ")}`);
		if (p.type) {
			const types = typeof p.type === "string" ? [p.type] : p.type;
			if (!types.some((t) => typeOk(v, t))) errors.push(`\`${k}\` must be ${types.join(" or ")}`);
			else if (p.minimum !== undefined && (v as number) < p.minimum) errors.push(`\`${k}\` must be ≥ ${p.minimum}`);
		}
		if (p.additionalProperties && typeOk(v, "object")) {
			for (const [mk, mv] of Object.entries(v as object)) if (!typeOk(mv, p.additionalProperties.type)) errors.push(`metric \`${mk}\` must be a number`);
		}
	}
	return errors;
}

export function readRows(file: string): ResultRow[] {
	if (!existsSync(file)) return [];
	const rows: ResultRow[] = [];
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (line.trim() === "") continue;
		try {
			rows.push(JSON.parse(line) as ResultRow);
		} catch {}
	}
	return rows;
}

/** Validate and append a row, unless a row with its eval_id is there already. Returns whether it wrote. */
export function appendRow(file: string, row: ResultRow): boolean {
	const errors = rowErrors(row);
	if (errors.length) throw new Error(`result row ${row.eval_id}: ${errors.join("; ")}`);
	if (readRows(file).some((r) => r.eval_id === row.eval_id)) return false;
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(file, `${JSON.stringify(row)}\n`);
	return true;
}
