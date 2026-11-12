# 36: Seed

**What to build:** `--seed ID|latest|best` (or the config's `seed`) starts a new night from an ended night's kept commit instead of the starter. The new night has its own id, budget and trajectory; only the code and the dev metrics it was kept on carry over, so round 1 must beat them.

**Spec sections:**
- "Experiment lifecycle" > "Continue, seed and rescore": the "Seed" bullets; the rows of the state table that name a seed (checkpoint, history)
- "Experiment lifecycle" > "Init": the seed alias; "Ids": `<night>-r0-seed`
- "Night config": the `seed` field; "CLI": `--seed`
- "Interfaces" > "Control operations": `seed` in the start input
- "Decision and calibration" > "Noise margin": a seeded night starts with its seed's noise
- "Memory within and across nights" > "Notes, trajectory and rejected diffs": the `<start>` note
- "Data and files" > "Files a night writes": `night.json`'s `seed`; "Result row": `done.json`'s `kept` for a seeded night that kept nothing

**Not yet:** the rescore round (ticket 37): init works out the rescore flag and records it in `night.json`, and this ticket's tests keep the scoring hashes equal.

**Blocked by:** 25 (Check table: mock nights 1 to 3 as one repeatable check); 32 (Continue); 34 (Lessons distillation: graph, trigger and CLI)

**Status:** ready-for-agent

- [ ] The CLI resolves `latest` (the newest `startedAt` among ended nights) and `best` (the highest weighted dev score among ended nights of this scenario with equal scoring hashes, a tie to the newer; test scores never count) to a night id before the start, searching the config's own results directory
- [ ] When both `--seed` and the config's `seed` are set, `--seed` wins (unit test)
- [ ] A seed is refused when the seed night kept nothing, has a `stop.json` and no `night.json`, or falls under the lessons refusal: it ran with `lessons: apply`, was not a mock, its scenario declares lessons, and it has rounds with notes or reviews past its newest applied proposal
- [ ] Init aliases the seed's kept commit as `<night>-r0-seed`; `night.json`'s `seed` holds the seed night, its kept experiment, its last round, the primary value, the metrics and the rescore flag, worked out by comparing the seed night's scoring hashes with the current ones
- [ ] The checkpoint starts with the seed's dev metrics; the seed night's noise carries over when the scoring hashes are equal, so no A/A run follows; coders and reviewers read a `<start>` note naming the seed night, and the trajectory starts with it
- [ ] A seeded night that kept nothing ends with its seed as `kept`, with `dev_score` the seed's primary value; continuing it starts from the seed commit with the seed's metrics
- [ ] Unit tests cover `latest` and `best` and each refusal, with fabricated night folders
- [ ] On mock models: after `datenorm-smoke --mock` finishes, `run-night --config configs/datenorm-smoke.yaml --mock --seed latest --rounds 1` prints `done`; the new night's `night.json` names the seed; `refs/exp/<night>-r0-seed` points at the seed night's kept commit; round 1's row has `parent_id` `<night>-r0-seed`; there is no `noise` row in the new night
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
