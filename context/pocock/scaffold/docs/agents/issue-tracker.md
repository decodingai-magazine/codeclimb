# Issue tracker: Local Markdown

Issues for this repo live as markdown files in `.scratch/`. There is no remote tracker: never call `gh`, `glab` or any tracker API.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`. This repo has one: `.scratch/codeclimb/`
- The spec is `SPEC.md` at the repo root
- Implementation issues are one file per ticket at `.scratch/codeclimb/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file. `.scratch/codeclimb/issues/README.md` says how to work them
- State is recorded as a `**Status:**` line near the top of each issue file: `ready-for-agent` while open, `done` once its acceptance criteria pass
- Blockers are the `**Blocked by:**` line: a ticket can start when every ticket it lists is `done`
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/codeclimb/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The ticket number maps to `.scratch/codeclimb/issues/<NN>-*.md`.
