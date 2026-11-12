# 32: Continue

**What to build:** `npm run run-night -- continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N]` runs more rounds on an ended night under the same id. The night is reopened before its new server run is created, runs on a new thread, numbers its rounds on from the last recorded one, starts from the kept commit with the last review's feedback and hypothesis, and ends with its own test evaluation and a new `done.json`.

**Spec sections:**
- "Experiment lifecycle" > "Continue, seed and rescore": the "Continue" bullets and the table "Where a continued variation's state comes from"
- "CLI": `run-night continue`, `--direction`, `--rounds`, the default night, mock by folder
- "Interfaces" > "Control operations": `variation` and `continue` in the start input
- "Durable runtime on LangGraph": the night thread row (a random UUID per continue, `run` + 1); the bullet "a continue gets a new thread"
- "Coder" > "Prompt": `<direction>`; "Reviewer": the direction
- "Data and files" > "Files a night writes": `run_budget_usd`, `variation`
- "Known gaps": a stop leaves `pause.json` behind

**Not yet:** the rescore round (ticket 37): the reopening works out the rescore flag and passes it, and this ticket's tests keep the scoring hashes unchanged. The API's continue (ticket 38), which will call the same reopening.

**Blocked by:** 23 (Noise run; mock night 2 passes in full); 25 (Check table: mock nights 1 to 3 as one repeatable check); 26 (Stop operation and cleanup; mock night 4 passes); 29 (Pause for credits and resume)

**Status:** ready-for-agent

- [ ] Continue is refused for a night that has not ended, that ran another scenario, or that has a `stop.json` and no `night.json`; `--seed` with `continue` and `--direction` without it are usage errors
- [ ] Reopening happens in the caller, in the spec's order: check; move files of rounds past the last recorded round to `unfinished/after-r<last>-<time>/`; rename the end file to `done-r<last>.json` or `stop-r<last>.json`; work out the rescore flag, `max_rounds` and the budget; rewrite `night.json` with the new deadline, config and scoring hashes, `startedAt` unchanged
- [ ] After reopening the night reads as running: a second continue is refused and following never prints the old `done`
- [ ] The budget is what the night has spent plus `run_budget_usd`, which is set once at the first continuation; continuing twice does not compound
- [ ] `--rounds` adds to the rounds so far; the default is the config's `max_rounds`; the deadline restarts from now
- [ ] The variation's first step rebuilds the bundle (keeping `history/`) and the state from the table: checkpoint from the last `keep` row, last round, spend, feedback and hypothesis from the newest review file, history lines from the rows, `noise.json` as it is, counters at zero, the pause count
- [ ] A direction reaches every new coder and reviewer, masked with `scan`, and replaces the hypothesis the night had reached
- [ ] The variation runs on a new thread with metadata `run` raised by 1, ends with its own test evaluation, and its `done.json` has `rounds` equal to the night's last round number
- [ ] Pause numbers run on across variations: a mock night that paused once, was resumed and finished, then is continued with `mock_credit`, pauses with number 2
- [ ] Unit tests cover the state rebuild from rows and files, the budget rule and the reopening order
- [ ] On mock models: after `datenorm-smoke --mock` finishes, `run-night continue --config configs/datenorm-smoke.yaml --night <id> --rounds 1` prints `done`; `done-r2.json` exists; the new `done.json` has `rounds: 3`; `results.jsonl` has a round-3 experiment row whose `parent_id` is the kept experiment, a second `test` row, no second `noise` row, and passes `validate-results`; a stopped mock night (ticket 26) can be continued the same way
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
