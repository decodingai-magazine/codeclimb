# 27: Repair

**What to build:** A commit that failed before it was scored (check errors, or a failed evaluation) says nothing about its idea, so it gets one repair attempt `e1` from the failed commit, with the masked errors and the same hypothesis, told to fix the failure and nothing else. `e1` is decided against the same checkpoint and stands for the round.

**Spec sections:**
- "Features": **Repair**; **Send-backs and wrap-up** ("A repair gets neither")
- "Architecture": the data flow of a round ("at most one repair")
- "Interfaces the build must honour" > "Ids": the repair id
- "Interfaces the build must honour" > "Files a night writes": "A failed attempt that gets a repair has the coder part only"
- "Numbers": repairs per round; "none for a repair"

**Not yet:** nothing.

**Blocked by:** 16 (Check, leak scan and guardrails); 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] An `e0` decided `error` with `not scored` gets one repair `<night>-r<N>-e1`, starting from `e0`'s commit, with `e0`'s errors masked and the same hypothesis; its prompt tells it to fix the failure and nothing else
- [ ] `e0` keeps its `error` row and its note, which has the coder part only; `e1` gets its own row, note and files, and is decided against the same checkpoint
- [ ] A repair gets no send-back and no wrap-up; there is never an `e2`
- [ ] No repair starts when a soft-stop check would fail at that point; an `e0` that failed outright (`the experiment failed`) or was reverted gets none
- [ ] The round's review reads `e1` and its verdict goes on `e1`'s note
- [ ] With a temporary `datenorm` copy whose `check` fails `e0` only (outside `scenarios/`), a mock night records `e0` `error`, then `e1` scored; its `e1` session holds no send-back and no wrap-up
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
