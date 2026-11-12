# 14: Send-backs, reserve and wrap-up

**What to build:** A coder that stops with open tasks, no train measurement, or time and budget left gets another turn with a concrete next step; when the last 20% of its time or budget starts, it gets one wrap-up message, mid-turn as a steering message or as one more turn. A mock coder, which stops at once on every turn, therefore ends with exactly eight send-backs and one wrap-up in its session file.

**Spec sections** (`specs/inngest/spec.md`): "Send-backs, reserve and wrap-up", "End of an experiment", "Known gaps", "Every number in one place"

**Blocked by:** 09 (Coder experiment: from the prompt to one commit)

**Status:** ready-for-agent

- [ ] The send-back decision covers each condition (task file missing, invalid or with an open task; train measurement missing, invalid, or fallen with no `why` when the bundle has `train/`; not yet in the reserve) and each limit (at most 8, none for a repair, none with less than 3 minutes left, none after a cap stop) (unit tests)
- [ ] The send-back message contains `You stopped with N of N minutes and $X of $Y left` after any task or train problem, names the next step, and asks for exactly one change with the checkpoint, measure, keep-or-restore routine
- [ ] The reserve is the last 20% of the time or of the budget, whichever comes first; the wrap-up is sent at most once per experiment, by the 80% timer or the after-message budget check as a steering message while the session streams, or as one more turn after the send-back loop for a coder sent back at least once, including when the loop ended on the cap of 8
- [ ] No wrap-up turn with less than 3 minutes left, after a cap stop, or for a coder never sent back (unit tests)
- [ ] A unit test over every prompt and message the project can send proves `You stopped with` occurs only in the send-back message and `change no more code` only in the wrap-up
- [ ] Docker test with mock models and a 5-minute experiment: the session file holds eight messages containing `You stopped with` followed by one containing `change no more code`, all sent within the first 2 minutes, and the experiment ends with `stop: done`
