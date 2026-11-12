# CodeClimb: Development Rules

CodeClimb is an optimization loop: a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. This branch (`langchain`) builds it on LangGraph JS.

## Where things are

- **Build spec**: `docs/codeclimb-spec-langchain.md` is the contract for everything built here. Read the sections a ticket names before writing code; every constant is in its section "Every number in one place". It is a copy of the Obsidian note of the same name: change both together.
- **Tickets**: GitHub Issues, through `gh`. A build ticket names its spec sections, its acceptance criteria and its blockers. Work a ticket only when every blocker is closed.
- **Vocabulary**: `GLOSSARY.md`. Use its words in code, commits and issues: night, variation, round, experiment, evaluation, checkpoint, step.
- **Decisions already made**: `docs/adr/`. Read the ones that touch your area before you change its design.
- **End-to-end tests**: the `codeclimb-e2e` skill.
- **Given inputs**: `scenarios/`, `configs/` and `docker/` are what the build runs on. Change them only when the user asks.
- **Night output**: `runs-langchain/` (gitignored). A config's `results_path` is relative to it: `datenorm-smoke/results.jsonl` → `runs-langchain/datenorm-smoke/results.jsonl`; mock nights under `runs-langchain/mock/`.

## Tech stack

- TypeScript on Node 24, ESM, run from source with `tsx`
- LangChain ecosystem; full docs: https://docs.langchain.com/llms.txt, or the `langchain-docs` MCP
    - Use the TypeScript pages, not the Python ones: the two APIs differ (Python's `retry_policy` is `retry` on a JS task)
    - LangGraph JS (`@langchain/langgraph`): the functional API (`entrypoint`, `task`, `interrupt`)
    - Agent Server: `npm run server` (`langgraphjs up`: the server container plus its own Postgres and Redis) serves the graphs in `langgraph.json` at http://127.0.0.1:8123. A code change needs `npm run server` again, which rebuilds the image. It runs one night at a time. `npm run server:stop` stops the stack and keeps every thread in Postgres
    - The server needs `.env` with `LANGSMITH_API_KEY` to boot. A git worktree needs its own `.env`: symlink the main checkout's
    - LangSmith (`langsmith`): tracing and feedback only
- Pi (`@earendil-works/pi-coding-agent`): the coder, the reviewer and the lessons sessions run on its SDK; full docs: https://github.com/earendil-works/pi
- Docker: every sandbox is a local container, so Docker must be running for any night

The spec's "Platform facts" lists LangGraph and LangSmith behaviours already measured on the pinned versions. Trust them over memory and over the docs.

## LangGraph debugging

With `npm run server` running, use the local Agent Server REST API:

- Health: `curl -s http://127.0.0.1:8123/ok`
- Run a graph and wait: `curl -s -X POST http://127.0.0.1:8123/runs/wait -H 'content-type: application/json' -d '{"assistant_id":"<graph>","input":{...}}'`
- Thread state: `curl -s http://127.0.0.1:8123/threads/<thread_id>/state`
- Thread history: `curl -s -X POST http://127.0.0.1:8123/threads/<thread_id>/history -H 'content-type: application/json' -d '{}'`
- Runs on a thread: `curl -s http://127.0.0.1:8123/threads/<thread_id>/runs`
- Server logs: `npm run server:logs` (the server container, `<project>-langgraph-api-1`, named in `npm run server`'s last line)

Output is JSON. Use jq to filter.
A night's own state is in its files under `runs-langchain/`, not in the server: read `nights/<id>/` first.
Traces: LangSmith project `$LANGSMITH_PROJECT`, through the `langsmith` MCP or LangGraph Studio (https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:8123).
If access is denied, ask the user to review the session's permissions.

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text (e.g., "Thanks @user" not "Thanks so much @user!")
- Technical prose only, be direct
- Use concise, clear, simple language. Define unavoidable jargon before using it.
- Explain non-trivial designs and problems as: problem, concrete example or short trace, then solution. State why the solution is necessary and distinguish it from optional complexity.
- Prefer concrete behavior and small illustrations over abstract summaries, dense terminology, or unexplained lists of changes.
- When the user asks a question, answer it first before making edits or running implementation commands.
- When responding to user feedback or an analysis, explicitly say whether you agree or disagree before saying what you changed.

## Code Quality

- Read files in full before wide-ranging changes, before editing files you have not fully inspected, and when asked to investigate or audit. Do not rely on search snippets for broad changes.
- No `any` unless absolutely necessary.
- Inline single-line helpers that have only one call site.
- Check node_modules for external API types; don't guess.
- **No inline imports** (`await import()`, `import("pkg").Type`, dynamic type imports). Top-level imports only.
- Keep step bodies free of LangGraph: it appears only in the graph definitions, the step wrappers and the control operations.
- When the spec and the code disagree, the spec wins. When the spec looks wrong, stop and ask the user: the fix goes into the spec first.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.

## Commands

- After code changes (not docs): `npm run typecheck`, then `npm test` (the unit tests: fast and free). Fix every error before committing.
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- Whole nights: the `codeclimb-e2e` skill. Its free scenarios run on mock models; run them whenever a change touches what they cover.
- Spend money only when the user says so: a night on real models, or a paid e2e scenario, needs the user's go-ahead for that run.
- When a regression test fixes a GitHub issue, add a comment with the issue number next to the test.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat npm dep and lockfile changes as reviewed code. Every dependency is pinned to an exact version: the one in the spec's dependency table.
- A dependency the spec's table does not list, or another version of one it does: ask the user first.
- Hydrate/update locally with `npm install --ignore-scripts`; clean/CI-style with `npm ci --ignore-scripts`. Don't run lifecycle scripts unless the user asks.
- If dep metadata changes, refresh `package-lock.json` with `npm install --package-lock-only --ignore-scripts`.

## Git

Multiple agent sessions may be running in this cwd at the same time, each modifying different files. Git operations that touch unstaged, staged, or untracked files outside your own changes will stomp on other sessions' work. Follow these rules:

Committing:

- Only commit files YOU changed in THIS session.
- Stage explicit paths (`git add <path1> <path2>`); never `git add -A` / `git add .`.
- Before committing, run `git status` and verify you are only staging your files.
- Message format: `{feat,fix,docs}: <commit message> (optionally multiple lines)`. Message is informative and concise.

Never run (destroys other agents' work or bypasses checks):

- `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`.

If rebase conflicts occur:

- Resolve conflicts only in files you modified.
- If a conflict is in a file you did not modify, abort and ask the user.
- Never force push.

## Issues and PRs

When reviewing PRs:

- Do not run `gh pr checkout`, `git switch`, or otherwise move the worktree to the PR branch unless the user explicitly asks.
- Use `gh pr view`, `gh pr diff`, `gh api`, and local `git show`/`git diff` against fetched refs to inspect PR metadata, commits, and patches without changing branches.
- If you need PR file contents, fetch/read them into temporary files or use `git show <ref>:<path>` without switching branches.

When creating issues:

- Apply one triage label (see Triage labels below).

When posting issue/PR comments:

- Write the comment to a temp file and post with `gh issue/pr comment --body-file` (never multi-line markdown via `--body`).
- Keep comments concise, technical, in the user's tone.
- End every AI-posted comment with the AI-generated disclaimer line specified by the originating prompt (e.g. `This comment is AI-generated by `/wr``).

When closing issues:

- A commit message with `fixes #<number>` or `closes #<number>` closes the issue only when it merges into `main`. For multiple issues, repeat the keyword per issue (`closes #1, closes #2`); a shared keyword (`closes #1, #2`) only closes the first.
- Work on `langchain` does not merge into `main`, so close a finished build ticket by hand: `gh issue close <number>` with a comment naming the commit, once its acceptance criteria pass and the work is committed. Closing it unblocks the tickets behind it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for decodingai-magazine/codeclimb, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
