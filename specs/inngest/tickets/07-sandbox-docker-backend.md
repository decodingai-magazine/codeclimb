# 07: Sandbox interface and the Docker backend

**What to build:** One sandbox interface with one backend: a Docker container per sandbox, from a fresh image plus a commit, found by its deterministic name, swept by the night's prefix, and with commands whose whole process tree dies on a timeout or an abort. Nothing secret enters a sandbox, and it works when Docker is a remote daemon.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Sandboxes), "Architecture", "Services", "Ids and names", "Environment", "Numbers"

**Blocked by:** 01 (Project scaffold, npm scripts, env loading and sandbox images); 06 (Experiment repository: experiments.git, starter commit, experiment refs)

**Status:** ready-for-agent

- [ ] Creating a sandbox starts a container from a fresh image with a commit checked out in `/repo` and, when asked, a host directory copied in (the bundle, as `/spec`) (Docker tests on `codeclimb-python`)
- [ ] Each sandbox is limited to 2 vCPU and 2 GiB
- [ ] Commands run with a timeout and can be aborted; after either, no process the command started is left in the container (Docker test with a command that spawns children and sleeps)
- [ ] Files can be written into and read out of a sandbox, a directory whole
- [ ] Lookup by name finds a live sandbox and nothing for a dead one; a sweep by the prefix `cc-<night>` removes that night's sandboxes, running or stopped, and nothing else (Docker tests)
- [ ] No git credentials, provider key or host environment variable enters a sandbox (Docker test that reads a sandbox's environment)
- [ ] With `DOCKER_HOST` set, every Docker call goes to that daemon, and no sandbox depends on a host path outside the checkout
