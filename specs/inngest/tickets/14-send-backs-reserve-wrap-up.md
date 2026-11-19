# 14: Send-backs, reserve and wrap-up

**What to build:** A coder that stops early, with open tasks or without a train measurement, is sent back for one more turn, a bounded number of times, and is told once to wrap up: close its tasks, update its measurement and notes, change no more code. The rules are exact, because the done signal counts the messages.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Send-backs, reserve and wrap-up; Coder; Repair), "Files a night writes", "Numbers"

**Blocked by:** 09 (Coder experiment: from the prompt to one commit)

**Status:** ready-for-agent

- [ ] The reserve is the last 20% of the experiment's time or budget
- [ ] A coder that stops outside its reserve, or with an open task list, or (when the bundle has `train/`) with a missing train measurement, is sent back; at most 8 times, none with under 3 minutes left, none for a repair (unit tests, one per condition and per limit)
- [ ] The wrap-up comes at most once per experiment: when the reserve starts while the coder works, or as one more turn after the send-back loop ends for a coder sent back at least once, also when the loop ended on the send-back cap before the reserve. No wrap-up with under 3 minutes left, after a time or budget cap stop, for a coder never sent back, or for a repair (unit tests, one per case)
- [ ] A send-back message contains "You stopped with N of N minutes" and the wrap-up "change no more code"; no other prompt the project sends contains either phrase (unit test over every prompt builder)
- [ ] Docker test with mock models and a 5-minute experiment: the session holds eight send-backs, then one wrap-up, all started within the first 2 minutes, and the experiment ends with `stop: done`. On whole nights this is C8, asserted in ticket 20
