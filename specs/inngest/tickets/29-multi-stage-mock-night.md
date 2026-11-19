# 29: Multi-stage mock night: graphrag-smoke, mock night 7, passes its checks

**What to build:** The `graphrag` scenario runs a whole mock night: three stages (`extraction`, `graph`, `retrieval`), a repository check, host commands through `uv`, a metered program, a repair, and lessons at the end. Mock night 7 passes every check the spec lists for it, whether or not a dev evaluation fails.

**Spec sections** (`specs/inngest/spec.md`): "Goal and done signal", "Scenario contract", "Files a night writes", "Result row"

**Blocked by:** 25 (Repair: one fix attempt for a commit that failed before scoring); 28 (Lessons distillation: what a night learned reaches the next night)

**Status:** ready-for-agent

- [ ] With `codeclimb-graphrag` built, `uv` on the path, and the dev server and the worker up, `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` writes to `runs-inngest/mock/graphrag-smoke/` and passes C1, C2, C3, C5, C6, C7, C10, C12 and C14
- [ ] An `e0` experiment row for every round and exactly one `test` row; an `e1` row only after an `e0` row with decision `error`; no `e2`
- [ ] Every `e0` session holds eight send-backs, then one wrap-up; an `e1` session holds neither; `train-score.json` and `tasks.json` exist for both
- [ ] A note per experiment with a `mock note` coder part; the `mock verdict` part is on the note of the round's last experiment
- [ ] Every experiment has `exps/<exp>/check.json` with an empty `errors` list
- [ ] Every evaluation has `evals/<eval>/extraction/inputs.jsonl` with 8 lines and `extraction/run.log`
- [ ] The test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`, and a `metrics.json`
- [ ] A dev row that was not scored holds the primary metric at 0 and nothing else
- [ ] The `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `<stage>.…`, with `<stage>.output_bytes` for each; every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
- [ ] Every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
- [ ] `noise.json` and a `noise` row exist only if a round was kept
- [ ] Within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged
- [ ] The checks hold whether or not a dev evaluation fails; none asserts that one failed or passed
- [ ] Nights 1 to 3 still pass the check of ticket 20
