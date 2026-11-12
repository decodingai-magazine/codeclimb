# 25: Crash resume; mock night 5 passes

**What to build:** Killing the server container mid-night loses nothing that was stored. After `npm run server` the server picks the killed run up by itself, the night replays its stored steps without running them, and only the step that was running reruns. A rerun code step reads its state file: it reopens the coder's session on a sandbox that is still alive, or restarts once on a fresh one.

**Spec sections:**
- "Coder" > "Crash and resume": the first bullet
- "Coder" > "End of an experiment": `code-state.json` (`freshRestarts`, `infraErrors`) and `code-result.json`
- "Durable runtime on LangGraph": requirements rows "The loop survives a crash" and "Crash resume"; "Rules the loop depends on" (replay takes the same path, idempotent writes)
- "Platform facts": the facts on `durability`, on the runs sweeper and on the mid-round kill
- "Evaluator": a retried step reuses its sandbox after the reset
- "Known gaps": the bullets on the sweeper's wait, on a step rerunning from its start, and on lost in-process memory
- "Goal and done signal": night 5

**Not yet:** the watchdog (ticket 38): night 5 needs none. The resume after a pause for credits (ticket 28).

**Blocked by:** 20

**Status:** ready-for-agent

- [ ] "Rerun" is decided by the state file on disk, never by the step's attempt number
- [ ] Sandbox alive with a session file: the session is reopened with a short prompt saying the harness restarted and to continue; the prompt contains neither "You stopped with" nor "change no more code"
- [ ] Sandbox dead: one fresh restart from the parent commit, counted in `infra_errors`; the clock and the session start again; spend, tokens and the restart count carry over
- [ ] Lost twice: the experiment fails with `sandbox lost twice`
- [ ] Every file write a replayed or rerun step makes is idempotent: rows by `eval_id`, other files rewritten whole
- [ ] Unit tests cover the three rerun cases with a faked sandbox backend
- [ ] Night 5, as the done signal words it: `datenorm-smoke --mock --no-wait`; once `exps/<id>-r2-e0/` exists, record round 1's `code-state.json` (sha256 and mtime), follow `docker events`, `docker kill` the server container, then `npm run server`. With no manual resume the night finishes: `done.json` exists, every `eval_id` is in `results.jsonl` once, round 1's `code-state.json` is unchanged, and no `cc-<id>-r1-` sandbox is created after the kill. If the night finished before the kill, run it again
- [ ] `npm run typecheck` and `npm test` pass
