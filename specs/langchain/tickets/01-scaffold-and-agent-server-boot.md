# 01: Scaffold and Agent Server boot

**What to build:** An operator runs `npm ci --ignore-scripts`, writes a `.env` with the three LangSmith values, runs `npm run server`, and gets the Agent Server answering `http://127.0.0.1:8123/ok`, serving a placeholder graph of the build's own. The server runs as the Docker Compose service `langgraph-api` beside its own Postgres and Redis services, sees the checkout, can start Docker containers beside itself and can run host commands. `npm run build:image` and `npm run build:image:graphrag` build the two sandbox images from the given Dockerfiles. `npm run typecheck` and `npm test` run.

Creating or rewriting `package.json`, `langgraph.json`, `tsconfig.json`, `.env.example` and `src/hello.ts` is in scope: they are a starting point. Do not change `scenarios/`, `configs/`, `docker/` or `E2E.md`.

**Spec sections:**
- "Interfaces the build must honour" > "Given inputs": all of it
- "Interfaces the build must honour" > "Commands and services": the npm scripts, install, graphs in `langgraph.json`, `server` / `server:stop`, where a night writes, images, host tools, ports
- "Interfaces the build must honour" > "Environment": `LANGSMITH_API_KEY`, `CODECLIMB_ROOT`, `CODECLIMB_SERVER_URL`, and the bullet on `.env`
- "Architecture": the Agent Server and sandboxes rows
- "Runtime and tools": the Agent Server bullet; "one server serves one checkout"
- "Numbers": `npm run server` returns within 600 s; the build row; ports
- "Dependencies": all of it

**Not yet:** any night logic. The scripts `api`, `run-night`, `validate-results`, `export`, `lessons`, `dev` and `build:app` are declared; their commands land in later tickets.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every package of "Dependencies" is pinned to its exact version in `package.json` and the lockfile; `npm ci --ignore-scripts` installs cleanly within 900 s and is all the install needs
- [ ] Every npm script the spec names exists: `server`, `server:logs`, `server:stop`, `api`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:dataset:hard`, `build:scenario:overfit`, `export`, `lessons`, `dev`, `build:app`, `typecheck`, `test`
- [ ] `npm run server` starts or updates the Agent Server from the checkout and returns once `http://127.0.0.1:8123/ok` answers, within 600 s cold; it exits non-zero with a clear message when it cannot (no `.env`, no `LANGSMITH_API_KEY`, Docker down, the server never answering)
- [ ] The server container is the Compose service `langgraph-api`; Postgres and Redis are services of their own. After `docker kill` of the server container, Postgres and Redis keep running and `npm run server` brings the server back with its state within 600 s
- [ ] Running `npm run server` again after a code change serves the changed code; `npm run server:stop` stops the stack and keeps its state; `npm run server:logs` follows the server's logs
- [ ] A run of the placeholder graph through the server ends successfully; `langgraph.json` declares the graphs
- [ ] `.env` is gitignored, is loaded by the CLI and reaches the Agent Server; a value already in the shell wins (unit test). The server boots with a `.env` holding only `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT` and `LANGSMITH_TRACING=false`
- [ ] From inside the Agent Server: `bash`, `git`, `tar`, `python3` and `uv` run, `uv` can run Python 3.14, a Docker container can be started beside the server container, and a file written under `<root>/runs-langchain/` appears in the checkout at that path
- [ ] `npm run build:image` builds `codeclimb-python` and `npm run build:image:graphrag` builds `codeclimb-graphrag`, each within 1200 s, from the given Dockerfiles; neither image holds gold, evaluators or keys
- [ ] `build:dataset` and `build:dataset:hard` run the dataset scripts of `scenarios/datenorm` and `scenarios/datenorm-hard`; `build:scenario:overfit` runs `scenarios/datenorm/scripts/build_overfit.py --out generated/datenorm-overfit`; the given `scenarios/` stay unchanged
- [ ] `npm run typecheck` passes within 600 s; `npm test` passes within 1200 s after `build:image`, with `.env` present, no Agent Server up and no `codeclimb-graphrag` image
