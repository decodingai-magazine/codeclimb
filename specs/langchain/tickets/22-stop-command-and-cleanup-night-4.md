# 22: Stop command and cleanup: night 4 passes

**What to build:** `npm run run-night -- stop --night <id>` stops a night hard, mid-round: it cancels the night and its running work, removes its sandboxes and leaves a `stop.json` with `reason: manual`, within 30 s. A stopped night creates no new sandbox. A failed night and a cancel from outside end the same way, with their own reasons. Night 4 passes.

**Spec sections:**
- "Goal and done signal": night 4
- "Features": **Stops** (hard stops); **Sandboxes** ("A stopped night creates no new sandbox")
- "Interfaces the build must honour" > "CLI": the `stop` row; "`stop` prints `stopped` and exits 0 once `stop.json` exists; `done` for a night that finished first"
- "Interfaces the build must honour" > "Stops": the `stop.json` bullets
- "Runtime and tools": "a stop reaches work that is already running"
- "Numbers": hard stop within 30 s; the stop returns within 120 s; a follower prints `stopped` within 60 s of the stop; round 1 reached within 120 s

**Not yet:** the hard deadline and the variation backstop (ticket 23); the stop of a paused night (ticket 26); the API's stop (ticket 34).

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `run-night stop --night <id>` prints `stopped` and exits 0 once `stop.json` exists, within 120 s; for a night that finished first it prints `done`; for an unknown night id it exits 2
- [ ] A stop cancels the night and its running coder session, evaluation or host command; it removes every `cc-<id>` sandbox, running or stopped; `stop.json` holds `at` and `reason: manual`; no `done.json` and no `test` row follow
- [ ] A step that runs after the stop creates no sandbox for that night
- [ ] The first stop wins: a second stop changes nothing; no `stop.json` is written once `done.json` exists
- [ ] A night that fails, and a cancel of the night from outside the CLI, leave `stop.json` with `reason` `failed` and `cancelled` respectively, and no sandbox; this replaces ticket 12's interim path
- [ ] A stop of a night still in init leaves `stop.json` and no sandbox
- [ ] Night 4: `datenorm-smoke --mock --no-wait`, then `run-night stop` once `exps/<id>-r1-e0/` exists (reached within 120 s of the start): within 30 s of the stop, `stop.json` has `reason: manual`, there is no `done.json`, no `test` row and no `cc-<id>` container; a `run-night` following the night prints `stopped` within 60 s
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
