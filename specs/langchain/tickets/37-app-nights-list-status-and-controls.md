# 37: App: nights list, status and controls

**What to build:** A Next.js app on `127.0.0.1`, a client of the worker API that never runs Pi or sandboxes. `/` lists the nights. `/nights/<id>` shows one night's status with its controls (stop, resume, continue), the kept and test scores, the spend and the live experiment. `npm run dev` serves it; `npm run build:app` builds it.

**Spec sections:**
- "Features": **Worker API and app** (the app: list, status and controls, the kept and test scores, spend, the live experiment)
- "Architecture": the app row
- "Interfaces the build must honour" > "Worker API": the app pages `/` and `/nights/<id>`
- "Interfaces the build must honour" > "Commands and services": `dev`, `build:app`; "app: `127.0.0.1`"
- "Interfaces the build must honour" > "Environment": `CODECLIMB_WORKER_URL`, `CODECLIMB_WORKER_TOKEN`

**Not yet:** the metric tables, the chart, the heatmap, the experiment's diff and export (ticket 38).

**Blocked by:** 34 (Worker API)

**Status:** ready-for-agent

- [ ] `npm run dev` serves the app on `127.0.0.1` only, on a port the Agent Server and the worker API do not use; `npm run build:app` builds it with no error
- [ ] The app reaches the worker API at `CODECLIMB_WORKER_URL` (default the API's own address), with `CODECLIMB_WORKER_TOKEN` as a bearer when set; it never reads night files itself
- [ ] `/` lists every night the API returns, mock nights included, with status, rounds, kept score, test score and spend, each linking to `/nights/<id>`
- [ ] `/nights/<id>` shows the status, the kept and test scores, the spend and the live experiment, and refreshes while the night runs
- [ ] Stop is offered on a running or paused night, resume on a paused one, continue on an ended one (with direction and rounds); each calls the API and the page shows the result
- [ ] Tests render both pages against a faked API; a live check against `npm run api` lists the mock nights of ticket 21
- [ ] `npm run typecheck` and `npm test` pass
