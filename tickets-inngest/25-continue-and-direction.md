# 25: Continue: more rounds on an ended night, with an operator's direction

**What to build:** An operator can add rounds to a night that finished or was stopped. The sender reopens the night's files before the start event goes out, so the night reads as running at once; the continued run rebuilds its state from the rows, reviews, notes and `noise.json`, numbers its rounds on, and ends with its own test evaluation. A direction, on a continued or a new night, reaches every coder and reviewer after masking.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Continue, seed and rescore", "CLI", "Events", "Init", "Prompt", "Reviewer", "Files a night writes"

**Blocked by:** 21 (Done signal: both mock nights pass the end-to-end checks)

**Status:** ready-for-agent

- [ ] Reopening is one function usable by the CLI and later by the worker API, doing the listed steps in order: check the night ended and ran this scenario; move files of rounds past the last recorded round to `unfinished/after-r<last>-<time>/`; rename the end file to `done-r<last>.json` / `stop-r<last>.json`; work out `max_rounds` and the budget; rewrite `night.json` with the new deadline, config and scoring hashes while `startedAt` stays (unit tests on a fabricated night folder)
- [ ] A second continue of a night that is running is refused; a night with `stop.json` and no `night.json` can't be continued; `--seed` with `continue` is refused
- [ ] The state table "Where a continued run's state comes from" is implemented as a pure rebuild from files and unit-tested row by row: checkpoint, last round, spend, feedback and hypothesis, log, noise, the counters that start at zero, `rounds` in the new `done.json`
- [ ] Budget: `run_budget_usd` is saved at the first continuation and every continuation sets the night budget to spend so far plus `run_budget_usd`, never compounding (unit test over two continuations)
- [ ] `--rounds` adds to the rounds so far (default: the config's `max_rounds`); the deadline restarts from now; the bundle is rebuilt with `history/` preserved; `run-night continue` defaults to the newest ended night under the config's results; the start event uses a fresh id and carries `continue`
- [ ] A direction (`continue` with `--direction`, or a new night's `--direction`, never both in one event) is masked with `scan` in a step of its own right after init, appears as `<direction>` in every coder prompt and in the reviewer's prompt, and on a continued night replaces the hypothesis the night had reached
- [ ] End-to-end, mock, dev server: after a finished `datenorm-smoke --mock` night, `run-night continue --config configs/datenorm-smoke.yaml --rounds 1 --direction "try X"` follows the new round (it does not print `done` at its first poll), ends with `done`, leaves `done-r2.json` beside a new `done.json` with `rounds: 3`, a second `test` row, and round 3's coder prompt holds the direction
- [ ] A night that ran with `--mock` continues on mock models and stays under `runs/mock/`, from the CLI and later from the API; the spec's `continue` syntax names no `--mock`, so the mechanism is the builder's choice (a flag, or reading the night's saved config) and is documented
- [ ] End-to-end: a mock night stopped as soon as round 2's `code-state.json` appears and then continued reruns that round from scratch, with the old round's files under `unfinished/`
- [ ] Both mock nights of ticket 21 still pass every check of "Goal and done signal"
