# 33: Export: a kept commit as files, as a git repository, or pushed to a remote

**What to build:** `npm run export` writes a chosen experiment as plain files, as a git repository whose history is the kept lineage, or pushes that lineage to a remote branch. The worker API offers the same as downloads and as server-side exports. Nothing is ever force-pushed and git never prompts.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Export", "Worker API", "Experiment repository"

**Blocked by:** 32 (Worker API: read nights, stop, resume, continue)

**Status:** ready-for-agent

- [ ] CLI: `export (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])`; `best`, the default, is the kept commit of the most recently finished night
- [ ] `--to-dir` writes plain files and refuses a non-empty folder unless `--force`; `--with-history` needs an empty or new folder and writes a git repository with the kept lineage as history on branch `codeclimb/<exp id>`
- [ ] The kept lineage is built from the rows' `parent_id` chain of kept experiments (unit tests on fabricated rows, seed and rescore aliases included)
- [ ] `--to-remote` pushes the lineage to `codeclimb/<exp id>` or the given branch, never with force; remotes are limited to `https`, `ssh`, `git`, `file` and local paths; option-like arguments and the `ext::` / `fd::` transports are refused; git runs with credential prompts off (unit tests, plus a push to a local bare repository)
- [ ] API: `GET /api/nights/:id/export/:exp?format=repo|source|bundle` downloads a git repository `.tar.gz` (default), the tree only, or a git bundle; `POST /api/nights/:id/export/:exp` accepts `kind: dir` with a `path` (always the git-repository form) or `kind: remote` with `url` and optional `branch`
- [ ] Integration test on a results directory left by `datenorm-smoke --mock`: exporting the kept commit with history gives a repository whose head tree equals the kept commit's tree and whose log holds the lineage
