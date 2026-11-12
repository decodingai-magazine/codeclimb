# 37: Worker API

**What to build:** `npm run api` starts the worker API in its own process on `127.0.0.1:7421`. A client can list nights, read one night's summary, live view and report, and stop, resume or continue a night. Status comes from the night's files, never from the Agent Server.

**Spec sections:**
- "Interfaces" > "Worker API": the intro, the endpoint table except the two export rows, and the bullets (status, phase, finding nights)
- "Components": the worker API row
- "Experiment lifecycle" > "Continue, seed and rescore": the API's continue (the night's saved config with `scenario.yaml` loaded again; the reopening before the server run)
- "Durable runtime on LangGraph" > "Cleanup": the API's stop writes `stop.json` with reason `app`
- "Deployment and environment": `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT`, `CODECLIMB_WORKER_TOKEN`, the env file
- "Every number in one place": the API row

**Not yet:** the export endpoints (ticket 39); the watchdog (ticket 38); the app (ticket 40). The API serves no `/v1`.

**Blocked by:** 28, 35

**Status:** ready-for-agent

- [ ] The API loads the env file first, binds `CODECLIMB_API_HOST` and `CODECLIMB_API_PORT` (default `127.0.0.1:7421`), and exits with an error when the port is busy
- [ ] On loopback no token is needed; off loopback it refuses to start without `CODECLIMB_WORKER_TOKEN` and requires it as a bearer on every route
- [ ] `GET /api/health`, `GET /api/nights` and `GET /api/nights/:id` answer from files under `runs-langchain/*/nights/*` and `runs-langchain/mock/*/nights/*`
- [ ] Status: `done.json` → `finished`, `stop.json` → `stopped`, `pause.json` → `paused`, no file written for an hour → `stale`, else `running`
- [ ] `GET /api/nights/:id/live` returns the summary, the current round's experiment (phase, elapsed, coder and dev spend, tokens), the row count and the exportable experiments; the phase follows the spec's rule, and a repair `e1` takes over once its folder exists
- [ ] `GET /api/nights/:id/report` returns the night's rows, reviews, config extract and diffs as JSON
- [ ] `POST /api/nights/:id/stop` writes `stop.json` (`app`) at once and runs the stop operation; `POST …/resume` runs the resume operation
- [ ] `POST /api/nights/:id/continue` takes `{direction?, rounds ≥ 1}`, reopens the night as ticket 35 does and starts the variation; it answers 409 when the night can't continue
- [ ] A request body over 1 MB is refused; there is no endpoint that starts a new night
- [ ] Tests start the API on a free port against temporary night folders and a faked Agent Server client, and cover every endpoint, each status and each phase; against a finished mock night, `/api/nights/:id` reads `finished` and the report holds its rows
- [ ] `npm run typecheck` and `npm test` pass
