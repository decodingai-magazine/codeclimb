# 06: Experiment repository: experiments.git, starter commit, refs, git bundles

**What to build:** A results directory gets its `experiments.git`: the starter is imported as a commit with a stable SHA, each experiment is pinned by `refs/exp/<exp id>`, a ref can alias an existing commit, two commits can be compared for `unchanged`, and commits move in and out as git bundles. The host-side reads the loop needs (a diff between two commits, the lines a commit adds, a temporary checkout, the tree as files) live here too.

**Spec sections** (`specs/inngest/spec.md`): "Experiment repository", "Ids", "Sandboxes"

**Blocked by:** 01 (Project scaffold, npm scripts, env file and sandbox images)

**Status:** ready-for-agent

- [ ] Creating the repository gives a bare repo with no remote and no branches; creating it twice is harmless (unit tests on a temp directory)
- [ ] Importing the same `starter/` twice, in two fresh repositories, yields the same SHA: `.gitignore` honoured, message `starter`, fixed author, committer and date `2026-01-01T00:00:00Z`
- [ ] A git bundle built from a commit (optionally holding a second commit, for the pause case) can be written out, and a git bundle holding `main` is force-fetched into `refs/exp/<exp id>` (unit tests)
- [ ] An alias ref points a new experiment id at an existing commit; `unchanged` compares tree ids, so an empty commit on a parent reads as unchanged (unit tests)
- [ ] Host-side reads: the diff between two commits, the added lines of that diff, a temporary checkout that is removed afterwards, and the text files of a commit (unit tests)
- [ ] `git log refs/exp/<id>` works on an imported experiment, as the done signal uses it
