# 06: Result rows and `validate-results`

**What to build:** One JSON line per experiment, noise run and test evaluation, validated against a JSON Schema on append and unique by `eval_id`. `npm run validate-results -- <file>` checks a rows file; `--schema` prints the schema.

**Spec sections:**
- "Interfaces the build must honour" > "Result row": all of it
- "Interfaces the build must honour" > "CLI": the `validate-results` row
- "Interfaces the build must honour" > "Files a night writes": `results.jsonl`
- "Numbers": `validate-results` within 300 s

**Not yet:** filling the rows from a night (ticket 12 onwards).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] The schema holds every field of the table with its type; `round`, `tokens` and `infra_errors` are integers ≥ 0; `kind` is `experiment`, `noise` or `test`; `split` is `dev` or `test`; `decision` is `keep`, `revert` or `error`; `stack` is `langchain`; `backend` is `docker`; `metrics` is a flat map of name → number
- [ ] Optional in the schema: `kind`, `eval_id`, `night_id`, `score`, `decision_reason`, `dev_usd`, `evaluator_instance`, `unchanged`; `model`, `hypothesis` and `parent_id` may be null
- [ ] An append validates the row and refuses an invalid one; an append whose `eval_id` is already in the file writes nothing
- [ ] `validate-results <file>` exits 0 on a valid file and non-zero naming the line and the field otherwise, with the path relative or absolute; a duplicate `eval_id` fails it; `validate-results --schema` prints the schema
- [ ] `validate-results` on a file of several nights' rows finishes well within 300 s
- [ ] Unit tests cover a valid experiment, noise and test row, each refused shape, and the duplicate rule
- [ ] `npm run typecheck` and `npm test` pass
