# 25: Repair: one fix attempt for a commit that failed before scoring

**What to build:** A commit that failed before it was scored (repository-check errors or a failed evaluation) says nothing about its idea, so it gets one repair attempt `e1`, started from the failed commit with the masked errors and told to fix that failure only. The failed attempt keeps its `error` row and its note; `e1` is decided against the same checkpoint and stands for the round.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Repair; Keep rule; Loop; Send-backs, reserve and wrap-up), "Ids and names", "Result row", "Files a night writes", "Numbers"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] A round whose `e0` has repository-check errors or a failed evaluation gets one repair `<night>-r<N>-e1`, at most one per round; no round has an `e2` (unit tests)
- [ ] The repair starts from the failed commit, gets the failure's errors masked with the scenario's `scan`, and is told to fix that failure only: no research, no send-backs, no wrap-up
- [ ] The failed attempt keeps its `error` row and its note; `e1` gets its own row and note, is evaluated as `<night>-r<N>-e1-eval`, is decided against the same checkpoint, and stands for the round
- [ ] End to end on a mock night with a test-only scenario and config copy whose `check` reports an error for the mock commit: rows `r1-e0` with `error` and `r1-e1`; a note for each; `e1`'s session holds no send-back and no wrap-up; `check.json` for both
- [ ] Nights 1 to 3 still pass the check of ticket 20
