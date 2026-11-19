# 23: Hard deadline, variation backstop and step backstops

**What to build:** No work runs for ever. Each step has a backstop timeout longer than its own time limit, so a hung coder, evaluation or host command becomes that step's failure. A night whose `hard_deadline` passes stops hard even mid-step. A variation that outlives its backstop (4 days) stops hard too. Both are hard stops: the running work is aborted, the sandboxes removed, a `stop.json` written, and test is not scored.

**Spec sections:**
- "Interfaces the build must honour" > "Night config": `hard_deadline`
- "Features": **Stops** ("the variation backstop")
- "Runtime and tools": "no step runs for ever: each has a backstop timeout longer than its own time limit"
- "Interfaces the build must honour" > "Environment": `CODECLIMB_BACKSTOP_S`
- "Numbers": variation backstop

**Not yet:** the pause timeout (ticket 26).

**Blocked by:** 22 (Stop command and cleanup: night 4 passes)

**Status:** ready-for-agent

- [ ] Every step that runs a coder, an evaluation or a host command has a backstop longer than its own limit (`experiment_min`, `eval_min` per stage run); a fired backstop makes it a failure of its experiment or evaluation, not the end of the night (test with a hanging fake step)
- [ ] When `hard_deadline` passes, the night stops within 30 s, also in the middle of an experiment or an evaluation: the running work is aborted, the night's sandboxes are removed, `stop.json` has `reason: hard_deadline`, and there is no `done.json` and no `test` row
- [ ] A night with no `hard_deadline` never stops on it
- [ ] A variation still running after 4 days stops hard with a `stop.json` whose `reason` is `failed` or `cancelled` (the build's choice); `CODECLIMB_BACKSTOP_S`, set in `.env`, reaches the Agent Server once `npm run server` runs again, and shortens it
- [ ] On mock models: a `datenorm-smoke` copy with `hard_deadline: 30s` (outside `configs/`) leaves `stop.json` with `hard_deadline` within about 30 s of the start and no `cc-<id>` container; a `datenorm-smoke` night with `CODECLIMB_BACKSTOP_S` set to a few seconds leaves that `stop.json` and no `cc-<id>` container
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
