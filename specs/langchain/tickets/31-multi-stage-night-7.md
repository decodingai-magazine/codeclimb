# 31: Multi-stage night: night 7 passes

**What to build:** `graphrag-smoke --mock` runs end to end: a three-stage, metered scenario on `codeclimb-graphrag`, with a repository check, a leak scan, host commands through `uv`, the gold graph uploaded to the retrieval stage, a repair when a dev evaluation fails, and lessons at the end. Night 7 passes every check the spec lists for it, with or without the failure and the repair.

**Spec sections:**
- "Goal and done signal": night 7 and its checks
- "Architecture": isolation invariants (graphrag's accepted exception)
- "Interfaces the build must honour" > "Scenario contract": multi-stage metric names; `files`; `/repo/.venv/bin` first on the path
- "Interfaces the build must honour" > "Commands and services": host commands through `uv` on Python 3.14; `build:image:graphrag`
- "Features": **Evaluator** (the `uv.lock` sync; "on dev, an empty stage"; "Test always runs every stage")
- "Interfaces the build must honour" > "Result row": "A row that was not scored holds the primary metric at 0 and nothing else"

**Not yet:** nothing.

**Blocked by:** 18 (Metered nights: nights 1 and 3 pass); 27 (Repair); 30 (Lessons distillation)

**Status:** ready-for-agent

- [ ] `graphrag`'s host commands run through `uv` inside the Agent Server on Python 3.14; its `bundle`, `check`, `scan` and stage commands work
- [ ] The retrieval stage gets the gold graph uploaded to its sandbox path, the one accepted exception; nothing else of `gold/` or `evaluators/` enters a sandbox
- [ ] Night 7, after `npm run build:image:graphrag`, `graphrag-smoke --mock`: C1, C2, C3, C5, C6, C7, C10, C12 and C14 hold
- [ ] `results.jsonl` has an `e0` row for every round and exactly one `test` row; a round has an `e1` only after an `e0` with decision `error`; no round has an `e2`
- [ ] Every `e0` session holds eight send-backs then one wrap-up; an `e1` session holds neither; `train-score.json` and `tasks.json` exist for both; a note per experiment has a `mock note` coder part and the `mock verdict` reviewer part is on the round's last experiment's note
- [ ] Every experiment has `exps/<exp>/check.json` with an empty `errors` list
- [ ] Every evaluation, dev and test, has `extraction/inputs.jsonl` with 8 lines and `extraction/run.log`; the test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`, and a `metrics.json`; a dev row that was not scored holds the primary metric at 0 and nothing else
- [ ] The `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `extraction.…`, `graph.…` and `retrieval.…`, with `<stage>.output_bytes` for each; every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
- [ ] Every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
- [ ] `noise.json` and a `noise` row exist only if a round was kept
- [ ] Within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
