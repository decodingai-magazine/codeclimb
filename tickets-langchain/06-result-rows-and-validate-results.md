# 06: Result rows and `validate-results`

**What to build:** A row can be appended to a `results.jsonl` only when it fits the schema, and appending a row whose `eval_id` is already in the file writes nothing. `npm run validate-results -- <file>` checks a file and `npm run validate-results -- --schema` prints the schema.

**Spec sections:**
- "Data and files" > "Result row": the field table, required and optional fields, "Rows that are not experiments"
- "Experiment lifecycle" > "Ids": the `eval_id` forms

**Not yet:** building rows from a round (ticket 15).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] The schema is a JSON Schema with the field table's types: required and optional fields as listed; `round`, `tokens` and `infra_errors` integers ≥ 0; `parent_id`, `model` and `hypothesis` nullable; `metrics` a flat map of numbers
- [ ] `stack` accepts `inngest` and `langchain`; `backend` accepts `docker`, `inngest` and `langsmith`; `kind`, `split` and `decision` accept only their listed values
- [ ] Append validates before writing and rejects an invalid row with the failing field named
- [ ] Appending a row with an `eval_id` already in the file leaves the file byte for byte unchanged
- [ ] `validate-results <file>` exits 0 on a valid file and non-zero, naming the line, on an invalid one; `validate-results --schema` prints the schema
- [ ] Unit tests cover the above; `npm run typecheck` and `npm test` pass
