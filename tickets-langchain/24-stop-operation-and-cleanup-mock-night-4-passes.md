# 24: Stop operation and cleanup; mock night 4 passes

**What to build:** `npm run run-night -- stop --night <id>` hard-stops a running night: `stop.json` is written at once, the night's server runs are cancelled, its running steps are aborted, its sandboxes are swept. Every other hard stop (a night that fails out of retries, a cancel from outside CodeClimb) goes through the same path. A stopped night always ends with a `stop.json` and no container.

**Spec sections:**
- "Durable runtime on LangGraph" > "Cleanup": all of it
- "Interfaces" > "Control operations": the `stop` row
- "Durable runtime on LangGraph": the `stop` row of the Graphs table; requirements rows "Cancel a night", "Stop running work", "Failure = stop"; the stop thread
- "Experiment lifecycle" > "Stops": hard stops; "Round loop": the `stop.json` read in step 1
- "Sandboxes": the refusal to create a sandbox for a night that has a `stop.json`
- "Coder" > "End of an experiment": the `cancelled` stop; "Crash and resume": what fires the live registry
- "CLI": `run-night stop`
- "Platform facts": the cancel facts (cancel without `wait`; the run reads interrupted while its step may still run)
- "Goal and done signal": night 4

**Not yet:** starting the lessons operation from the stop cleanup (ticket 33); timers and their guards (ticket 42); the watchdog (ticket 38). This ticket replaces ticket 15's interim catch with the stop operation.

**Blocked by:** 15

**Status:** ready-for-agent

- [ ] The stop operation writes `stop.json` first (`at`, `reason`), only when the night has no `done.json`, and the first stop wins; then it creates a server run of `stop` on the night's stop thread (created if missing, `enqueue`)
- [ ] The `stop` graph, step by step: cancel the night's pending and running server runs with action `interrupt` and without waiting; abort the night's live registry entries; sweep sandboxes by the prefix `cc-<night>`; write `stop.json` if still missing
- [ ] The stop cleanup finds the night's folder by scanning, since its input holds only the night id
- [ ] The night's catch: rethrows a graph interrupt untouched; on an abort with no `stop.json` writes reason `cancelled`, starts the stop operation, rethrows; on any other error writes reason `failed`, starts the stop operation, rethrows; there is no cleanup in a `finally`
- [ ] A night that fails before `night.json` exists still gets `nights/<id>/stop.json` with reason `failed`
- [ ] The round-start stop check ends the server run quietly when `stop.json` exists
- [ ] The sandbox backend refuses to create a sandbox for a night that has a `stop.json` (unit test)
- [ ] A coder aborted by the stop ends as `cancelled`: its sandbox is destroyed and Pi makes no further model call
- [ ] Night 4: `datenorm-smoke --mock --no-wait`, then `run-night stop --night <id>` while round 1 runs; following the night prints `stopped`; `stop.json` has `reason: manual`; there is no `done.json` and no `test` row; no `cc-<id>` container is left
- [ ] `npm run typecheck` and `npm test` pass
