# 36: Export

**What to build:** A kept commit leaves CodeClimb as plain files, as a git repository with the kept lineage as history, or as a push to a remote branch. `npm run export` does it from a config or a rows file, for an experiment or `best`; the worker API offers the same as a download or to a directory or a remote. It never force-pushes and refuses unsafe remotes.

**Spec sections:**
- "Features": **Export**
- "Interfaces the build must honour" > "CLI": the `export` row
- "Interfaces the build must honour" > "Worker API": export (download, or to a directory or remote)

**Not yet:** the app's export button (ticket 38).

**Blocked by:** 34 (Worker API)

**Status:** ready-for-agent

- [ ] `export` takes a config or a rows file, an experiment id or `best` (the kept commit of the most recently finished night), and a target directory or a remote branch; a bad argument exits 2
- [ ] Plain files: the commit's tree, with no git metadata
- [ ] A git repository: the kept lineage from the round-0 commit to the exported commit as its history, one commit per kept experiment
- [ ] A push to a remote branch never force-pushes: a branch that diverged is refused; an unsafe remote is refused: one that starts with `-`, holds whitespace or names a remote helper (`<name>::`, such as `ext::`)
- [ ] An experiment that was not kept is refused
- [ ] The worker API serves the export as a download and runs it to a directory or a remote, with the same refusals
- [ ] Tests export a mock night's kept commit all three ways, pushing to a local bare repository
- [ ] `npm run typecheck` and `npm test` pass
