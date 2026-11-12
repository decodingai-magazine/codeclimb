# 40: Export

**What to build:** An operator takes a kept commit out of `experiments.git`: as plain files in a folder, as a git repository whose history is the kept lineage on branch `codeclimb/<exp id>`, or as a push of that lineage to a remote branch. The same is available from `npm run export` and from the worker API, which can also serve it as a download.

**Spec sections:**
- "Interfaces" > "Export": all of it
- "Interfaces" > "Worker API": the two export rows of the endpoint table; "the exportable experiments" of the live view
- "Data and files" > "Experiment repository"; "Result row": `parent_id` and `decision` (the kept lineage)

**Not yet:** the app's Export control (ticket 42).

**Blocked by:** 38 (Worker API)

**Status:** ready-for-agent

- [ ] The kept lineage of an experiment is the chain of `keep` rows back to round 0, read from `results.jsonl`
- [ ] To a folder as plain files: refused when the folder is not empty, unless forced
- [ ] To a folder as a git repository: needs an empty or new folder; the lineage is the history on branch `codeclimb/<exp id>`
- [ ] To a remote: pushes the lineage to `codeclimb/<exp id>` or a given branch; never force-pushes; git never prompts for credentials
- [ ] Remotes are limited to `https`, `ssh`, `git`, `file` and local paths; option-like arguments and the command transports `ext::` and `fd::` are refused
- [ ] `npm run export -- (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])` works; `best`, the default, is the kept commit of the most recently finished night
- [ ] `GET /api/nights/:id/export/:exp?format=repo|source|bundle` downloads a git repository `.tar.gz` (the default), the tree only, or a git bundle
- [ ] `POST /api/nights/:id/export/:exp` takes `kind: dir` with a `path` (always the git-repository form) or `kind: remote` with a `url` and an optional `branch`
- [ ] Tests use temporary repositories and a local bare repository as the remote, and cover each target and each refusal; exporting the kept commit of a finished mock night gives a repository whose head tree holds `MOCK.md`
- [ ] `npm run typecheck` and `npm test` pass
