# CodeClimb benchmark: Development Rules

CodeClimb is an optimization loop: a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. This branch (`benchmark`) holds the benchmark: Harbor tasks, a verifier and job definitions that measure how well a harness (a coding agent) builds CodeClimb from a build spec, on Inngest and on LangChain. No CodeClimb build is committed here: builds exist only as trial artifacts.

## Where things are

- **Benchmark spec**: `docs/codeclimb-eval-spec.md` is the contract for everything built here. Read the sections a ticket names before writing code. It is a copy of the Obsidian note of the same name: change both together.
- **Build specs and build tickets**: `docs/codeclimb-spec-<stack>.md` and `tickets-<stack>/` (moving to `specs/<stack>/`). They are the benchmark's subjects, handed to the harness in a trial. Change them only when the user asks.
- **Benchmark tickets**: GitHub Issues, through `gh`. A benchmark ticket names its spec sections, its acceptance criteria and its blockers. Work a ticket only when every blocker is closed.
- **Vocabulary**: `GLOSSARY.md`. Use its words in code, commits and issues: stack, build spec, build ticket, benchmark ticket, harness, trial, arm, workflow, phase, verifier, reward. CodeClimb's own words (night, round, experiment, evaluation) keep the meaning the build specs give them.
- **Decisions already made**: `docs/adr/`. Read the ones that touch your area before you change its design.
- **Given inputs**: `scenarios/`, `configs/` and `docker/` are copies from the `langchain` branch, shared by both stacks. Change them only when the user asks.
- **Reference builds**: on `main` (Inngest) and `langchain`, named here only by commit SHA. Never copy their source into this branch.
- **Harbor job output**: `jobs/` (gitignored).
- **`.claude/skills/codeclimb-e2e`**: the end-to-end procedure of the LangChain reference build, copied from `langchain`. It describes a build, not this branch: nothing here has `npm run server`.

## Tech stack

- Harbor 0.25.0 (`uv tool install harbor`) runs trials; full docs: https://harborframework.com/docs
- Python, run with `uv`: the assemble step, the verifier and the analysis
- Docker: every trial and every verifier run gets its own daemon, a `docker:27-dind` sidecar whose network the trial container shares (`docs/adr/0001`). Docker must be running
- Claude Code on Opus 5.5 at medium effort, on the operator's subscription: the harness under test
- The build specs' stacks (TypeScript on Node 24; Inngest, or LangGraph JS with the Agent Server; Pi; Docker sandboxes) appear here only inside task images and reference builds

The benchmark spec marks every unverified fact with `(guess)`. Verify one before building on it, and replace the marker with what you measured.

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
- Check Harbor's own schema and source (`harbor job schema`, the installed package) for field names and behaviour; don't guess.
- Inline single-line helpers that have only one call site.
- The verifier is one suite for both stacks. Stack-specific code lives only in a stack's adapter.
- Never grade a harness on a check a reference build fails.
- When the spec and the code disagree, the spec wins. When the spec looks wrong, stop and ask the user: the fix goes into the spec first.
- Always ask before removing functionality or code that appears intentional.
- Do not preserve backward compatibility unless the user asks for it.

## Commands

- Free checks, run them whenever a change touches what they cover:
  - a job file: `harbor run -c <job file> --print-config`
  - a task: `harbor run -p tasks/codeclimb-<stack> -a nop`
  - the verifier: `tests/run.py --app <git archive of the reference commit> --stack <stack>`
- If you create or modify a test file, run it and iterate on test or implementation until it passes.
- Spend only when the user says so: any trial with a real harness uses the operator's subscription and needs the user's go-ahead for that run. No trial and no check uses a provider key.
- When a regression test fixes a GitHub issue, add a comment with the issue number next to the test.
- For ad-hoc scripts, `write` them to a temp file (e.g. `/tmp`), run, edit if needed, remove when done. Don't embed multi-line scripts in `bash` commands.
- Never commit unless the user asks.

## Dependency and Install Security

- Treat dependency and lockfile changes as reviewed code. A stack's given `package.json` and lockfile pin exact versions: the ones in that build spec's dependency table.
- A dependency a build spec's table does not list, or another version of one it does: ask the user first.
- Install with lifecycle scripts off: `npm ci --ignore-scripts`, in task images and in the verifier.
- Vendored skills and docs are pinned to a commit and never edited, except where the benchmark spec names the edit.

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
- Work on `benchmark` does not merge into `main`, so close a finished benchmark ticket by hand: `gh issue close <number>` with a comment naming the commit, once its acceptance criteria pass and the work is committed. Closing it unblocks the tickets behind it.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for decodingai-magazine/codeclimb, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
