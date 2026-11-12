# 37: Rescore

**What to build:** When the scoring hashes changed since a kept commit was scored, its old dev metrics can't be compared with new ones. A continued or seeded night then first spends one round scoring that commit again, and measures the noise again, before any coder runs.

**Spec sections:**
- "Experiment lifecycle" > "Continue, seed and rescore": the "Rescore" bullets; the `noise` and `rounds` rows of the state table
- "Scenario contract" > "Splits": the scoring hashes
- "Experiment lifecycle" > "Ids": the `-rescore` sandbox
- "Experiment lifecycle" > "Pause for credits": every evaluation pauses the same way, the rescore included
- "Decision and calibration" > "Noise margin": a seeded or continued night runs an A/A run when it rescores
- "Data and files" > "Result row": rescore rows
- "Interfaces" > "Control operations": `rescore` under `continue` in the start input

**Not yet:** nothing is deferred.

**Blocked by:** 32 (Continue); 36 (Seed)

**Status:** ready-for-agent

- [ ] A continued night gets the rescore flag in its start input, worked out at reopening by comparing `night.json`'s scoring hashes with the current ones, file by file; a seeded night uses the flag its init worked out
- [ ] Rescore runs before the round loop with no stop check, smoke test, coder, review, note or history line: the kept commit gets the name `<night>-r<N>-e0`, is evaluated on dev on the sandbox `cc-<night>-r<N>-rescore`, and its row has `kind: experiment`, `eval_id` `<night>-r<N>-e0-eval`, null `parent_id` and `model`, the fixed hypothesis sentence, and `decision: keep` with the new metrics, or the old ones when that evaluation failed
- [ ] The rescore round counts toward `max_rounds`: the CLI adds 1 for a seeded night and continue adds 1; the new `done.json`'s `rounds` includes it
- [ ] The noise is measured again afterwards: the inherited `noise.json` or seed noise is not used
- [ ] The rescore's program spend counts toward the night's spend; a credit stop in it pauses the night and a resume reruns it under the same `eval_id`
- [ ] A later continue finds the rescore row as the night's last `keep`
- [ ] Unit tests cover the rescore flag and the row, by passing differing scoring-hash maps; no test edits the given `gold/` or `evaluators/`
- [ ] On mock models, with a temporary copy of a scenario and its config (inside the checkout but outside `scenarios/` and `configs/`, each with its own name and a `results_path` folder of its own, which lands directly under `runs-langchain/`): finish a night, change a file under the copy's `evaluators/`, then continue it; the first new row is the rescore row as specified, a `noise` row follows when the checkpoint has metrics, and the night ends with `done`. A night seeded from the first one after the same change starts with a rescore row too
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
