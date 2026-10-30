// Validate results.jsonl against the row schema.
//   npm run validate-results -- runs/datenorm/results.jsonl
//   npm run validate-results -- --schema   (print the JSON Schema)
import { readFileSync } from "node:fs";
import { RESULT_ROW_SCHEMA, validateRow } from "../codeclimb/results";

const arg = process.argv[2];
if (arg === "--schema") {
  console.log(JSON.stringify(RESULT_ROW_SCHEMA, null, 2));
} else {
  if (!arg) throw new Error("usage: validate-results <results.jsonl> | --schema");
  const lines = readFileSync(arg, "utf8").split("\n").filter((l) => l.trim());
  let bad = 0;
  lines.forEach((line, i) => {
    let errors: string[];
    try {
      errors = validateRow(JSON.parse(line));
    } catch (e) {
      errors = [`invalid JSON: ${(e as Error).message}`];
    }
    if (errors.length) {
      bad += 1;
      console.log(`line ${i + 1}: ${errors.join("; ")}`);
    }
  });
  console.log(`${lines.length} rows, ${bad} invalid`);
  process.exit(bad ? 1 : 0);
}
