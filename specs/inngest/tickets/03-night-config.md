# 03: Night config, night ids and the runs folder

**What to build:** A night config yaml becomes a validated, resolved config with every default filled in and its scenario loaded, or is refused with a clear reason before anything starts. Night ids and the runs folder follow the spec's rules, for real and for mock nights, and `run-night` parses its flags.

**Spec sections** (`specs/inngest/spec.md`): "Night config", "CLI", "Environment", "Mock mode"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, report metrics, scoring hash)

**Status:** ready-for-agent

- [ ] Every given config loads unchanged; `configs/e2e/overfit.yaml` loads once `npm run build:scenario:overfit` has run and fails with a clear error before
- [ ] Every default of the config table is filled in (unit tests, one per field)
- [ ] Refused at load, each with a clear error (unit tests): a missing required field; `sandbox` other than `docker`; `max_rounds` below 1; a thinking level outside the five; a threshold not above 0; a weight not above 0 or on a metric without a threshold; `min_efficiency_gain` outside (0, 1); `reviewer_model` equal to `model` with the same thinking level; an unparsable `deadline`; a `results_path` that is absolute, has `..`, or is not one folder and a file name; `lessons` not `off` on a scenario without lessons; `budget_usd.experiment` above `budget_usd.night`
- [ ] `deadline` and `hard_deadline` accept an ISO time or a duration from the night's start (`90m`, `8h`, `30s`) (unit tests)
- [ ] `scenario` resolves against the directory `run-night` starts in; the runs folder is `<root>/runs-inngest/`, a mock night's is `<root>/runs-inngest/mock/`, `<root>` is `CODECLIMB_ROOT` or else the start directory; the results directory is the folder of the resolved `results_path` (unit tests)
- [ ] Night id: `--night-id` or else `n<YYYYMMDD>-<HHMMSS>`; valid ids are 1 to 48 letters, digits or hyphens, not starting with a hyphen (unit tests)
- [ ] Flags: `--rounds` replaces `max_rounds` on a new night; `--seed` wins over the config's `seed`; `--sandbox` takes only `docker`; `--mock-offline` only with `--mock` (unit tests)
- [ ] A refused config or flag makes `run-night` exit non-zero naming the problem, and nothing is written under `runs-inngest/`
