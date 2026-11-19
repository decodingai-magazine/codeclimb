# 08: Sandboxes on Docker

**What to build:** One sandbox interface and its Docker backend. A sandbox is a container of the scenario's image, 2 vCPU and 2 GiB, with a deterministic name that starts with `cc-<night>` and labels naming its night. CodeClimb creates it, runs commands in it, moves files in and out, finds it again by name after a rerun, and removes it; a sweep removes every sandbox of a night, running or stopped.

**Spec sections:**
- "Features": **Sandboxes**
- "Interfaces the build must honour" > "Ids": the sandbox row and the paragraph under the table
- "Architecture": the sandboxes row; isolation invariant "gold, evaluators and provider keys never enter a sandbox"
- "Interfaces the build must honour" > "Night config": `sandbox` is `docker` only
- "Numbers": sandbox size

**Not yet:** who creates which sandbox when (tickets 10, 11); a stopped night creating no new sandbox (ticket 22).

**Blocked by:** 07 (Experiment repository)

**Status:** ready-for-agent

- [ ] Creating a sandbox from an image with a commit gives a running container whose `/repo` holds that commit's files and, for a coder, whose `/spec` holds the bundle; it is limited to 2 vCPU and 2 GiB
- [ ] The sandbox holds no git credentials, no provider keys, no gold and no evaluators: its environment and its files are checked in a Docker test
- [ ] A command runs in the sandbox with a working directory, an environment and a time limit; on the limit or on an abort, the command's whole process tree is killed and the sandbox stays usable (Docker test with a process that spawns children)
- [ ] Files and directories move from the host into the sandbox and back
- [ ] Creating a sandbox whose name already exists finds that sandbox instead of failing, so a rerun step gets its own sandbox back
- [ ] Every sandbox carries labels naming its night; a sweep of a night removes all of that night's sandboxes, running or stopped, and none of another night's
- [ ] Docker tests run in `npm test` against `codeclimb-python` and clean up after themselves
- [ ] `npm run typecheck` and `npm test` pass
