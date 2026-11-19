# 24: Pause for credits and resume

**What to build:** A credit or quota error, from a program call or an agent turn, pauses the night instead of being scored as a bad program: nothing runs, no sandbox exists, and paused time counts against no deadline. `run-night resume` ends the pause and only what stopped runs again. A pause nobody ends times out and stops the night. The `CODECLIMB_MOCK_CREDIT` hook exercises all of it on mock nights.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Pause for credits; End of an experiment; Evaluator), "CLI", "Files a night writes", "Mock mode", "Environment", "Runtime and tools", "Numbers"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes); 22 (Crash recovery: the night carries on after a worker kill; mock night 5 passes)

**Status:** ready-for-agent

- [ ] A credit or quota error is told apart from other failures, in a program call's proxy answer and in an agent turn (unit tests)
- [ ] From a coder turn it stops the coder as `credits` with its partial work committed; from a program call it ends the evaluation unscored; from the reviewer it ends the review. In each case the night pauses: `pause.json` exists, no sandbox of the night exists, nothing runs
- [ ] `pauses.jsonl` records every pause; `pause.json` is deleted when the pause ends
- [ ] `run-night resume --night ID` ends the pause; only the work that stopped runs again; the paused time counts against no deadline
- [ ] A pause nobody ends times out after 3 days, or `CODECLIMB_PAUSE_TIMEOUT_S` seconds when set, and stops the night with `stop.json` reason `failed` (end to end on a mock night with a short value: no `done.json`, no `cc-<id>` container)
- [ ] A stop request ends a paused night as any hard stop does
- [ ] `CODECLIMB_MOCK_CREDIT=<who>:<n>` on a mock night makes call number `n` of the night's calls by `who` (`coder`, `reviewer` or `program`) fail once with a credit error; it has no CLI flag. The worker reads it and `CODECLIMB_PAUSE_TIMEOUT_S` when it starts, from `.env` or its own shell (unit test)
- [ ] End to end on mock nights, once for each `who`: the night pauses; `run-night resume` ends the pause; the night finishes with `done`, every `eval_id` once, and `pauses.jsonl` records the pause
- [ ] Nights 1 to 3 still pass the check of ticket 20
