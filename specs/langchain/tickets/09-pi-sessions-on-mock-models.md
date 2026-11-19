# 09: Pi sessions on mock models

**What to build:** Pi runs inside the Agent Server's process, never in a sandbox. A session is isolated from the host's own Pi and agent setup, saves Pi's session file, and acts in a sandbox through its only four tools, `read`, `write`, `edit` and `bash`. A session with no tools serves the reviewer and the lessons distillation. On a mock night, Pi's scripted provider answers as the mock mode table says, and no provider credential is needed.

**Spec sections:**
- "Features": **Coder** ("Pi runs in the Agent Server, never in a sandbox"; isolation; the four tools)
- "Interfaces the build must honour" > "Mock mode": the scripted answers of the coder, the reviewer and lessons; "no provider credential is needed"
- "Runtime and tools": the Pi bullet
- "Interfaces the build must honour" > "Files a night writes": `session/*.jsonl` is Pi's session file

**Not yet:** real provider models and credentials, web research (ticket 41); `--mock-offline` (ticket 25); credit errors (ticket 26).

**Blocked by:** 08 (Sandboxes on Docker)

**Status:** ready-for-agent

- [ ] A session loads nothing from the host's Pi or agent setup (no extensions, skills, prompts, context files or settings of the operator's); a test with a planted host setup shows none of it in the session
- [ ] A coder session's tools are exactly `read`, `write`, `edit` and `bash`, and each acts on the sandbox's files and shell, not the host's (Docker test)
- [ ] A session with no tools can be run for one JSON reply
- [ ] Mock coder (`mock/coder`): after a tool result it answers `APPROACH: mock change, no real work`; otherwise one `bash` call that appends a timestamped line to `MOCK.md` and writes `/tmp/tasks.json` (one task, status `done`), `/tmp/notes.md` (`mock note`) and `/tmp/train-score.json` (`before`, `after`, `command`); every prompt is answered this way
- [ ] Mock reviewer answers `{"feedback": "mock feedback", "hypothesis": "mock hypothesis", "verdict": "mock verdict"}`; mock lessons answers JSON with an empty `ops` list
- [ ] A mock session runs with no provider key in the environment and no Pi `auth.json`
- [ ] The session file is Pi's own, saved to a directory the caller names; the user and assistant messages and their stop reasons are in it
- [ ] `npm run typecheck` and `npm test` pass
