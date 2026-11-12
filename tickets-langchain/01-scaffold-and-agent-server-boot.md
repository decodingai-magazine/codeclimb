# 01: Scaffold and Agent Server boot

**What to build:** An operator clones the checkout, copies `.env.example` to `.env`, runs `npm run server`, and gets the Agent Server answering `/ok` on `127.0.0.1:8123` with three graphs registered: `night`, `stop`, `lessons`. The graphs are placeholders that return at once; later tickets replace them. `npm run typecheck` and `npm test` run. `npm run build:image` builds `codeclimb-python`.

Creating or rewriting `package.json`, `tsconfig.json`, `.env.example`, `langgraph.json`, the compose override, `.dockerignore` and the placeholder graph is in scope here: create what is absent and bring what exists to the spec. Do not change `scenarios/`, `configs/` or the two Dockerfiles.

**Spec sections:**
- "What you get, what you build": the fixed npm scripts, the dependency table (exact versions, lifecycle scripts off), the `codeclimb-python` image, host tools
- "Deployment and environment": the server image, the compose override, Commands, Environment (the env file and its load order, `caffeinate`), the variable table
- "Platform facts": the first table (the image, the published port, `up` swallowing failures, `api_version`)
- "Durable runtime on LangGraph": the Graphs table (names only)
- "Every number in one place": ports, server image, server

**Not yet:** any night logic; the `api`, `run-night`, `validate-results`, `export`, `lessons`, `dev` and `build:app` scripts may be declared but their commands land in later tickets. `build:dataset` and `build:dataset:hard` call the given scenarios' own scripts; the spec does not describe them further.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every dependency of the spec's table is pinned to its exact version; `npm ci --ignore-scripts` installs cleanly and installs one copy of `@earendil-works/pi-ai`
- [ ] `langgraph.json` names the graphs `night`, `stop` and `lessons`, pins `api_version`, names the env file, the extra image lines and the compose override
- [ ] `.dockerignore` holds every entry the spec lists; `.env.example` lists every key of the spec's variable table that an operator sets; `.env` is gitignored
- [ ] `npm run server` fails with a clear message when `.env` is missing; otherwise it creates `cc-meter` when missing, creates a missing Pi `auth.json` as `{}`, runs `up` through its own `docker` shim, fails on a non-zero compose status, and polls `/ok` for up to 5 minutes, failing when the server container exits or the deadline passes
- [ ] `server` never passes `up --watch` or `up --recreate`; on macOS it starts the detached `caffeinate` that ends with the server container
- [ ] After `npm run server`, `curl http://127.0.0.1:8123/ok` answers, and the server container's port is published on loopback only; `server` stops the stack when it is bound wider
- [ ] A run of each placeholder graph through the server's API ends in `success`
- [ ] Inside the server container: `git`, the Docker CLI, `python3`, `uv`, `tar` and `bash` exist; `docker ps` reaches the host's daemon; the checkout is mounted at its host path, its git directory read-only at its host path, Pi's `auth.json` at `/pi/auth.json` and the `uv` volume at `/uv`; the container is on `cc-meter` under the alias `codeclimb-server`; the environment of the override is set (`CODECLIMB_ROOT`, `CODECLIMB_PI_AUTH_PATH`, `CODECLIMB_SERVER_URL`, proxy host and port, relay target, `N_JOBS_PER_WORKER=4`, `BG_JOB_TIMEOUT_SECS=432000`, the `UV_*` variables)
- [ ] `npm run server:logs` follows the server container's logs; `npm run server:stop` brings the stack down and keeps the data volume
- [ ] The env loader reads `.env` from the start directory, then from `CODECLIMB_ROOT` when that differs, and never overrides a value already in the shell (unit test)
- [ ] `npm run build:image` builds `codeclimb-python` with the tools and settings the spec lists
- [ ] `npm run typecheck` and `npm test` pass
