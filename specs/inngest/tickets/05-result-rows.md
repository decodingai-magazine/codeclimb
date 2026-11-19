# 05: Result rows: schema, deduplicated append, validate-results

**What to build:** `results.jsonl` can be appended to safely, one row per experiment, noise run and test evaluation, never the same `eval_id` twice, and checked from the command line against the row schema.

**Spec sections** (`specs/inngest/spec.md`): "Result row", "Files a night writes", "CLI", "Numbers"

**Blocked by:** 01 (Project scaffold, npm scripts, env loading and sandbox images)

**Status:** ready-for-agent

- [ ] The row schema holds every field of "Result row" with its type: `kind` in `experiment`, `noise`, `test`; `split` in `dev`, `test`; `decision` in `keep`, `revert`, `error`; `stack` `inngest`; `backend` `docker`; `model` and `hypothesis` nullable; `metrics` a flat map of name to number (unit tests with valid and invalid rows)
- [ ] An append validates the row first and refuses an invalid one; a second append with an `eval_id` already in the file writes nothing (unit tests)
- [ ] A row that was not scored holds only the primary metric, at 0 (unit test on the row builder)
- [ ] `npm run validate-results -- <file>` exits 0 on a valid file and non-zero naming the bad line on an invalid one, within 300 s on a night's rows file; `npm run validate-results -- --schema` prints the schema
