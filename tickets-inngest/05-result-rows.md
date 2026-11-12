# 05: Result rows: schema, deduplicated append, validate-results

**What to build:** A row is validated against a JSON Schema when it is appended to `results.jsonl`, a row whose `eval_id` is already in the file is not written again, and `npm run validate-results` checks a file or prints the schema. Builders for experiment, noise and test rows fill the fields as the spec states them.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Result row", "Data and files"

**Blocked by:** 01 (Project scaffold, npm scripts, env file and sandbox images)

**Status:** ready-for-agent

- [ ] The schema matches the field table: the required set, the optional set, integer fields ≥ 0, the nullable fields, the enums for `kind`, `split`, `decision`, `backend`, and `stack` fixed to `inngest` (unit tests with valid and invalid rows)
- [ ] Append validates first and refuses an invalid row; a second append with the same `eval_id` writes nothing (unit tests)
- [ ] `npm run validate-results -- <file>` exits 0 on a valid file and non-zero naming the line on an invalid one; `npm run validate-results -- --schema` prints the schema
- [ ] Row builders cover "Rows that are not experiments": noise and test rows carry the checkpoint's `exp_id` and `commit`, zero coder fields, the right `split`; a failed such evaluation has `decision: error`, the primary metric at 0 and counts in `infra_errors`; a never-evaluated experiment still has `eval_id` `<exp>-eval` (unit tests)
- [ ] Spend is rounded to 4 decimals and cost to 9 where the spec says so (unit tests)
