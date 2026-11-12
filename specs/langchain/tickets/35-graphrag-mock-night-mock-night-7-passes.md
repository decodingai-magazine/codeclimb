# 35: Graphrag mock night; mock night 7 passes

**What to build:** The graphrag scenario runs end to end on mock models: three stages, a metered program, stage `files` uploaded into the evaluator's sandbox, host commands run through `uv`, `check`, `scan`, a possible repair, and a lessons run at the end. `npm run build:image:graphrag` builds its image. This ticket adds little code of its own; it is where the pieces first meet a multi-stage scenario, and it fixes what that shows.

**Spec sections:**
- "Goal and done signal": night 7, its own check table and the rows it carries over from the first table
- "Repair", "Lessons across nights", "Metering proxy", "Mock mode", "Standard metrics", "How a scenario is loaded", "Files a night writes": the contracts night 7's checks depend on
- "What you get, what you build": the `codeclimb-graphrag` image
- "Scenario contract": the stage table (`files`, several stages), "Stage reports become metrics" (the `<stage>.` prefix), the accepted risk in "Splits"
- "Evaluator": step 4 for more than one stage
- "Platform facts": the fact on `UV_PYTHON=3.14` for graphrag's host commands
- "Deployment and environment": the `UV_*` variables and the `uv` volume

**Not yet:** nothing is deferred; a failure found here is fixed here or in the ticket that owns the behaviour.

**Blocked by:** 22 (Metered nights: mock nights 1 and 3 pass); 31 (Repair); 34 (Lessons distillation: graph, trigger and CLI)

**Status:** ready-for-agent

- [ ] `npm run build:image:graphrag` builds `codeclimb-graphrag` from `codeclimb-python` with the scenario's requirements installed system-wide, build context `scenarios/graphrag`
- [ ] With `npm run server` up on the code under test, `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` writes to `runs-langchain/mock/graphrag-smoke/`, prints `done` with `stop_reason` `max_rounds` or `thresholds`, and exits 0
- [ ] The rows of the first table of "Goal and done signal" that the spec carries over hold: `done.json` without `stop.json` or `pause.json`, `validate-results`, the mock commit of `r1-e0` adding `MOCK.md`, `code-state.json` with `stop: done` and a session file, `reviews/r<n>.json` with `mock feedback`, `decision_reason` on every experiment row, `spend_usd: 0`, no `cc-<id>` container
- [ ] `results.jsonl` has an `e0` experiment row for every round and exactly one `test` row; a round has an `e1` row only after an `e0` row with decision `error`, and no round has an `e2`
- [ ] Every `e0` session holds eight send-backs then one wrap-up, and an `e1` session holds neither; `train-score.json` and `tasks.json` exist for both
- [ ] `bundle/history/notes/r<round>-e<n>.md` exists per experiment with the `mock note` part; the `mock verdict` part is on the note of the round's last experiment
- [ ] Every experiment has `exps/<exp>/check.json` with an empty `errors` list
- [ ] Every evaluation, dev and test, has `evals/<eval>/extraction/inputs.jsonl` with 8 lines and `extraction/run.log`
- [ ] The test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`
- [ ] `metrics.json` exists for the test evaluation; a dev row that was not scored holds the primary metric at 0 and nothing else
- [ ] The `test` row and `done.json`'s `test_metrics` hold metrics named `extraction.…`, `graph.…` and `retrieval.…`, with `<stage>.output_bytes` for each stage; every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
- [ ] Every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
- [ ] `noise.json` and a `noise` row exist only if a round was kept
- [ ] Within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json` with an empty `ops` list and no `applied: true`; the scenario's `lessons.md` is unchanged
- [ ] These checks hold whether or not a dev stage fails and a round ends in `error` with a repair `e1`; the check never asserts that a dev evaluation failed or passed
- [ ] Mock nights 1 to 3 of ticket 25 still pass every check "Goal and done signal" lists for them; `npm run typecheck` and `npm test` pass
