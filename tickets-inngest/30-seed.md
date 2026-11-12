# 30: Seed: a new night that starts from an ended night's kept commit

**What to build:** Instead of the starter, a seeded night's round 0 is an alias of the seed night's kept commit, with that commit's dev metrics as the checkpoint round 1 must beat and the seed night's noise carried over. The new night has its own id, budget and trajectory, which opens with a `<start>` note naming where it came from.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Continue, seed and rescore", "Init", "Ids", "CLI", "Noise margin", "Notes, trajectory and rejected diffs", "Files a night writes"

**Blocked by:** 26 (Continue: more rounds on an ended night, with an operator's direction); 28 (Lessons distillation: what a night learned reaches the next night)

**Status:** ready-for-agent

- [ ] The CLI resolves `latest` (newest `startedAt` among ended nights under the config's results directory) and `best` (highest weighted dev score among ended nights of this scenario with equal scoring hashes, a tie to the newer, test never counting) to an id before the night starts (unit tests on fabricated nights)
- [ ] Refused: a seed night that kept nothing; one with `stop.json` and no `night.json`; one whose lessons are not in `lessons.md` yet, under exactly the four conditions the spec lists (unit tests)
- [ ] Init aliases the seed's commit as `<night>-r0-seed`; `night.json`'s `seed` holds the seed night, its kept experiment, its last round, the primary value, the metrics and the rescore flag
- [ ] The checkpoint starts with the seed's metrics; a seeded night that keeps nothing still has its seed as checkpoint, its test evaluation runs on it, and `done.json`'s `kept.dev_score` is the seed's primary value
- [ ] The seed night's `noise.json` carries over when the scoring hashes are equal, so no A/A run happens; the trajectory starts with the `<start>` note for coders and reviewers
- [ ] The seed setting comes from the config's `seed` or `--seed`; a later continue of a seeded night reads `night.json`'s `seed`
- [ ] End-to-end, mock, dev server: after a `datenorm-smoke --mock` night that kept round 1, `run-night --config configs/datenorm-smoke.yaml --mock --seed latest` starts from `<night>-r0-seed` pointing at that kept commit, records no `noise` row, and ends with `done`
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
