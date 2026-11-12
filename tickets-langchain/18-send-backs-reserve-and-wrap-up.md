# 18: Send-backs, reserve and wrap-up

**What to build:** A coder that stops early is sent back for one more turn, up to 8 times, until it is in its reserve with its tasks closed and its train measurement in place. Once per experiment it gets the wrap-up, either as a steering message when the reserve starts mid-turn or as one more turn after the send-back loop.

**Spec sections:**
- "Coder" > "Send-backs, reserve and wrap-up": all of it
- "Coder" > "Pi facts found while building": the "Steering" row
- "Scenario contract" > "Splits": a `train/` directory in the bundle switches on the train-measurement duty
- "Known gaps": the bullet on the mock coder's 8 send-backs and the 3-minute floor
- "Every number in one place": coder rows "reserve" and "send-backs"

**Not yet:** repairs get no send-backs, but repair itself is ticket 31; the send-back after a failed model call is exercised in ticket 28.

**Blocked by:** 15 (Tracer night: `datenorm-smoke` on mock models)

**Status:** ready-for-agent

- [ ] The reserve is the last 20% of the experiment's time or of its budget, whichever comes first
- [ ] A send-back happens when the task file is missing, invalid or has an open task; when the bundle has `train/` and the train measurement is missing, invalid, or fell with no `why`; or when the coder is not in its reserve yet
- [ ] The send-back message contains "You stopped with N of N minutes and $X of $Y left", after any task or train problem, names the next step and asks for exactly one change, as the spec words it
- [ ] Limits: at most 8 send-backs; none for a repair; none with less than 3 minutes left; none after a cap stop
- [ ] The wrap-up is sent at most once, contains "change no more code", and arrives mid-turn (a timer at 80% of the time, a budget check after each assistant message) or as one more turn after the loop for a coder that was sent back at least once; never with less than 3 minutes left, after a cap stop, or for a coder never sent back
- [ ] "You stopped with" appears only in send-back messages and "change no more code" only in the wrap-up, across every prompt text of the build (a unit test scans them)
- [ ] Unit tests cover the send-back decision and the limits with a faked clock
- [ ] On `datenorm-smoke --mock`: each experiment's session file holds eight send-backs, then one wrap-up; `exps/*/train-score.json` and `exps/*/tasks.json` exist; `code-state.json` still ends with `stop: done`
- [ ] `npm run typecheck` and `npm test` pass
