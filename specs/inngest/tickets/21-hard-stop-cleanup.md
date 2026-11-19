# 21: Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes

**What to build:** A stop request, a cancel of the night's run from outside (through the runtime's own API or dashboard), a night that fails for good, the night's backstop and a passed `hard_deadline` all end the same way: live agent sessions are aborted, the night's sandboxes are destroyed, `stop.json` is written, and a following `run-night` prints `stopped`. No test score. Mock night 4, the hard stop mid-round, passes.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Hard stop and cleanup; End of an experiment), "CLI", "Night config", "Files a night writes", "Environment", "Runtime and tools", "Numbers", "Goal and done signal"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `run-night stop --night ID` stops the night hard with reason `manual`, prints `stopped` once `stop.json` exists, or `done` when the night finished first, and returns within 120 s
- [ ] A stop reaches the night and everything it started: the running coder ends as `cancelled` and commits nothing, live sessions are aborted, the night's sandboxes are destroyed, and `stop.json` holds `at` and `reason`; there is no `done.json` and no `test` row
- [ ] A cancel of the night's run from outside the CLI, through the runtime's own API or dashboard, ends the night the same way with reason `cancelled`; a night that fails for good ends it with reason `failed`, however early it failed
- [ ] The night's backstop (4 days; `CODECLIMB_BACKSTOP_S` seconds when set, read by the worker from `.env` or its shell when it starts) ends a night still running the same way, with reason `cancelled` or `failed` (end to end on a mock night with a short value)
- [ ] When `hard_deadline` passes the night stops hard even mid-step: the running experiment or evaluation is aborted, the night's sandboxes are removed and `stop.json` has `reason` `hard_deadline`; no test score (end to end on a mock night with a test-only config copy whose `hard_deadline` passes during round 1)
- [ ] The first stop wins: a later stop never rewrites `stop.json`; `stop.json` is never beside a `done.json`
- [ ] A following `run-night` prints `stopped` as the first word of a line of its own and exits 0 within 60 s of the stop
- [ ] Night 4, with the dev server and the worker up: `datenorm-smoke --mock` left following in its terminal; once `exps/<id>-r1-e0/` exists, `npm run run-night -- stop --night <id>` from a second terminal prints `stopped` and exits 0. Within 30 s: `stop.json` has `reason: manual`, there is no `done.json` and no `test` row, no `cc-<id>` container is left, running or stopped. The first `run-night` prints `stopped` too
- [ ] Nights 1 to 3 still pass the check of ticket 20
