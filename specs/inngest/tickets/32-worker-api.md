# 32: Worker API: read nights, stop, resume, continue

**What to build:** The worker's HTTP API, on the listener of ticket 11, reads nights from the files, so status never depends on the runtime, and offers stop, resume and continue. Any client can use it; the app of tickets 34 and 35 is one. Export comes in ticket 33.

**Spec sections** (`specs/inngest/spec.md`): "Worker API", "Services", "Environment", "Features" (Worker API and app), "Architecture"

**Blocked by:** 24 (Pause for credits and resume); 26 (Continue: more rounds on an ended night, with an operator's direction)

**Status:** ready-for-agent

- [ ] `GET /api/health`, `GET /api/nights` and `GET /api/nights/:id` answer from the files, finding nights under `runs-inngest/*/nights/` and `runs-inngest/mock/*/nights/`
- [ ] Night status comes from files: `finished`, `stopped`, `paused`, `stale` or `running` (unit tests on fabricated night folders)
- [ ] `GET /api/nights/:id/live` answers the night's current state, the running experiment included; `GET /api/nights/:id/report` answers the night's rows and reviews
- [ ] `POST /api/nights/:id/stop` stops the night hard with reason `app`; `/resume` ends a pause; `/continue` takes `{direction?, rounds}` and continues an ended night as `run-night continue` does, a mock night as a mock
- [ ] No token on loopback; off loopback the API needs `CODECLIMB_WORKER_TOKEN` as a bearer (unit tests)
- [ ] The API binds `CODECLIMB_API_HOST` and `CODECLIMB_API_PORT`, default `127.0.0.1:7421`, and still answers before the dev server is up, with no `.env` and no `runs-inngest/` folder
- [ ] Integration test against a results directory a mock night left: each read endpoint answers with that night's data; end to end on the dev server, a POST to `/stop` stops a running mock night and a POST to `/continue` adds a round to a finished one, which runs on mock models and stays under `runs-inngest/mock/`
