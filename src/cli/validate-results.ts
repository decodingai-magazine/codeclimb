// `validate-results <file>` checks a results.jsonl; `--schema` prints the row's JSON Schema (spec: Result row).
import { readFileSync } from "node:fs";
import { RESULT_ROW_SCHEMA, rowErrors } from "../results.ts";

const arg = process.argv[2];
if (arg === "--schema") {
	console.log(JSON.stringify(RESULT_ROW_SCHEMA, null, 2));
	process.exit(0);
}
if (!arg) {
	console.error("usage: validate-results <results.jsonl> | --schema");
	process.exit(2);
}
let bad = 0;
let rows = 0;
const ids = new Set<string>();
for (const [i, line] of readFileSync(arg, "utf8").split("\n").entries()) {
	if (line.trim() === "") continue;
	rows++;
	let row: unknown;
	try {
		row = JSON.parse(line);
	} catch {
		console.error(`line ${i + 1}: not JSON`);
		bad++;
		continue;
	}
	const errors = rowErrors(row);
	const id = (row as { eval_id?: string }).eval_id;
	if (id !== undefined) {
		if (ids.has(id)) errors.push(`eval_id ${id} appears twice`);
		ids.add(id);
	}
	if (errors.length) {
		bad++;
		console.error(`line ${i + 1}: ${errors.join("; ")}`);
	}
}
console.log(bad === 0 ? `ok: ${rows} rows` : `${bad} of ${rows} rows invalid`);
process.exit(bad === 0 ? 0 : 1);
