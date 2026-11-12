# 14: Threads and the start operation

**What to build:** The control-operations module, with its first operation. Starting a night id creates the night's thread and a server run of `night` on it; starting the same night id again starts nothing and tells the caller the night is already running. The module also knows every thread id of a night and finds a night's newest thread.

**Spec sections:**
- "Interfaces" > "Control operations": the intro and the `start` row
- "Durable runtime on LangGraph": the "Threads" table and its bullets; the requirements table rows "One night id, one night" and "The loop survives a crash" (`durability: "sync"` on every server run)
- "CLI": the two bullets on a night id that was used before and on a night id that already has a thread

**Not yet:** the stop, resume, lessons and timer operations (tickets 26, 29, 34); the `night` graph is still ticket 01's placeholder.

**Blocked by:** 02 (Scenario and night config loading)

**Status:** ready-for-agent

- [ ] Thread ids are UUIDs: v5 of `night/<night_id>`, `stop/<night_id>`, `timer/<night_id>` and `lessons/<scenario>` under one namespace constant
- [ ] Start creates the night thread with `ifExists: "raise"` and the metadata `kind: night`, `night_id`, `run: 0`, then a server run of `night` with `multitaskStrategy: "reject"` and `durability: "sync"`
- [ ] The start input carries `night_id`, `config`, `mock` and the optional fields the spec lists
- [ ] A 409 on thread creation is reported as "already running", not as an error
- [ ] The newest night thread is found by a metadata search (`kind: night`, `night_id`), newest first
- [ ] A night id whose folder exists under the results directory but which has no thread is refused
- [ ] The server URL comes from `CODECLIMB_SERVER_URL`
- [ ] Unit tests with a faked client cover the above; an integration check on a running server starts the placeholder graph once for two starts of one id; `npm run typecheck` and `npm test` pass
