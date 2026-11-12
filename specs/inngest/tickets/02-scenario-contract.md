# 02: Scenario contract: load, host commands, masking, scoring hashes, report flattening

**What to build:** Given a scenario directory, CodeClimb parses and validates `scenario.yaml` into the scenario object that later travels in the start event, fills command placeholders, runs host commands under the spec's limits, masks held-out names found by `scan`, computes the scoring hashes, and flattens a stage report into metrics. CodeClimb never reads a scenario's data: it only runs its commands.

**Spec sections** (`specs/inngest/spec.md`): "Scenario contract", "How a scenario is loaded", "Splits", "Stage reports become metrics"

**Blocked by:** 01 (Project scaffold, npm scripts, env file and sandbox images)

**Status:** ready-for-agent

- [ ] Each given scenario (`datenorm`, `datenorm-hard`, `capitals`, `graphrag`) loads; unit tests cover every load failure the spec names (missing `scenario.yaml`, missing `starter/`, `lessons` naming a missing file, no stage, duplicate or ill-formed stage name, a bad `diagnostics` regex) and prove that nothing else is checked
- [ ] Placeholders are shell-quoted, host-side values are absolute paths, and an unknown placeholder is an error (unit tests)
- [ ] A host command runs through `bash -c` in the scenario directory with the 30-minute timeout and 64 MiB output limit; a failure throws with the last 2,000 characters of output cut at a line start (unit tests with short test limits)
- [ ] `protocol` entries resolve, including the `path#Heading` form that takes one `## Heading` section
- [ ] The `check` and `scan` wrappers return the report's lists; without `scan`, or for empty text, nothing is found; masking replaces every found name with `[hidden]` in any letter case, longest name first (unit tests)
- [ ] The scoring hashes map covers `scenario.yaml` and every file under `evaluators/` and `gold/`, skips `__pycache__`, uses paths relative to the checkout, and a file-by-file comparison reports any difference (unit tests)
- [ ] Report flattening follows "Stage reports become metrics": dotted keys, skipped lists / non-numbers / `per_item` / `details`, `ci95` to `ci95_half`, the `<stage>.` prefix only with more than one stage, `output_bytes` per stage, standard metrics winning a name clash (unit tests)
- [ ] Running the real `bundle` command of `datenorm` into an empty folder through this layer yields a folder holding `spec/`
