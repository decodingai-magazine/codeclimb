# 36: Seed and rescore

**What to build:** `--seed ID|latest|best` (or the config's `seed`) starts a new night from an ended night's kept commit instead of the starter: round 1 must beat the seed's dev metrics. When the scoring hashes changed since a kept commit was scored, a continued or seeded night first spends one round rescoring that commit, then measures the noise again.

**Spec sections:**
- "Experiment lifecycle" > "Continue, seed and rescore": the "Seed" and "Rescore" bullets
- "Experiment lifecycle" > "Init": the seed alias; "Ids": `<night>-r0-seed`, the `-rescore` sandbox
- "Scenario contract" > "Splits": the scoring hashes
- "CLI": `--seed`
- "Decision and calibration" > "Noise margin": a seeded night starts with its seed's noise, unless it rescores
- "Memory within and across nights" > "Notes, trajectory and rejected diffs": the `<start>` note
- "Data and files": `night.json`'s `seed`; "Result row": rescore rows; `done.json`'s `kept` for a seeded night that kept nothing

**Not yet:** nothing is deferred.

**Blocked by:** 25 (Check table: mock nights 1 to 3 as one repeatable check); 32 (Continue); 34 (Lessons distillation: graph, trigger and CLI)

**Status:** ready-for-agent

- [ ] The CLI resolves `latest` (the newest `startedAt` among ended nights) and `best` (the highest weighted dev score among ended nights of this scenario with equal scoring hashes, a tie to the newer; test scores never count) to a night id before the start, searching the config's own results directory
- [ ] A seed is refused when the seed night kept nothing, has a `stop.json` and no `night.json`, or falls under the lessons refusal as the spec defines it
- [ ] Init aliases the seed's kept commit as `<night>-r0-seed`; `night.json`'s `seed` holds the seed night, its kept experiment, its last round, the primary value, the metrics and the rescore flag
- [ ] The checkpoint starts with the seed's dev metrics; the seed night's noise carries over when the scoring hashes are equal; coders and reviewers read a `<start>` note naming the seed night
- [ ] A seeded night that kept nothing ends with its seed as `kept`, with `dev_score` the seed's primary value
- [ ] Rescore runs before the round loop with no stop check, smoke test, coder, review, note or history line: the kept commit gets the name `<night>-r<N>-e0`, is evaluated on dev, and its row has `kind: experiment`, `eval_id` `<night>-r<N>-e0-eval`, null `parent_id` and `model`, and `decision: keep` with the new metrics, or the old ones when that evaluation failed
- [ ] The rescore round counts toward `max_rounds` (the CLI and continue add 1); the noise is measured again afterwards
- [ ] A continued night gets the rescore flag in its start input; a seeded night works it out in init by comparing the seed night's scoring hashes with the current ones
- [ ] Unit tests cover `latest` and `best`, the refusals, and the rescore flag and row, by passing differing scoring-hash maps; no test edits the given `gold/` or `evaluators/`
- [ ] On mock models: after `datenorm-smoke --mock` finishes, `run-night --config configs/datenorm-smoke.yaml --mock --seed latest --rounds 1` prints `done`; the new night's `night.json` names the seed; `refs/exp/<night>-r0-seed` points at the seed night's kept commit; round 1's row has `parent_id` `<night>-r0-seed`; there is no `noise` row in the new night
- [ ] On mock models, with a temporary copy of a scenario and its config (inside the checkout but outside `scenarios/` and `configs/`, each with its own name and a results directory directly under `runs-langchain/`): finish a night, change a file under the copy's `evaluators/`, then continue it; the first new row is the rescore row as specified, a `noise` row follows when the checkpoint has metrics, and the night ends with `done`
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
