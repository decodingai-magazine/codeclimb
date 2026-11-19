# 02: Scenario contract: load, host commands, masking, report metrics, scoring hash

**What to build:** CodeClimb can load any given scenario and drive it without ever reading its data: it runs the commands of `scenario.yaml` on the host to write the coder's bundle, write a stage's inputs, score a stage's outputs, check a commit, scan text for held-out names and read the protocol files. A stage report becomes flat metrics, and the scenario's scoring files get one hash that later nights compare.

**Spec sections** (`specs/inngest/spec.md`): "Scenario contract", "Architecture", "Features" (Evaluator; Standard metrics)

**Blocked by:** 01 (Project scaffold, npm scripts, env loading and sandbox images)

**Status:** ready-for-agent

- [ ] The four given scenarios (`datenorm`, `datenorm-hard`, `capitals`, `graphrag`) load. Load fails with a clear error without `scenario.yaml`, without `starter/`, with no stage, or with a stage name that does not match `^[a-z][a-z0-9_-]*$` (unit tests on test-only copies)
- [ ] Host commands run through `bash -c` in the scenario directory; every placeholder is substituted as a shell-quoted absolute path, so a path with a space works (unit tests)
- [ ] `bundle` is always given an empty target; a bundle without `spec/` is an error; a bundle holding `train/` is reported as switching on the train-measurement duty. Running `datenorm`'s real `bundle` command into an empty folder yields a folder holding `spec/`
- [ ] `protocol` entries resolve to text, a `path#Heading` entry to that one section (unit test on `graphrag`'s `README.md#Scoring`)
- [ ] `check` returns the report's `errors` and `notes` lists; `scan` returns the report's `found` list, and masking replaces each found name with `[hidden]`; a scenario without `scan` finds nothing (unit tests with fake check and scan scripts)
- [ ] A stage report becomes metrics as the contract states: numbers flattened with `.`, `ci95: [lo, hi]` becomes `ci95_half`, with several stages every name gets `<stage>.` in front, and each stage adds `output_bytes` (unit tests on a one-stage and a three-stage fixture)
- [ ] The scoring files of a scenario hash to one `metric_script_sha256`: the same files give the same hash, and a change to an evaluator file gives another (unit tests)
- [ ] No CodeClimb code parses a scenario's data files; only the scenario's own commands read them
