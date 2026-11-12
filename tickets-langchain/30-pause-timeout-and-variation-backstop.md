# 30: Pause timeout and variation backstop

**What to build:** A night cannot wait or run forever. A pause left alone for 3 days stops the night with reason `failed`; so does a variation that is still running after 4 days. Both are timers: delayed server runs of the `stop` graph on the night's timer thread, each carrying a guard, so a timer whose pause or variation has ended does nothing.

**Spec sections:**
- "Interfaces" > "Control operations": the `timer` row
- "Durable runtime on LangGraph": requirements row "Pause timeout, variation backstop"; the timer thread row; the bullet on delayed runs on one thread; requirements row "Long steps" (`BG_JOB_TIMEOUT_SECS` outlives the backstop)
- "Durable runtime on LangGraph" > "Cleanup": a timer has no caller, so the stop graph writes `stop.json` (`failed`) once the timer's guard passes
- "Experiment lifecycle" > "Pause for credits": a pause lasts 3 days; "Stops": the pause timeout and the 4-day backstop among the hard stops
- "Platform facts": the dev-server fact on runs created with `afterSeconds`
- "Known gaps": a pause timeout leaves `pause.json` behind
- "Every number in one place": loop row "pause timeout; variation backstop"

**Not yet:** nothing is deferred.

**Blocked by:** 29 (Pause for credits and resume)

**Status:** ready-for-agent

- [ ] The timer operation creates a server run of `stop` on the night's timer thread (UUID v5 of `timer/<night_id>`, created if missing, `enqueue`) with `afterSeconds`, `reason: failed` and a guard
- [ ] The night creates one timer at each pause, due in 3 days, guarded by the pause number, and one at the start of each variation, due in 4 days, guarded by the variation number; both are created inside steps
- [ ] When a timer fires, the stop graph checks the guard first: it does nothing if that pause has ended, or if that variation has ended or is no longer the newest
- [ ] When the guard passes, the stop graph writes `stop.json` with reason `failed` and runs the cleanup of ticket 26
- [ ] A finished night's pending timers do nothing when they fire
- [ ] Unit tests with a faked client and night folders cover each guard outcome for both timers
- [ ] On a running server, with the delays shortened through a test-only input: a mock night paused by `mock_credit` and left alone ends with `stop.json` (`failed`) and no `cc-<id>` container; the same night resumed before the timer fires finishes with `done.json` and is not stopped when the timer fires later
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
