# 24: Pause for credits and resume

**What to build:** A credit error from the coder, the reviewer or a program call is reported as a credit stop. The child returns it, the parent writes `pause.json` and waits for the resume event with no sandbox running. On resume only what stopped runs again: the coder from its paused commit in the same session, the evaluation from scratch, the review again. Paused time counts against nothing.

**Spec sections** (`specs/inngest/spec.md`): "Pause for credits", "Crash and resume", "CLI", "Events", "Ids", "Files a night writes", "Durable runtime on Inngest", "Deployment and environment", "Known gaps"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check); 22 (Crash and resume: a retried coder or evaluator step picks up its work; mock night 5 passes)

**Status:** ready-for-agent

- [ ] A credit stop (`who`, `model`, `message`) from a coder commits the partial work and returns; from an evaluation it ends the stage with no score; from a review it just stops. Only the parent waits, on the resume event with a 3-day timeout, after which the night fails and stops
- [ ] `pause.json` (`at`, `round`, `stops[]` with `where`) exists while paused; `pauses.jsonl` logs each pause with `resumed_at`; the follower prints where the night paused and how to resume; stop works while paused
- [ ] `run-night resume --night ID` sends `codeclimb/night.resume`
- [ ] Ending a pause logs it, deletes `pause.json`, and adds the paused time to `deadlineMs` in `night.json` and to the loop's deadline; running this step twice gives the same result (the spec asks for this although the reference throws) (unit test)
- [ ] Rerun work gets a child-run identity ending `-resume<n>`; the experiment keeps its id and sandbox name; a rerun evaluation keeps its `eval_id` on the sandbox `cc-<night>-r<N>-eval-resume<n>` and does not replay its paused attempt's calls
- [ ] The resumed coder's sandbox is created from a git bundle holding the paused commit and the round's parent, so the final commit squashes onto the parent; it gets the restart prompt, fresh send-back count and wrap-up flag, and its clock set to now minus the coding time so far on the first attempt of the resumed step only
- [ ] All four evaluation kinds pause the same way: dev, noise, rescore (wired when ticket 31 lands) and test
- [ ] End-to-end, mock, dev server, with a test-only fault switch documented in the test (not a config field; mock program calls never go upstream, so the credit stop is injected once, at the proxy or in a mock model reply): the night pauses; `pause.json` appears and no sandbox runs; `run-night resume` ends the pause; the night finishes with `done`, `pauses.jsonl` has `resumed_at`, and `deadlineMs` moved forward
- [ ] The pause timeout's test hook: the worker reads `CODECLIMB_PAUSE_TIMEOUT_S` when it starts, a positive integer of seconds in place of the 3 days; unset or empty means 3 days (unit test on the reader). End-to-end on the dev server, mock, with the worker started with a value of a few seconds and the same fault switch: a paused night that nobody resumes ends with `stop.json`, no `done.json` and no `cc-<id>` container, and its `run-night` prints `stopped`; a second such night, resumed before the timeout, finishes with `done`. The worker is started again without the variable afterwards
- [ ] Kept as the reference has it, do not fix: a stop or a pause timeout leaves `pause.json` behind
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
