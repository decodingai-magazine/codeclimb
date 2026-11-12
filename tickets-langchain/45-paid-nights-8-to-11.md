# 45: Paid nights 8 to 11: real models, with the operator's go-ahead

**What to build:** Nothing new. The finished build runs the four paid end-to-end nights of the done signal on real models, on a running `npm run server`. They spend money, so each night runs only when the operator says so for that run, after its ceiling was named. Anything a night shows broken is fixed in the ticket that owns it, and the night is run again with a new go-ahead.

**Spec sections:**
- "Goal and done signal": the paragraph on the paid end-to-end tests, the table of nights 8 to 11 with their ceilings, and the line on what every paid night must also do
- "Night config" > "Validation at parse": the model check a real-model night passes before it starts
- "Experiment lifecycle" > "Stops": `budget`, `thresholds`
- "What you get, what you build": `configs/e2e/` (`budget`, `overfit`), `build:scenario:overfit`, the credentials
- "Data and files": "Files a night writes", "Result row"
- "Durable runtime on LangGraph" > "Cleanup"

**Not yet:** nothing is deferred.

**Blocked by:** 44 (Final acceptance: the free end-to-end suite and the fixed contracts)

**Status:** ready-for-human

- [ ] Before each night the operator gives the go-ahead for that run, after being told its command and its ceiling. A night without a go-ahead is reported as not run, never as passed; one go-ahead covers one run of one night
- [ ] Each night writes to `runs-langchain/<results folder>/`, with no `mock` in the path, and the ceiling is checked against `done.json`'s `spend_usd`
- [ ] Night 8, ceiling $0.50: `npm run run-night -- --config configs/capitals-smoke.yaml` prints `done`; there is a `test` row; `spend_usd` is above 0 and at most 0.50; `meter.jsonl` shows real calls
- [ ] Night 9, ceiling $0.50: `npm run run-night -- --config configs/datenorm-smoke.yaml` prints `done`; at least one experiment row has `keep`; test accuracy is above 0.125, the starter's dev score
- [ ] Night 10, ceiling $0.20: `npm run run-night -- --config configs/e2e/budget.yaml` ends with `stop_reason` `budget` within 3 rounds; `spend_usd` is under 0.20
- [ ] Night 11, ceiling $0.50: `npm run build:scenario:overfit`, then `npm run run-night -- --config configs/e2e/overfit.yaml` ends with `stop_reason` `thresholds` within 4 rounds, and the `test` row's accuracy equals the kept commit's dev accuracy
- [ ] Every paid night also ends with `done.json` and no `stop.json`, passes `validate-results`, and leaves no `cc-<id>` container
- [ ] A short report lists, per night: go-ahead given or not, ran or not run, its `spend_usd` against its ceiling, passed or failed, and what was fixed
