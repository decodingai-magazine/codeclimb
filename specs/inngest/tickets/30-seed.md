# 30: Seed: a new night that starts from an ended night's kept commit

**What to build:** A seeded night starts from an ended night's kept commit and dev metrics instead of the starter: `latest`, `best` (highest weighted dev score under unchanged scoring) or a night id. It is a new night with its own id; round 1 must beat the seed's dev metrics.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Seed; Loop), "CLI", "Night config", "Ids and names", "Files a night writes"

**Blocked by:** 26 (Continue: more rounds on an ended night, with an operator's direction)

**Status:** ready-for-agent

- [ ] The seed comes from `--seed ID|latest|best` or the config's `seed`, `--seed` winning (unit test)
- [ ] `latest` is the newest ended night under the config's results; `best` the ended night with the highest weighted dev score among those whose scoring files hash the same as now; test never counts (unit tests on fabricated night folders)
- [ ] A seed that is not an ended night, or whose checkpoint has no dev metrics (it kept nothing and was not seeded), is refused before anything starts
- [ ] The seed night's `noise.json` carries over when the scoring is unchanged, and no A/A run is due; without one, round 1 starts with the A/A run
- [ ] Init records the seed's kept commit as `<night>-r0-seed`; round 1's checkpoint is that commit with its dev metrics; `night.json`'s `seed` names the seed
- [ ] A seeded night that keeps nothing scores the seed commit on test
- [ ] End to end: after a `datenorm-smoke --mock` night that kept round 1, `run-night --config configs/datenorm-smoke.yaml --mock --seed latest` starts from `<night>-r0-seed` at that kept commit and ends with `done`
- [ ] Nights 1 to 3 still pass the check of ticket 20
