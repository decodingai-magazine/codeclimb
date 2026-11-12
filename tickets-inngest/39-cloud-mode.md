# 39: Cloud mode: the worker and the CLI against Inngest Cloud

**What to build:** Setting `CODECLIMB_ENV=cloud` switches the worker and the CLI from the dev server to Inngest Cloud by signing and event keys. Cloud mode refuses to start half-configured, pins the proxy's port, and allows `sandbox: inngest`, while local mode keeps turning it into Docker. The worker stays on the operator's machine in both modes.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Deployment and environment", "Durable runtime on Inngest", "CLI", "Night config", "Metering proxy"

**Blocked by:** 20 (Done signal: both mock nights pass the end-to-end checks)

**Status:** ready-for-agent

- [ ] Mode selection is one tested function: outside cloud mode `INNGEST_DEV` defaults to `1` even when cloud keys are in `.env`; cloud mode refuses to start without `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY`, or with `INNGEST_DEV` set (unit tests)
- [ ] `npm run worker:cloud` and `npm run run-night:cloud` set `CODECLIMB_ENV=cloud`; with no keys both exit non-zero naming the missing key, without contacting anything
- [ ] In cloud mode the proxy's default port is 7422; a local and a cloud worker can run side by side (the busy API port is logged, each has its own proxy listener)
- [ ] In cloud mode `--sandbox inngest` and a config's `sandbox: inngest` are kept and the 50-minute caps are checked; in local mode they become `docker` with the printed note; the Inngest Sandboxes backend refuses dev mode with a clear error until ticket 40 supplies it
- [ ] No code outside the mode function, the client setup and the scripts branches on dev versus cloud
- [ ] Nothing in this ticket contacts Inngest Cloud: the mode function, the scripts and the refusals are tested without keys or against fakes. The night through `worker:cloud` and `run-night:cloud` is ticket 43, which runs only with the operator's go-ahead
- [ ] Both mock nights of ticket 20 still pass every check of "Goal and done signal"
