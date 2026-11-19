# 07: Experiment repository

**What to build:** `experiments.git`, a bare repository under the results directory, holds the starter and one commit per experiment, each at `refs/exp/<exp id>`. Git holds the state of a night's code: the night imports the starter as its round-0 commit, records each experiment's result as exactly one commit on the commit its sandbox started from, and reads trees and diffs back for decisions, notes and export.

**Spec sections:**
- "Interfaces the build must honour" > "Files a night writes": the `experiments.git` row
- "Interfaces the build must honour" > "Ids": the starter, seed, experiment and repair ids
- "Architecture": the experiment store row; the data flow of an experiment ("exactly one commit on the commit its sandbox started from")
- "Features": **Sandboxes** ("Git holds the state")

**Not yet:** getting a commit into and out of a sandbox (tickets 08, 10).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] The repository is created bare under the results directory on first use and shared by every night of that results directory
- [ ] Importing a scenario's `starter/` gives `refs/exp/<night>-r0-starter`; the starter commit is deterministic: the same tree has the same SHA across nights and machines (unit test with two imports)
- [ ] Recording an experiment's files makes exactly one commit whose parent is the commit the experiment started from, at `refs/exp/<exp id>`, with the message `<exp id>: <hypothesis>`; recording it again for the same id does not make a second commit
- [ ] A seed commit can be stored at `refs/exp/<night>-r0-seed` pointing at an ended night's kept commit
- [ ] Two commits can be compared by tree (unchanged or not); a commit's diff against its parent and the diff's added lines can be read
- [ ] A commit's files can be written out to a directory, without git metadata
- [ ] Repository operations never need git credentials and never touch the checkout's own `.git`
- [ ] `npm run typecheck` and `npm test` pass
