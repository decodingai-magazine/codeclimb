# 03: Night config: parse, defaults, validation, night ids, results paths

**What to build:** An operator's yaml is parsed into the resolved night config that travels in the start event: defaults applied, every validation of the spec enforced with a clear error, the scenario embedded, the deadline parsed, and paths resolved the way the CLI and the worker each need. Night ids and the mock results directory follow the CLI's rules.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Night config", "CLI", "Mock mode"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, scoring hashes, report flattening)

**Status:** ready-for-agent

- [ ] All five given configs parse; unit tests cover every default of the config table
- [ ] Unit tests cover each validation: reviewer must differ from coder (string comparison, thinking levels included), the 50-minute caps on `sandbox: inngest` and their re-check after a `--sandbox` override, deadline forms (ISO, `90m`, `8h`, `30s`), `latency_` / `cost_` prefixes, thresholds ≥ 1 and > 0, weights only for threshold metrics, `min_efficiency_gain` in (0, 1), `lessons` not `off` without scenario lessons, `max_tokens` a positive integer
- [ ] Relative `scenario` and `results_path` resolve against the directory the command is started in; the config in the event carries paths relative to the checkout and resolves on the worker against `CODECLIMB_ROOT` (default: its cwd) (unit tests)
- [ ] A results directory not directly under `<root>/runs/` (or `<root>/runs/mock/` for a mock night) is refused; the mock transform moves `runs/<name>/…` to `runs/mock/<name>/…` (unit tests)
- [ ] Night id: the default `n<YYYYMMDD>-<HHMMSS>` from local time, and the validity rule (1 to 48 letters, digits or hyphens, no leading hyphen) (unit tests)
- [ ] `--rounds` replaces `max_rounds` on a new night; a local night turns `sandbox: inngest` into `docker` with a printed note (unit tests on the override function)
