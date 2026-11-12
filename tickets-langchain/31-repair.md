# 31: Repair

**What to build:** A commit that failed before it was scored gets one repair. The failed attempt `e0` keeps its row and its note; attempt `e1` starts from the failed commit with the masked errors and the same hypothesis, is decided against the same checkpoint, and stands for the round.

**Spec sections:**
- "Experiment lifecycle" > "Repair": all of it
- "Experiment lifecycle" > "Round loop": step 8
- "Experiment lifecycle" > "Ids": the repair's experiment id and its evaluator sandbox (`-eval1`)
- "Coder" > "Prompt": the repair's `<failures>` and workflow; "Send-backs, reserve and wrap-up": none for a repair
- "Memory within and across nights" > "Notes, trajectory and rejected diffs": the note of a failed attempt that gets a repair; in a repaired round the last row stands
- "Known gaps": the repair's leak scan covers only what `e1` adds over `e0`

**Not yet:** the worker API's rule that `e1` takes over the live view (ticket 37).

**Blocked by:** 17 (Reviewer); 19 (Check, leak scan and guardrails); 25 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] Repairable: a commit, changed files, and either `check` errors or an evaluation that returned `ok: false` and was not a credit stop
- [ ] Not repairable: an evaluator that failed out of its retries, and a `check` command that itself failed; both are `error` with no repair
- [ ] A repair is allowed only if a stop check passes with the failed attempt's spend and tokens added; at most one per round
- [ ] The failed attempt's row (`error`, `reviewer_usd` 0, its own cost) and its note (heading and coder part only) are written before `e1` starts
- [ ] `e1`'s sandbox starts from `e0`'s commit; its prompt is the repair prompt; it gets no research, no plan, no send-backs
- [ ] The decision, the review's diff and the rejected diff compare `e1` with the checkpoint; `e1`'s leak scan covers the lines it adds over `e0`
- [ ] An `e1` whose tree equals `e0`'s is recorded as `revert`, `unchanged: true`, with the checkpoint's metrics, and its diff against the checkpoint is saved as the rejected diff
- [ ] The round is reviewed once, after `e1`
- [ ] Tests drive a round with a temporary scenario whose program fails on dev, on mock models: the rows `<night>-r1-e0` (`error`) and `<night>-r1-e1` both exist, both notes exist, and the night finishes with `done.json`
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
