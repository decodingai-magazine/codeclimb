# 06: Experiment repository: experiments.git, starter commit, experiment refs

**What to build:** The bare repository that pins one commit per experiment, with everything the loop asks of it: a deterministic starter commit, an experiment's tree squashed into exactly one commit on its start commit, a ref per experiment, and the comparisons and diffs that the keep rule, the review and the leak scan read.

**Spec sections** (`specs/inngest/spec.md`): "Ids and names", "Files a night writes", "Features" (End of an experiment; Keep rule; Sandboxes), "Numbers"

**Blocked by:** 01 (Project scaffold, npm scripts, env loading and sandbox images)

**Status:** ready-for-agent

- [ ] `experiments.git` is a bare repository in the results directory, created when missing and shared by every night of that directory; creating it twice is harmless (unit tests on a temp directory)
- [ ] Importing the same `starter/` tree twice, into two fresh repositories, gives the same SHA (unit test)
- [ ] An experiment's tree, whatever commits it carries above its start commit, becomes exactly one commit whose only parent is that start commit, with message `<exp id>: <hypothesis>`, at `refs/exp/<exp id>` (unit test with three commits above the start)
- [ ] The starter is `<night>-r0-starter` and a seed `<night>-r0-seed`, each at its own ref
- [ ] "Files differ from the checkpoint's" compares trees, so an empty commit reads as unchanged (unit test)
- [ ] The diff between two commits and the lines it adds can be read on the host (unit tests)
- [ ] Moving a commit into or out of a sandbox needs no git remote and no credentials
- [ ] `git -C <dir>/experiments.git log refs/exp/<id>` shows an imported experiment's commit
