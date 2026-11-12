# 23: Crash and resume: a retried coder or evaluator step picks up its work

**What to build:** When a coder step is retried, it finds its state file and looks for its sandbox by name: alive with a session file, it reopens the session with a short restart prompt; dead, it restarts once from the parent commit; lost twice, the experiment fails. A retried evaluation reuses its sandbox after the reset. The coder step learns its attempt number from the runtime.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Crash and resume", "End of an experiment", "Evaluator", "Durable runtime on Inngest", "Platform facts found while building"

**Blocked by:** 12 (Hard stop and cleanup: every dead night ends in stop.json); 15 (Send-backs, reserve and wrap-up); 21 (Done signal: both mock nights pass the end-to-end checks)

**Status:** ready-for-agent

- [ ] The resume decision (reopen, fresh restart, fail with `sandbox lost twice`) is a function of the state file, the sandbox lookup and the restart count, unit-tested
- [ ] Reopen: the same session file, a short prompt saying the harness restarted and to continue; spend, tokens and `code-state.json` carry on
- [ ] Fresh restart: a new sandbox from the parent commit, the clock and the session start again, spend, tokens and the restart count carry over, `freshRestarts` and `infra_errors` count it
- [ ] The restart prompt contains neither `You stopped with` nor `change no more code` (covered by the all-prompts test)
- [ ] A retried evaluation step finds its sandbox by name, resets it and runs again; the result is the same as a first run
- [ ] End-to-end, mock, dev server: killing the worker as soon as `exps/<exp>/code-state.json` appears and starting it again lets the night finish with `done` (the step resumes after its lease expires, about 2 minutes); the experiment's row exists once and `code-state.json` shows the resume or restart
- [ ] Docker test: destroying the coder's container between two attempts of the step leads to one fresh restart; destroying it again fails the experiment, and the round records `error` with reason `the experiment failed`
- [ ] Both mock nights of ticket 21 still pass every check of "Goal and done signal"
