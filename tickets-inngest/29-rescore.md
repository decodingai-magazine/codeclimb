# 29: Rescore: a kept commit is scored again when the scoring changed

**What to build:** Old scores can't be compared with new ones once the scoring hashes differ. So such a night begins with one extra round before the loop: the kept commit gets a new experiment id, is evaluated on dev, and is recorded as kept with the new metrics. The noise is then measured again.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Continue, seed and rescore", "Splits", "Ids", "Result row", "Noise margin", "Pause for credits"

**Blocked by:** 18 (Noise run: the A/A evaluation and the measured margin); 25 (Continue: more rounds on an ended night, with an operator's direction); 28 (Seed: a new night that starts from an ended night's kept commit)

**Status:** ready-for-agent

- [ ] The rescore flag is worked out by comparing scoring hashes file by file: by the sender for a continue (it travels in the start event's `continue.rescore`), by init for a seeded night; the CLI and continue add 1 to `max_rounds`
- [ ] The rescore runs before the round loop with no stop check, smoke test, coder, review, note or history line, on the sandbox `cc-<night>-r<N>-rescore`
- [ ] The kept commit is aliased as `<night>-r<N>-e0`; its row has `kind: experiment`, `eval_id` `<night>-r<N>-e0-eval`, null `parent_id` and `model`, the fixed hypothesis sentence, and `decision: keep` with the new metrics, or the old ones when the evaluation failed
- [ ] After a rescore the night's noise is dropped and the A/A run is due again; the rescore's program spend counts in the night's spend; a credit stop in it pauses the night like any evaluation
- [ ] A later continuation finds the rescore row as the checkpoint, and `rounds` counts the rescore round (unit tests with fabricated rows)
- [ ] End-to-end, mock, dev server, on a scenario and config from test-only copies (inside the checkout but outside `scenarios/` and `configs/`, gitignored, each with its own name and a `results_path` directly under `runs/`): finish a night, change a file under the copy's `evaluators/`, then continue it; the first new row is the rescore row as specified, a `noise` row follows when the checkpoint has metrics, and the night ends with `done`
- [ ] Both mock nights of ticket 20 still pass every check of "Goal and done signal"
