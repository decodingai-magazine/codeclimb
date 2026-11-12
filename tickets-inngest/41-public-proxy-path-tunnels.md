# 41: Public proxy path for Inngest Sandboxes: tunnels and the reachability probe

**What to build:** Inngest sandboxes can't see the worker's loopback, so a metered night on them needs the proxy published: by `CODECLIMB_METER_URL`, a Cloudflare quick tunnel or an ngrok tunnel. The worker finds the public URL in that order and, wherever the Docker backend checks its relay, probes the URL and accepts only the proxy's own 401.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Metering proxy", "Deployment and environment", "Round loop", "Evaluator", "Every number in one place"

**Blocked by:** 17 (Metered nights on Docker: relay, meter variables, both ledgers, cost metrics); 40 (Inngest Sandboxes backend)

**Status:** ready-for-agent

- [ ] `npm run tunnel:cloudflare` starts a `cloudflared` quick tunnel to the proxy's port on loopback (`CODECLIMB_PROXY_PORT`, default 7422) with its metrics server on `127.0.0.1:20241`; `npm run tunnel` starts an `ngrok` HTTP tunnel to the same address
- [ ] URL lookup order: `CODECLIMB_METER_URL` with a trailing slash dropped; else the Cloudflare `/quicktunnel` hostname; else the ngrok tunnel whose `public_url` starts with `https://` and whose `config.addr` ends in the proxy's port; `/v1` added to a tunnel's URL; each lookup waits 2 s at most; none found is an error naming both scripts and the variable (unit tests against fake local endpoints)
- [ ] The probe posts with no token to `<public url>/_op` and passes only on status 401 with the proxy's own error type in the body; 3 tries, 5 s apart, 15 s each; it carries a header that keeps the proxy from logging that 401 as a warning (unit tests, including a fake tunnel that answers 200 or its own error page)
- [ ] On the Inngest backend the probe runs before a coder starts, before an evaluator opens, after each stage's run (before the exit code is read) and in the round-start smoke test; metered sandboxes get the public URL in the four meter variables
- [ ] Only the proxy is published: the worker API's other routes are not reachable through the tunnelled port
- [ ] Integration test without any tunnel binary: with `CODECLIMB_METER_URL` pointing at the local proxy listener the probe passes; pointing at a server that answers 200 it fails and the evaluation throws instead of scoring
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes
