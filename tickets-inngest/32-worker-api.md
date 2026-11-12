# 32: Worker API: read nights, stop, resume, continue

**What to build:** On `127.0.0.1:7421` the worker answers night summaries, the live state of the current experiment and a full report, all read from files so the answer doesn't depend on the durable runtime. It accepts stop, resume and continue, and routes `/v1/*` to the metering proxy's handler. Off loopback a bearer token is required. The export endpoints come with ticket 33.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Worker API", "Deployment and environment", "Continue, seed and rescore", "Cleanup", "Metering proxy", "Files a night writes", "Every number in one place"

**Blocked by:** 24 (Pause for credits and resume); 26 (Continue: more rounds on an ended night, with an operator's direction)

**Status:** ready-for-agent

- [ ] The API is built on `node:http`, binds `CODECLIMB_API_HOST` and `CODECLIMB_API_PORT` (falling back to `PORT`, default 7421), limits request bodies to 1 MB, and logs a busy port without failing the worker
- [ ] No token on loopback; off loopback every route but `/v1` needs `CODECLIMB_WORKER_TOKEN` as a bearer and the API refuses to serve without one (unit tests)
- [ ] `GET /api/health`, `GET /api/nights`, `GET /api/nights/:id` return summaries found under `runs/*/nights/*` and `runs/mock/*/nights/*`
- [ ] Status comes from files: `done.json` → `finished`, `stop.json` → `stopped`, `pause.json` → `paused`, no file written for an hour → `stale`, else `running` (unit tests on fabricated folders)
- [ ] `GET /api/nights/:id/live` returns the summary, the current round's experiment with the phase rule (`starting`, `coding`, `waiting for eval`, `evaluated`; `e1` taking over once its folder exists), elapsed, coder and dev spend, tokens, and the exportable experiments
- [ ] `GET /api/nights/:id/report` returns the night's rows, reviews, a config extract and diffs as JSON
- [ ] `POST /api/nights/:id/stop` sends the stop event with reason `app` and writes `stop.json` at once; `/resume` sends the resume event; `/continue` takes `{direction?, rounds ≥ 1}`, uses the night's saved config with `scenario.yaml` loaded again, reopens the night with the function of ticket 26 before sending, and answers 409 when the night can't continue
- [ ] No endpoint starts a new night: nights start only from the CLI
- [ ] `/v1/*` on the API port reaches the proxy handler; the proxy's own listener is unaffected by a busy API port
- [ ] Integration test against a results directory left by a mock night: each read endpoint answers with the night's data; end-to-end on the dev server, a POST to `/stop` stops a running mock night and a POST to `/continue` adds a round to a finished one
