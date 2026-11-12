# 07: Experiment repository

**What to build:** A results directory gets a bare `experiments.git` that holds one commit per experiment under `refs/exp/<exp id>`. The build can import a starter directory as a commit whose SHA depends only on its tree, export a commit as a git bundle, import a git bundle a sandbox produced into an experiment's ref, alias a new experiment id to an existing commit, tell whether two commits have the same tree, and produce diffs.

**Spec sections:**
- "Data and files" > "Experiment repository"
- "Coder" > "End of an experiment": the host half of the commit (the host reads the git bundle and force-fetches `main` into the experiment's ref)
- "Sandboxes": the bullets on git bundles
- "Every number in one place": the git row

**Not yet:** the sandbox half of the commit (ticket 12); export to the operator (ticket 39).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] The repository is bare, with no remote and no branches, and is created on first use
- [ ] Importing the given `datenorm` starter twice, into two fresh repositories, gives the same SHA; the commit honours the starter's `.gitignore` and has the fixed message, author, committer and date
- [ ] A git bundle of a commit can be written to a file, and a git bundle holding `main` can be force-fetched into `refs/exp/<exp id>`
- [ ] A git bundle can hold two commits (a paused commit and its parent), as the pause resume needs
- [ ] An alias ref points a new experiment id at an existing commit
- [ ] `unchanged` compares tree ids, not SHAs
- [ ] The diff between two commits, the lines a commit adds over another, and a checkout of a commit's files into a temporary folder are available
- [ ] Git never prompts and reads no user or system identity from the host
- [ ] Unit tests cover the above with temporary repositories; `npm run typecheck` and `npm test` pass
