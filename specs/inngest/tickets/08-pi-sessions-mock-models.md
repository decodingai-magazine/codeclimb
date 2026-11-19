# 08: Pi sessions with sandbox tools, and the mock models

**What to build:** A Pi coding-agent session runs in the worker with exactly four tools that act inside a sandbox, takes nothing from the host, and is persisted to a file it can be reopened from. Tool-less sessions exist for the reviewer and the lessons model. Scripted mock models answer all three as "Mock mode" states, at no cost and with no provider call.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Coder; Mock mode), "Mock mode", "Runtime and tools", "Environment"

**Blocked by:** 03 (Night config, night ids and the runs folder); 07 (Sandbox interface and the Docker backend)

**Status:** ready-for-agent

- [ ] A model is `<provider>/<id>` of any Pi provider; credentials come from the provider keys of "Environment" or from Pi's `auth.json`, and `CODECLIMB_PI_AUTH_PATH` names another `auth.json` (unit tests against fakes)
- [ ] A coder session has exactly the tools `read`, `write`, `edit` and `bash`, each acting inside its sandbox; no agent file, skill, setting or environment variable of the host reaches the session (test)
- [ ] A coder session is persisted to a file and reopened from it with its history (test)
- [ ] Reviewer and lessons sessions have no tools
- [ ] The spend and tokens of a session can be read as it runs
- [ ] Mock coder, as "Mock mode" states: on each prompt one `bash` call that appends a line to `MOCK.md` and writes `/tmp/tasks.json` (one task, status `done`), `/tmp/notes.md` (`mock note`) and `/tmp/train-score.json`; after the tool result the closing text `APPROACH: mock change, no real work`; send-backs and resumes answered the same way (Docker test on a `codeclimb-python` sandbox)
- [ ] Mock reviewer answers JSON with `feedback` `mock feedback`, `hypothesis` `mock hypothesis` and `verdict` `mock verdict`; mock lessons model answers JSON with an empty `ops` list (unit tests)
- [ ] Mock sessions cost 0 and call no provider
