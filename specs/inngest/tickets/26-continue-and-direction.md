# 26: Continue: more rounds on an ended night, with an operator's direction

**What to build:** `run-night continue` runs more rounds on an ended night (one with a `done.json` or a `stop.json`) under the same id, from its kept commit (its round-0 commit when it kept nothing), with its last feedback and hypothesis and, optionally, an operator's direction. Its state is rebuilt from the night's files, and each continued run ends with its own test evaluation. A direction can also be given to a new night.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Continue; Loop), "CLI", "Files a night writes", "Ids and names", "Result row"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes)

**Status:** ready-for-agent

- [ ] `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N]` continues the named night, or the newest ended one under the config's results; a night that has not ended is refused, and nothing starts
- [ ] `--rounds` adds rounds to the night's rounds so far
- [ ] The continued run starts from the kept commit, or the round-0 commit when nothing was kept, with the night's last feedback and hypothesis; its state is rebuilt from the night's files only (unit tests on fabricated night folders)
- [ ] `--direction TEXT`, on `continue` or on a new night, reaches the coder's prompt of the rounds that follow (unit test on the prompt builder)
- [ ] Each continued run ends with its own test evaluation, `<night>-test-r<N>` of its last round, and a new `done.json` (or `stop.json`); the night's folder never holds both
- [ ] A night under `runs-inngest/mock/` is continued as a mock; `continue` takes no `--mock`
- [ ] End to end: after a finished `datenorm-smoke --mock` night, `run-night continue --config configs/datenorm-smoke.yaml --night <id> --rounds 1 --direction "<text>"` runs one more round on mock models, prints `done` with `rounds: 3` in `done.json`, records its own `test` row, and every `eval_id` is in `results.jsonl` once
- [ ] End to end: a mock night stopped with `run-night stop` during round 2 and then continued runs to `done`
- [ ] Nights 1 to 3 still pass the check of ticket 20
