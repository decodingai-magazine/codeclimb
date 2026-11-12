# 10: Pi sessions: mock models and sandbox tools

**What to build:** The build can open an isolated Pi session whose `read`, `write`, `edit` and `bash` tools act inside a sandbox, prompt it, and observe every assistant message with its cost and tokens. With the scripted `mock` provider, a coder session changes the sandbox's `/repo` and writes its three `/tmp` files; reviewer and lessons sessions answer with their scripted JSON.

**Spec sections:**
- "Coder": the bullets on isolation, sandbox tools and session storage
- "Coder" > "Pi facts found while building": the whole table
- "CLI" > "Mock mode": the bullets on models and the response queue, and the role table
- "What you get, what you build": the Pi rows of the dependency table (already installed by ticket 01)
- "Every number in one place": coder rows "default bash timeout" and "Pi retries; compaction"

**Not yet:** provider models, credentials and web research (ticket 31); the coder's prompt and stop rules (tickets 11, 12); `--mock-offline` and `mock_credit` (tickets 26, 28); program calls (ticket 21).

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] A session loads no AGENTS file, skill, prompt template, extension or theme from the host, uses an empty agent directory and in-memory settings (compaction on, 4 retries), and works in `/repo`
- [ ] Exactly `read`, `write`, `edit` and `bash` are active, built from Pi's own tool definitions with operations routed to the sandbox interface; `grep`, `find` and `ls` are off
- [ ] The bash operation passes a timeout and the abort signal, streams output, reports an abort or a timeout the way Pi expects, defaults to 10 minutes, and never forwards the host environment; only variables the caller passes reach the shell
- [ ] The access check runs one `test` per flag
- [ ] A coder session is file-backed under a given session directory and can be reopened from its session file; reviewer and lessons sessions are in memory, with no tools and their own system prompt
- [ ] The `mock` provider is registered once on the process's Pi model runtime with the models `coder`, `reviewer` and `lessons`; its queue never runs empty under concurrent sessions; mock calls cost 0
- [ ] A mock coder prompt on a Docker sandbox: `MOCK.md` gains a line, `/tmp/tasks.json`, `/tmp/notes.md` and `/tmp/train-score.json` exist with the scripted content, the closing text is the scripted `APPROACH` line, and the session directory holds a session file
- [ ] A second prompt in the same session is answered the same way and appends a second line to `MOCK.md`
- [ ] The mock reviewer and lessons replies are the scripted JSON objects
- [ ] The session exposes each assistant message end (stop reason, error text, cost, tokens) and each tool event to its caller
- [ ] Tests cover the above against Docker; `npm run typecheck` and `npm test` pass
