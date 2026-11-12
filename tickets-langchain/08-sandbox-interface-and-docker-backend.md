# 08: Sandbox interface and Docker backend

**What to build:** One sandbox interface that the coder's tools and the orchestrator will call, with a Docker backend behind it. A caller can create a named sandbox from an image with a commit cloned into `/repo` and a spec directory uploaded as `/spec`, run commands in it with a timeout and an abort signal, move files in and out, find it again by name, and sweep sandboxes by name prefix or by label.

**Spec sections:**
- "Sandboxes": the interface bullets and "Docker backend"
- "Experiment lifecycle" > "Ids": sandbox names
- "What you get, what you build": the `codeclimb-python` image (consumed here)
- "Every number in one place": the sandbox row; evaluator "reset; git helper"

**Not yet:** the refusal to create a sandbox for a night that has a `stop.json` (ticket 24); the `cc-meter` network and the relay (ticket 22), though create already takes a network name; the evaluator's reset (ticket 13).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Create starts one container limited to 2 CPUs and 2 GiB with the labels `cc.managed=1`, `cc.night`, `cc.run`, on the default bridge or a named network; it replaces a stale sandbox of the same name
- [ ] Create with a commit leaves that commit checked out in `/repo` and the parent's git bundle in the sandbox outside `/repo`; create with a spec directory leaves it at `/spec`. Files move by copy, never by bind mount
- [ ] Exec returns exit code, stdout, stderr, timed out and aborted; it streams output, takes stdin, a working directory and per-command environment; the host's environment never reaches the command
- [ ] A timeout or an abort kills the command's whole process tree in the container: a `sleep` started by a shell that was timed out is gone afterwards
- [ ] Write file creates parent directories; read and write move a file at least as large as a git bundle of the given starters; directories move as tars
- [ ] Find by name returns a live sandbox or nothing; is alive, instance id (new after a recreate under the same name), age and destroy work
- [ ] Sweep by name prefix matches only managed containers whose name starts with the prefix; sweep by label works
- [ ] Helper execs use the working directory `/`
- [ ] Tests run against the local Docker daemon with the `codeclimb-python` image and leave no container behind; `npm run typecheck` and `npm test` pass
