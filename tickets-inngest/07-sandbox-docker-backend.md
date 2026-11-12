# 07: Sandbox interface and the Docker backend

**What to build:** Pi's tools and the orchestrator talk to sandboxes through one interface. On Docker a sandbox is a container from the scenario's image, created from a commit and an optional `/spec` folder, found again by its deterministic name, and swept by prefix or label. Exec kills the whole process tree on a timeout or an abort, which is what every later timeout relies on.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Sandboxes", "Ids"

**Blocked by:** 01 (Project scaffold, npm scripts, env file and sandbox images); 06 (Experiment repository: experiments.git, starter commit, refs, git bundles)

**Status:** ready-for-agent

- [ ] The interface has the backend operations (create, find by name, sweep by prefix or label, optional maximum active time) and the sandbox operations (exec, read file, write file, is alive, instance id, age, destroy) as the spec lists them
- [ ] Docker tests against `codeclimb-python` (skipped with a clear message when Docker is absent): create with a commit puts it in `/repo` via a git bundle; create with a spec directory puts it in `/spec` via a tar; create replaces a stale sandbox of the same name and the instance id changes
- [ ] Containers are limited to 2 CPUs and 2 GiB, carry `cc.managed=1`, `cc.night`, `cc.run`, and join the default bridge or the named network asked for
- [ ] Exec returns exit code, stdout, stderr, timed-out and aborted flags; streams output; takes stdin and per-command environment; the host environment is not forwarded
- [ ] A command that spawns children and sleeps is fully gone from the container after a timeout and after an abort (the session-leader and process-group kill of the spec), proven by listing processes
- [ ] Helper execs use the working directory `/`; write file creates parent directories; a file as large as a git bundle of the given starters round-trips byte for byte
- [ ] Find by name returns a live sandbox and nothing for a dead one; a prefix sweep removes `cc-<night>…` containers only, anchored at the name's start, and only managed ones
