# 15: Send-backs, reserve and wrap-up

**What to build:** A coder that stops before its reserve (the last 20% of its time or budget), with open tasks or with a missing train measurement, is sent back for one more change, up to 8 times. Once the reserve starts, or after the send-backs end, it gets one wrap-up telling it to change no more code and close its work. A turn that ended on a failed model call is a stop like any other.

**Spec sections:**
- "Features": **Send-backs and wrap-up**; **Coder** ("A turn that ends on a failed model call is a stop like any other")
- "Interfaces the build must honour" > "Files a night writes": the literal phrases bullet
- "Numbers": the coder rows; the paragraph on the mock coder under the table
- "Goal and done signal": C8

**Not yet:** the repair, which gets neither (ticket 27); the budget part of the reserve once the dev ledger exists (ticket 18).

**Blocked by:** 12 (Tracer night: `datenorm-smoke` on mock models)

**Status:** ready-for-agent

- [ ] A coder that stops before its reserve, or with a task still `todo` in `/tmp/tasks.json`, or with no train measurement when the bundle has `train/`, is sent back, at most 8 times per experiment, and never with less than 3 minutes left
- [ ] Every send-back holds "You stopped with N of N minutes and $X of $Y left" with the real numbers; the wrap-up holds "change no more code"; neither phrase appears in any other prompt
- [ ] A coder that was sent back at least once, or that stops inside its reserve, gets exactly one wrap-up as one more turn; no experiment gets a second
- [ ] Send-backs and the wrap-up are user messages in Pi's own session file
- [ ] A turn that ended on a failed model call is treated as a stop: the coder is sent back by the same rule
- [ ] Unit tests cover the rule with a fake clock and fake spend: inside and outside the reserve, open tasks, missing measurement, the cap, the 3-minute floor
- [ ] On `datenorm-smoke --mock`: every `exps/*/session/` file holds eight send-backs, then one wrap-up; `exps/*/train-score.json` and `exps/*/tasks.json` exist
- [ ] `npm run typecheck` and `npm test` pass
