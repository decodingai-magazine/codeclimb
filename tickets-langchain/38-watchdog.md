# 38: Watchdog

**What to build:** While `npm run api` runs, a watchdog recovers nights a crash left behind that the Agent Server cannot recover itself. Every 60 s it looks at every night that has neither `done.json` nor `stop.json` and reads the night's newest thread. It resumes an errored thread, at most twice, then stops the night; it stops a night whose thread is lost; it leaves every other night alone.

**Spec sections:**
- "Durable runtime on LangGraph": the "Watchdog" paragraph and its bullets; requirements row "Crash resume"
- "Platform facts": the dev-server facts on a run with no input on an errored thread and on server-run attempts
- "Interfaces" > "Worker API": the watchdog runs in the API's process; a busy port is a startup error because two APIs would run two watchdogs
- "Known gaps": the watchdog runs only while `api` runs
- "Every number in one place": runtime row "watchdog interval; checks before it acts; resumes per thread"

**Not yet:** nothing is deferred.

**Blocked by:** 25, 37

**Status:** ready-for-agent

- [ ] The watchdog starts with the API and checks every 60 s every night found by files that has neither `done.json` nor `stop.json`
- [ ] A thread whose status is `error` on two checks in a row gets a server run of `night` with no input, `durability: "sync"`; at most 2 such resumes per thread; the third `error` runs the stop operation with reason `failed`
- [ ] No thread found on two checks in a row runs the stop operation with reason `failed`
- [ ] A thread that is busy, interrupted or idle is left alone, so a killed night waiting for the server's runs sweeper is not touched
- [ ] One check alone never acts: a night between its failure and its `stop.json`, or between its start and the server's first write, is left alone
- [ ] Unit tests with a faked client and a faked clock cover each rule and the two-check delay
- [ ] Night 5 of ticket 25 still passes with `npm run api` running during the kill: the watchdog creates no run and writes no `stop.json`
- [ ] `npm run typecheck` and `npm test` pass
