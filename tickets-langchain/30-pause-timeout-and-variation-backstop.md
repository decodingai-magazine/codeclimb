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
- "Deployment and environment": the timer test hooks (the Environment bullet, the variable table row, the pass-through in the compose override)

**Not yet:** nothing is deferred.

**Blocked by:** 29 (Pause for credits and resume)

**Status:** ready-for-agent

- [ ] The timer operation creates a server run of `stop` on the night's timer thread (UUID v5 of `timer/<night_id>`, created if missing, `enqueue`) with `afterSeconds`, `durability: "sync"`, `reason: failed` and a guard
- [ ] The night creates one timer at each pause, due in 3 days, guarded by the pause number, and one at the start of each variation, due in 4 days, guarded by the variation number; both are created inside steps
- [ ] When a timer fires, the stop graph checks the guard first: it does nothing if that pause has ended, or if that variation has ended or is no longer the newest
- [ ] When the guard passes, the stop graph writes `stop.json` with reason `failed` and runs the cleanup of ticket 26
- [ ] A finished night's pending timers do nothing when they fire
- [ ] Unit tests with a faked client and night folders cover each guard outcome for both timers
- [ ] The test hooks: the step that creates a timer reads `CODECLIMB_PAUSE_TIMEOUT_S` or `CODECLIMB_BACKSTOP_S`, a positive integer of seconds in place of the 3 days or the 4 days; unset or empty means the default (unit test on the reader)
- [ ] On a running server with neither variable set, on a mock night paused by `mock_credit`: the timer thread holds the night's two pending delayed runs, one due in 3 days with the pause number and one due in 4 days with the variation number
- [ ] On a server started with `CODECLIMB_PAUSE_TIMEOUT_S` set to a few seconds, on a mock night paused by `mock_credit` that nobody resumes: the night ends with `stop.json` (`failed`), no `done.json` and no `cc-<id>` container, and its `run-night` prints `stopped`. A second such night, resumed before the timer fires, finishes with `done.json` and is not stopped when the timer fires
- [ ] On a server started with `CODECLIMB_BACKSTOP_S` set shorter than a mock round: a mock night still running then ends with `stop.json` (`failed`), no `done.json` and no `cc-<id>` container. `npm run server` is run again without the variables afterwards
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
