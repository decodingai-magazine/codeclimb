# 35: Graphrag mock night; mock night 7 passes

**What to build:** The graphrag scenario runs end to end on mock models: three stages, a metered program, stage `files` uploaded into the evaluator's sandbox, host commands run through `uv`, `check`, `scan`, a possible repair, and a lessons run at the end. `npm run build:image:graphrag` builds its image. This ticket adds little code of its own; it is where the pieces first meet a multi-stage scenario, and it fixes what that shows.

**Spec sections:**
- "Goal and done signal": night 7
- "What you get, what you build": the `codeclimb-graphrag` image
- "Scenario contract": the stage table (`files`, several stages), "Stage reports become metrics" (the `<stage>.` prefix), the accepted risk in "Splits"
- "Evaluator": step 4 for more than one stage
- "Platform facts": the fact on `UV_PYTHON=3.14` for graphrag's host commands
- "Deployment and environment": the `UV_*` variables and the `uv` volume

**Not yet:** nothing is deferred; a failure found here is fixed here or in the ticket that owns the behaviour.

**Blocked by:** 22 (Metered nights: mock nights 1 and 3 pass); 31 (Repair); 34 (Lessons distillation: graph, trigger and CLI)

**Status:** ready-for-agent

- [ ] `npm run build:image:graphrag` builds `codeclimb-graphrag` from `codeclimb-python` with the scenario's requirements installed system-wide, build context `scenarios/graphrag`
- [ ] `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` writes to `runs-langchain/mock/graphrag-smoke/` and prints `done`; `done.json` exists and `stop.json` doesn't
- [ ] `validate-results` passes; every round has an experiment row with `decision_reason`; there is one `test` row
- [ ] Every evaluation has `evals/<eval>/extraction/inputs.jsonl`; every experiment with a commit has `exps/<exp>/check.json`
- [ ] Where an evaluation succeeded, its scenario metric names start with `extraction.`, `graph.` or `retrieval.`, beside the metering metrics (`cost_*`, `latency_total_s`, `model_calls*`) every row carries
- [ ] These hold whether or not a stage fails and a round ends in `error` with a repair `e1`
- [ ] Within a minute of `done`, `lessons/<id>-r<last round>/proposal.json` exists with `applied: false`, and the scenario's `lessons.md` is unchanged
- [ ] No `cc-<id>` container is left
- [ ] `npm run typecheck` and `npm test` pass
