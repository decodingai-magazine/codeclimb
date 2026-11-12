# 25: Repair: one fix attempt for a commit that failed before scoring

**What to build:** When an experiment has a commit with changed files but `check` errors or a failed evaluation (not a credit stop), the loop records the failed attempt and starts `e1` from the failed commit with the masked errors and a fix-only prompt. `e1` is decided against the same checkpoint and stands for the round.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Repair", "Round loop", "Keep rule", "Prompt", "Ids", "Notes, trajectory and rejected diffs", "Known gaps"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] The repairable test and the allowed test (a stop check with the failed attempt's spend and tokens added) are pure and unit-tested; an evaluator run that failed out of its retries is an `error` with no repair; at most one repair per round
- [ ] Before `e1` starts, the failed attempt's row (`error`, its cost, `reviewer_usd` 0) and its note (heading and coder part only) are written
- [ ] `e1` uses the ids `<night>-r<N>-e1` and sandbox `cc-<night>-r<N>-eval1` for its evaluation, starts from the failed commit, gets the masked errors in `<failures>`, the same hypothesis and the repair prompt (review step only; no research, plan or send-backs)
- [ ] The decision, the review's diff and the rejected diff compare `e1` with the checkpoint; `unchanged` compares `e1` with `e0`, and an `e1` equal to `e0` is recorded as `revert`, `unchanged: true`, with the checkpoint's metrics and its diff still saved as the rejected diff
- [ ] In a repaired round the log's last row stands for the round
- [ ] End-to-end, mock, dev server: a scenario and config from test-only copies (inside the checkout but outside `scenarios/` and `configs/`, gitignored, each with its own name and a `results_path` directly under `runs/`) whose `check` reports an error for the mock commit (or whose program fails once) produces rows `r1-e0` with `error` and `r1-e1`, two notes, and one review; the night still prints `done`
- [ ] Kept as the reference has it, do not fix: the repair's leak scan covers only the lines `e1` adds over `e0`
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
