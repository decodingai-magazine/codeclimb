# 35: Watchdog

**What to build:** Crash recovery past the server's own. The watchdog runs in the worker API's process and finds nights the Agent Server left behind: a night with neither `done.json` nor `stop.json` that the server no longer runs. It resumes such a night a limited number of times, then stops it.

**Spec sections:**
- "Features": **Crash recovery** (the watchdog)
- "Architecture": the worker API + watchdog row

**Not yet:** nothing.

**Blocked by:** 24 (Crash resume: night 5 passes); 34 (Worker API)

**Status:** ready-for-agent

- [ ] With the API running, the watchdog checks the nights on disk at an interval of the build's choosing
- [ ] A night with no `done.json` and no `stop.json` that the Agent Server is not running, and that is not paused, is resumed from its last saved step
- [ ] A night resumed by the watchdog that is left behind again is resumed again, up to the build's limit; past it, the night is stopped: `stop.json` with `reason` `failed`, and no sandbox left
- [ ] A finished, stopped, paused or running night is never touched
- [ ] Tests with a faked Agent Server client and night files cover each case and the limit
- [ ] `npm run typecheck` and `npm test` pass
