# 25: Lost connection mid-turn: night 6 passes

**What to build:** `--mock-offline N` makes the coder's model calls 2 to N+1 of the night's first experiment fail, each as an assistant message with stop reason `error` and the text `fetch failed`. The coder's session carries on once model calls succeed again: a failed call is not an infrastructure error, and a turn it ended is a stop like any other. Night 6 passes.

**Spec sections:**
- "Goal and done signal": night 6
- "Interfaces the build must honour" > "Mock mode": `--mock-offline N`
- "Features": **Coder** ("a failed model call is not" an infrastructure error; "the session carries on once calls succeed again")
- "Interfaces the build must honour" > "CLI": `--mock-offline N`

**Not yet:** nothing.

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] With `--mock-offline N`, the coder's model calls 2 to N+1 of the night's first experiment fail as assistant messages with stop reason `error` and the text `fetch failed`; no other call fails
- [ ] The experiment does not end on those failures; the session carries on and later calls succeed
- [ ] Night 6, `datenorm-smoke --mock --mock-offline 6`: C1 to C14 hold, and `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
