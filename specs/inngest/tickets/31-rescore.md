# 31: Rescore: a kept commit is scored again when the scoring changed

**What to build:** When a scenario's scoring files changed since the kept commit was scored, old scores can't be compared. So a continued or seeded night first evaluates that commit again on dev in one extra round, then measures noise again, before its rounds run.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Rescore; Noise margin; Continue; Seed), "Scenario contract", "Files a night writes"

**Blocked by:** 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes); 30 (Seed: a new night that starts from an ended night's kept commit)

**Status:** ready-for-agent

- [ ] A continued or seeded night compares the scenario's scoring files with the `metric_script_sha256` recorded where its kept commit was scored (unit tests)
- [ ] When they differ, one extra round evaluates the kept commit on dev, records it as an `experiment` row with `model` null, and takes its new metrics as the checkpoint's; the noise is then measured again with an A/A run
- [ ] When they match, no extra round runs
- [ ] End to end on mock nights with a test-only scenario and config copy: finish a night, change a file under the copy's `evaluators/`, continue it; the extra round's row comes first, then a `noise` row, then the new round, and the night ends with `done`. The same holds for a night seeded from it
- [ ] Nights 1 to 3 still pass the check of ticket 20
