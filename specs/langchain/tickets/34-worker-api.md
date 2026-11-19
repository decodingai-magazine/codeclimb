# 34: Worker API

**What to build:** `npm run api` serves the worker API on `127.0.0.1:7421`, its own process and a client of the Agent Server like the CLI. Under `/api/` it serves health, night summaries (mock nights included), a night's live experiment and its report, for the app to read; and stop, resume and continue, for the app to control. A night's status comes from its files on disk, not from the runtime.

**Spec sections:**
- "Interfaces the build must honour" > "Worker API": all of it but export
- "Features": **Worker API and app** (the API)
- "Architecture": the worker API row; "CodeClimb has no database of its own"
- "Interfaces the build must honour" > "Environment": the bullet on `.env`; `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT`, `CODECLIMB_WORKER_TOKEN`, `CODECLIMB_SERVER_URL`
- "Numbers": ports

**Not yet:** the watchdog (ticket 35); export (ticket 36).

**Blocked by:** 26 (Pause for credits, resume and the pause timeout); 28 (Continue)

**Status:** ready-for-agent

- [ ] `npm run api` loads `.env` (a value already in the shell wins) and listens on `CODECLIMB_API_HOST`:`CODECLIMB_API_PORT`, by default `127.0.0.1:7421`; `/api/` health answers
- [ ] Night summaries list every night of every results directory under `runs-langchain/`, mock nights included, with id, config, status, rounds, kept and test scores, and spend
- [ ] Status is read from files: `finished` (a `done.json`), `stopped` (a `stop.json`), `paused` (a `pause.json`), `stale` (no file written for an hour), else `running`
- [ ] A night's live experiment (its `code-state.json`, tasks and progress) and its report (rows, reviews, notes, metrics per evaluation) are served
- [ ] Stop, resume and continue act as the CLI's commands do; a stop from the API leaves a `stop.json` whose reason names the API
- [ ] No token is needed on loopback; bound off loopback, every request needs `CODECLIMB_WORKER_TOKEN` as a bearer and is refused without it
- [ ] Tests run the API against night files on disk and a faked Agent Server client: every route, every status, the token rule
- [ ] A live check on a mock night: the API lists it as `running`, then `finished`; a stop through the API on another mock night leaves `stop.json` within 30 s
- [ ] `npm run typecheck` and `npm test` pass
