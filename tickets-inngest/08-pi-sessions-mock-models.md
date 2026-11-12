# 08: Pi sessions with sandbox tools, mock models, the model check and credit detection

**What to build:** The worker can open an isolated Pi session whose `read`, `write`, `edit` and `bash` act inside a sandbox, on a real `<provider>/<id>` model or on the scripted mock models. A mock coder session, driven once, changes files in the sandbox exactly as "Mock mode" scripts it. The model check and the credit-error test that later tickets call are built and tested here, since both sit on Pi's model runtime.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Coder", "Pi facts found while building", "Mock mode", "Night config", "Pause for credits"

**Blocked by:** 03 (Night config: parse, defaults, validation, night ids, results paths); 07 (Sandbox interface and the Docker backend)

**Status:** ready-for-agent

- [ ] Any Pi provider works as `<provider>/<id>`; credentials come from env keys or from Pi's `auth.json` (`~/.pi/agent/auth.json`, or the file `CODECLIMB_PI_AUTH_PATH` names) (unit test of the path choice)
- [ ] Session isolation as in "Coder": empty agent directory, a resource loader returning nothing from the host, in-memory settings with compaction on and 4 retries, working directory `/repo`; exactly the four sandbox tools active, `grep`, `find`, `ls` off
- [ ] Tool operations route to the sandbox interface, with the bash semantics and the access check of "Pi facts found while building"; a bash command without its own timeout gets 10 minutes; the session's environment is not exposed to the shell
- [ ] File-backed sessions (create and reopen) and in-memory sessions with no tools both exist; cost and tokens are read from each assistant message end
- [ ] Mock models: the faux provider is registered once on the worker's model runtime as provider `mock` with models `coder`, `reviewer`, `lessons`, costing 0; its queue holds a response factory that re-queues itself with a head start for concurrent sessions, picking the reply by model id as the table in "Mock mode" states
- [ ] Docker test: one prompt to a mock coder session on a `codeclimb-python` sandbox leaves `MOCK.md` with a new line in `/repo` and writes `/tmp/tasks.json`, `/tmp/notes.md` and `/tmp/train-score.json` in the scripted shapes; the closing text is `APPROACH: mock change, no real work`; two concurrent mock sessions both complete
- [ ] Unit tests: mock reviewer and lessons replies parse to the scripted JSON
- [ ] Model check, as "Night config" states it (Pi runtime, credentials, the account's model list, `openrouter/` entries of `allowed_models` through the per-model endpoints API with a 30 s timeout, priced embedding models left out), unit-tested against fakes; skipped in mock mode
- [ ] Credit detection: the message pattern of "Pause for credits" matches every listed phrase and not a 429 rate limit; it is applied to every assistant message end with stop reason `error` and to a thrown error (unit tests)
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes
