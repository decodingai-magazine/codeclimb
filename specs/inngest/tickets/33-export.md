# 33: Export: a kept commit as files, as a git repository, or pushed to a remote

**What to build:** A night's result leaves `experiments.git`: a kept commit as plain files, as a git repository with the kept lineage as history, or as a push to a remote branch, from `npm run export` and through the worker API. It never force-pushes and never runs a command transport.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Export), "CLI", "Worker API"

**Blocked by:** 32 (Worker API: read nights, stop, resume, continue)

**Status:** ready-for-agent

- [ ] `npm run export -- (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])` exports the chosen experiment, `best` naming the kept commit of the most recently finished night
- [ ] `--to-dir` writes plain files and refuses a non-empty folder unless `--force`; `--with-history` writes a git repository whose history is the kept lineage, oldest first
- [ ] The kept lineage of an experiment is worked out from the rows and the repository (unit tests on fabricated rows, a seeded night included)
- [ ] `--to-remote` pushes the lineage to a branch, never with force; a remote that starts with `-`, has whitespace inside it or names a remote helper (`<name>::`, such as `ext::`) is refused (unit tests, plus a push to a local bare repository)
- [ ] `GET /api/nights/:id/export/:exp?format=repo|source|bundle` downloads the git repository, the tree only, or a git bundle; `POST /api/nights/:id/export/:exp` exports to a folder or a remote as the CLI does
- [ ] Integration test on the results directory of a `datenorm-smoke --mock` night: the kept commit exported with history gives a repository whose head tree equals the kept commit's tree and whose log holds the lineage
