# 03: Night config: parse, defaults, validation, night ids, results paths

**What to build:** An operator's yaml is parsed into the resolved night config that travels in the start event: defaults applied, every validation of the spec enforced with a clear error, the scenario embedded, the deadline parsed, and paths resolved the way the CLI and the worker each need. Night ids and the mock results directory follow the CLI's rules.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Night config", "CLI", "Mock mode"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, scoring hashes, report flattening)

**Status:** ready-for-agent

- [ ] Every given config loads unchanged: the five under `configs/`, and `configs/e2e/plateau.yaml` and `configs/e2e/budget.yaml`; `configs/e2e/overfit.yaml` loads once `npm run build:scenario:overfit` (ticket 01) has written its scenario and fails with a clear error before that; unit tests cover every default of the config table
- [ ] Unit tests cover each validation: reviewer must differ from coder (string comparison, thinking levels included), deadline forms (ISO, `90m`, `8h`, `30s`), `latency_` / `cost_` prefixes, thresholds ≥ 1 and > 0, weights only for threshold metrics, `min_efficiency_gain` in (0, 1), `lessons` not `off` without scenario lessons, `max_tokens` a positive integer, `max_rounds` ≥ 1, and a missing required field
- [ ] A relative `scenario` resolves against the directory the command is started in. `results_path` is relative to the runs folder: `datenorm-smoke/results.jsonl` resolves to `runs-inngest/datenorm-smoke/results.jsonl` under the root, and to `runs-inngest/mock/datenorm-smoke/results.jsonl` for a mock night. It is resolved once: the config in the event and in `night.json` carries the resolved path relative to the checkout, the worker resolves it against `CODECLIMB_ROOT` (default: its cwd), and resolving an already resolved config adds no second runs folder or `mock/` (unit tests)
- [ ] Refused when the config loads, each with a clear error: a `results_path` that is absolute, that has a `..` segment, or that is not one folder and a file name. Every accepted results directory therefore sits directly under `runs-inngest/` or `runs-inngest/mock/` (unit tests)
- [ ] Night id: the default `n<YYYYMMDD>-<HHMMSS>` from local time, and the validity rule (1 to 48 letters, digits or hyphens, no leading hyphen) (unit tests)
- [ ] `--rounds` replaces `max_rounds` on a new night; a `sandbox` value other than `docker` is refused when the config loads, and `--sandbox docker` is accepted and changes nothing (unit tests)
