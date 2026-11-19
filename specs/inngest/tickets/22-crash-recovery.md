# 22: Crash recovery: the night carries on after a worker kill; mock night 5 passes

**What to build:** The worker can die at any moment. When it is back the night carries on by itself: finished rounds, experiments and evaluations are not run again and no row is written twice. A coder that was running finds its sandbox by name and reopens its session; if the sandbox is gone it restarts once from the parent commit. Mock night 5, the killed and restarted worker, passes.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Crash recovery; Coder; Sandboxes), "Goal and done signal", "Runtime and tools", "Ids and names", "Numbers"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] The resume choice of a coder (reopen its session in the sandbox found by name, restart once from the parent commit, or fail the experiment after a second loss) is a function of what is on disk and what the sandbox lookup finds (unit tests)
- [ ] A reopened coder continues its persisted session in its sandbox; its spend, tokens and `code-state.json` carry on
- [ ] A coder whose sandbox is gone restarts once, in a new sandbox from the parent commit; a second loss fails the experiment and the round records `error` (Docker test that removes the coder's container between attempts)
- [ ] An interrupted evaluation runs again and gives the result a first run gives
- [ ] Finished rounds, experiments and evaluations are not run again, and no `eval_id` is written twice
- [ ] Night 5, with the dev server and the worker up: `datenorm-smoke --mock --no-wait`; once `exps/<id>-r2-e0/` exists, kill the worker process with its children, leaving the dev server running, then start `npm run worker` again and nothing else. The night finishes by itself within 480 s of the restarted worker answering: `done.json` exists, every `eval_id` is in `results.jsonl` once, round 1's `code-state.json` is unchanged (sha256 and mtime), and no `cc-<id>-r1-` sandbox is created after the kill (checked with `docker events`). If the night finishes before `exps/<id>-r2-e0/` appears, it is run again under a new id
- [ ] Nights 1 to 3 still pass the check of ticket 20
