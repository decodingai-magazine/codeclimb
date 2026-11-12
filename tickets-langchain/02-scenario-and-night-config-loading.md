# 02: Scenario and night config loading

**What to build:** Given a night config yaml, the build returns a validated config with the parsed scenario embedded, ready to travel in the start input, or a validation error that names the problem. Every given config under `configs/` loads against its scenario.

**Spec sections:**
- "Scenario contract" > "How a scenario is loaded" (the `scenario.yaml` table, the stage table, what load checks and what it does not)
- "Scenario contract" > "Splits": the scoring hashes only
- "Night config": the field table with defaults, and "Validation at parse" except the model check
- "CLI": the night-id rule and the default id
- "Mock mode": where a mock night's results go
- "Worker API": "finding nights" (the scan of `runs-langchain/` and `runs-langchain/mock/` for a night id)

**Not yet:** the model check (ticket 24); running any scenario command (ticket 03); the `run-night` command itself (ticket 15).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] Every given config loads unchanged: the five under `configs/`, and `configs/e2e/plateau.yaml` and `configs/e2e/budget.yaml`; `configs/e2e/overfit.yaml` loads once `npm run build:scenario:overfit` (ticket 01) has written its scenario and fails with a clear error before that; the result holds the parsed scenario and paths relative to the checkout
- [ ] Load fails when `scenario.yaml` or `starter/` is missing, when `lessons` names a missing file, when stage names repeat or break the pattern, when there is no stage, and when a `diagnostics` regex is bad
- [ ] Defaults match the field table (`plateau_rounds`, thinking levels, `standard_metrics`, `noise_margin`, `lessons` by scenario)
- [ ] Validation errors: reviewer equal to coder under the spec's rule; unparsable `deadline`; `latency_metric` / `cost_metric` prefixes; `noise_margin.min` above `max`; `max_rounds` below 1; a `max_tokens` that is not a positive integer; no threshold; non-positive thresholds or weights; `min_efficiency_gain` outside (0, 1); a thinking level or a `lessons` mode outside the listed values; a weight on a non-threshold metric; `lessons` not `off` without scenario lessons; a `results_path` that is absolute, that has a `..` segment, or that is not one folder and a file name
- [ ] A `sandbox` value other than `docker` is refused when the config loads
- [ ] `deadline` accepts an ISO time and the durations `90m`, `8h`, `30s`
- [ ] A night id is valid only as 1 to 48 letters, digits or hyphens, not starting with a hyphen; the default id has the form `n<YYYYMMDD>-<HHMMSS>` from local time
- [ ] A relative `scenario` resolves against the start directory. `results_path` is relative to the runs folder: `datenorm-smoke/results.jsonl` resolves to `runs-langchain/datenorm-smoke/results.jsonl` under the root, and to `runs-langchain/mock/datenorm-smoke/results.jsonl` for a mock night. It is resolved once: resolving an already resolved config adds no second runs folder or `mock/`
- [ ] The scoring hashes cover `scenario.yaml` and every file under `evaluators/` and `gold/`, skip `__pycache__`, are keyed by checkout-relative path, and compare file by file
- [ ] A night's folder is found by its id under both `runs-langchain/*/nights/` and `runs-langchain/mock/*/nights/`
- [ ] Unit tests cover the above; `npm run typecheck` and `npm test` pass
