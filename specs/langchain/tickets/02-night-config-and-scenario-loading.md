# 02: Night config and scenario loading

**What to build:** `npm run run-night -- --config <yaml> [flags]` parses its arguments, loads the night config and its scenario, applies the defaults, resolves paths against `<root>`, and refuses a bad config or a bad flag with exit 2 and a message that names the field. The resolved config, the night id and the scoring hashes are what later tickets write into `night.json`.

**Spec sections:**
- "Interfaces the build must honour" > "Night config": all of it
- "Interfaces the build must honour" > "Scenario contract": the directory layout, the `scenario.yaml` table, the stage field table, "scoring hashes"
- "Interfaces the build must honour" > "CLI": the flags of `run-night`, the night id rule, "a usage or validation error exits 2"
- "Interfaces the build must honour" > "Mock mode": results go to `runs-langchain/mock/<results_path>`
- "Interfaces the build must honour" > "Given inputs": `budget.yaml` and `overfit.yaml` load
- "Interfaces the build must honour" > "Environment": `CODECLIMB_ROOT`

**Not yet:** starting a night (ticket 12), the model checks (ticket 20). Here `run-night` stops after a successful validation.

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] Every field of the night config table is read with its default: `plateau_rounds` 3, `coder_thinking` `medium`, `reviewer_thinking` `low`, `allowed_models` `[]`, `weights` 1 each, `gates` `{}`, the `standard_metrics` defaults, the `noise_margin` defaults (`min` 0.002, `max` 0.005, `fixed` none, `scale_by_replay` true), `lessons` `apply` when the scenario declares lessons and `off` otherwise
- [ ] Refused at load, exit 2: a missing required field; `sandbox` other than `docker`; `max_rounds` < 1; a threshold ≤ 0; a weight ≤ 0 or on a metric that has no threshold; a thinking level outside `off`, `minimal`, `low`, `medium`, `high`; a reviewer equal to the coder in both model and thinking; a `results_path` that is absolute, holds `..` or is deeper than `<folder>/results.jsonl`; a `budget_usd.experiment` above `budget_usd.night`; a `seed` that is not a night id, `latest` or `best`
- [ ] `deadline` and `hard_deadline` accept an ISO time or a duration from the start (`90m`, `8h`, `30s`); anything else is refused
- [ ] `<root>` is `CODECLIMB_ROOT`, by default the start directory; `scenario` resolves relative to where `run-night` starts; `results_path` resolves once to `<root>/runs-langchain/<results_path>`, or `<root>/runs-langchain/mock/<results_path>` with `--mock`
- [ ] `scenario.yaml` is validated: `name`, `image`, `bundle`, at least one stage with a unique name matching `^[a-z][a-z0-9_-]*$`, each stage with `inputs`, `run` and `score`; the optional fields `headline`, `diagnostics`, `protocol`, `check`, `scan`, `lessons`, `files`, `details` are read when present
- [ ] The scoring hashes are a sha256 of the scenario's scoring files: changing an evaluator changes them, changing the starter or the agent spec does not (unit test)
- [ ] Night id: `--night-id` or `n<YYYYMMDD>-<HHMMSS>`; 1 to 48 letters, digits or hyphens, not starting with a hyphen; anything else exits 2
- [ ] An unknown flag, `--mock-offline` without `--mock`, or a bad `--rounds` exits 2
- [ ] Every given config under `configs/` loads (`overfit.yaml` after `npm run build:scenario:overfit`), and each of the four given scenarios loads (unit tests)
- [ ] `npm run typecheck` and `npm test` pass
