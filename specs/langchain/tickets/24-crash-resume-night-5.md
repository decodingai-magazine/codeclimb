# 24: Crash resume: night 5 passes

**What to build:** After the Agent Server container is killed and `npm run server` runs again, a night carries on by itself, with no watchdog, no manual resume and no other command. Only the step that was running reruns; a rerun never redoes finished work or writes a row twice. A coder whose step reruns carries on its Pi session (session resume). Night 5 passes.

**Spec sections:**
- "Goal and done signal": night 5
- "Features": **Crash recovery** (the server's part)
- "Architecture": the terms (crash resume, session resume)
- "Features": **Sandboxes** ("Names are deterministic, so a rerun step finds its sandbox")
- "Runtime and tools": "a night survives a kill of the server and carries on without a human"
- "Numbers": crash resume within 480 s; round 2 reached within 120 s; `npm run server` after a kill within 600 s

**Not yet:** the watchdog (ticket 35).

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] After a kill of the server container (Postgres and Redis keep running) and `npm run server`, a running night carries on from its last saved step without any other command
- [ ] Only the step running at the kill reruns; no finished step's work is redone: no coder sandbox of an earlier round is created, no `code-state.json` of a finished coder is touched, no row is written twice
- [ ] A rerun step finds its sandbox by name, or creates it fresh when the kill left none; a rerun coder carries on its Pi session from its saved session file
- [ ] Night 5: `datenorm-smoke --mock --no-wait`; once `exps/<id>-r2-e0/` exists (reached within 120 s of the start), record the sha256 and mtime of round 1's `code-state.json`, `docker kill` the `langgraph-api` container, run `npm run server` again and nothing else. The night finishes within 480 s of the restart: `done.json` exists; every `eval_id` is in `results.jsonl` once; round 1's `code-state.json` is unchanged; `docker events` shows no `cc-<id>-r1-` sandbox created after the kill
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
