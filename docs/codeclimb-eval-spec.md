# CodeClimb benchmark: spec

- what it is: a Harbor benchmark in which a harness (a coding agent) builds CodeClimb from a build spec, once per trial, with zero human input. It measures what each kind of starting context adds, and compares the two stacks on the same checks
- status: from the 2026-11-12 design session. Every design decision is made. Items marked `(guess)` are unverified facts, listed again in Open points
- this branch is self-contained: every file a trial or the verifier needs is on `benchmark`. Other branches appear only as commit SHAs in [Reference builds](#reference-builds)
- this file is a copy of the Obsidian note `codeclimb-eval-spec`: change both together. Decisions that are hard to reverse: `docs/adr/`
- benchmark tickets: GitHub issues, the sub-issues of #33 (`decodingai-magazine/codeclimb`)
- words: `GLOSSARY.md`. Harness = the agent under test; Harbor = the tool that runs trials
- subjects: `specs/inngest/spec.md` and `specs/langchain/spec.md` (the build specs), each with its pile of build tickets in `specs/<stack>/tickets/`
- background: the long-running coding agents wiki in the vault (`wiki/synthesis`)

## Stack comparison

- the stack comparison is a reading of the trial results across the two stacks, not a separate set of night runs
- compared per stack: `reward`, `done`, which checks fail, agent $ and wall-clock to build, build tickets done (`pocock` workflow)
- a second question, decided 2026-11-17: which stack is easier for a harness to build on, change and debug. It is answered by the process, code and practice metrics of build trials (Metrics) and by maintenance tasks ([Maintenance tasks](#maintenance-tasks)); the arm 2 × 2 stays the primary claim
- like for like: both stacks are local only (Inngest dev server and one worker; `langgraphjs up`), with Docker sandboxes, the same scenarios, the same night configs, the same seven mock nights and the same checks
- a cross-stack claim is made only on checks both stacks share, and only once both reference builds pass the verifier
- cut from the earlier design: experiments per hour, `t_provision` and `t_teardown`, setup hours, backend LOC as a comparison of hand-run nights
- the reward needs no provider key: every counted night runs with `--mock`. The paid night 8 is out of both piles and both done signals. `graphrag-smoke` (night 7) stays counted, since it needs no key under `--mock`
- real-model nights run only in the verifier, as the `real.*` family ("Hidden and real checks"), never in the reward. Their one credential is the operator's Pi `github-copilot` login, handed to the verifier alone; the harness never sees it

## Benchmark

- question: which piece of each ecosystem's agent context (skills, or MCP + docs) helps a harness most when it builds CodeClimb from its build spec, and at what cost
- primary claim: within a stack, the skills and MCP + docs effects of a 2 × 2
- unit: one Harbor trial = (stack × arm × workflow). Zero human input
- harness: Claude Code on Opus 5.5 (`anthropic/claude-opus-5-5`), effort `medium`, on the operator's Claude subscription; model id, effort and CLI version pinned. One harness and one model only: Codex is cut
  - effort: Harbor's `claude-code` agent takes it as `kwargs.reasoning_effort` (`low` … `max`) and passes `--effort <level>` to `claude` (read from its source, Harbor 0.25.0). Measured 2026-11-13: the trial log's command line has `--effort medium`, the session file records `"effort":"medium"`; the ATIF trajectory and the stream's init event do not carry it. Model: `agent_info.model_info.name` and every agent step's `model_name` are `claude-opus-5-5`
  - probes: `job-configs/probes/run.sh <probe>...` runs short trials in a stack's trial environment (`STACK=langchain` for LangChain, default Inngest), the task's instruction replaced by a template from `job-configs/probes/` and no verifier: `one-line`, `network`, `search`, `budget`, `big`, `blocklist`. They use the subscription ($0.86 in all on 2026-11-13; each trial's environment setup takes about 21 s with a warm image)
- learning goal: run this type of benchmark end to end. Small matrix, every gate exercised

### Task

- 2 Harbor task dirs, `tasks/codeclimb-inngest/` and `tasks/codeclimb-langchain/`. Arms are job config, never task edits
- `instruction.md`: ~15 lines. "Build the app specified in `/app/SPEC.md`. You are done when every check in `/app/E2E.md` passes; a verifier reruns them on a clean copy. No human will answer." Leading `harbor-canary` comment
  - why not the spec itself: Harbor's `claude-code` agent hands the instruction to the container in one environment variable and pipes it to `claude --print` on stdin, so the cap should be Linux's 128 KiB per variable (read from the source, not measured); the specs are over 100 KB. A 120 KB instruction ran (measured 2026-11-13: the trajectory's first step holds all 122,873 characters, $0.38 for one turn), so the cap is not hit at that size, but a spec that grows past it would be
- `/app/SPEC.md`: `specs/<stack>/spec.md` with wikilinks flattened ([Building `/app`](#building-app))
- `/app/E2E.md`: `specs/<stack>/e2e.md`, the seven mock nights of the build spec's "Goal and done signal" as a procedure. Written once per stack from that spec, the same text on both stacks apart from the stack's service commands
- `/app/` given inputs, the same shape on both stacks:
  - shared, one copy at the branch root: `scenarios/`, `configs/`, `docker/` (the two Dockerfiles), copied from `langchain@bce6a16`
  - per stack, in `specs/<stack>/given/`: `.env.example`, `tsconfig.json`, `package.json` + lockfile (Inngest: the stack SDK only; LangChain: the scaffold its build spec names), one hello unit (LangChain: `langgraph.json` + `src/hello.ts`; Inngest: one function), `.gitignore`
  - where each comes from: the shared dirs and LangChain's `given/` are copies from `langchain@bce6a16` (its `package.json` and lockfile cut down to the stack SDK); Inngest's `given/` is copied from `main`, except the SDK-only `package.json` + lockfile and the hello function, which are written for the benchmark
  - `configs/e2e/budget.yaml` and `overfit.yaml` stay given: both build specs list them, for real-model nights that no check runs
  - runs folder: `runs-inngest/` on Inngest, `runs-langchain/` on LangChain, so the two never clash. Each build spec fixes its name; a config's `results_path` is relative to it, so the configs are byte-identical on both stacks
  - not given, because the build specs have the harness write them: `.dockerignore`, the LangChain compose override
  - out of `/app` (they are arms): `AGENTS.md` guidance, `.mcp.json`, `.claude/`, `docs/agents/`
- base image `node:24-trixie` (git 2.47, Python 3.13), on both stacks, in the trial and the verifier: bookworm's git 2.39 prints `%aI` as `+00:00`, which fails a LangChain reference unit test that expects `Z`
- `environment/`: Node 24, Python, `uv` 0.13.5, `git`, Docker CLI with the compose and buildx plugins, Claude Code 2.1.322 preinstalled (Harbor's own install hit the 360 s agent-setup timeout in the dummy run; Harbor skips its install when `claude` is present), stack CLI pinned (`inngest-cli@1.52.0`, not `@latest`; LangChain's is a devDependency), Pi docs at `/docs/pi/` in every arm (they live on GitHub, which is blocked), taken from the npm release the build specs pin (`@earendil-works/pi-coding-agent@1.3.0`: `docs/`, `README.md`, `examples/`) instead of a GitHub commit
- `/app` in the image: `git init` + one commit (`given inputs`), so the harness starts on a repository with no history. Checked in the built image: one commit, clean tree
- `task.toml`: `[agent] timeout_sec = 10800` (phase B: the longest agent phase took 62 min, so about 3× it; the $32 cap stops a runaway trial first, at about 2 h of that pace), `[verifier] timeout_sec = 10800` (set from measurements: a passing reference build's verifier phase takes about 7.5 min in Harbor, and the verifier's own limits sum to about 9100 s, so a hung build still gets a `reward.json` before Harbor's limit), `environment_mode = "separate"`; `artifacts = [{ source = "/app", exclude = [".env", "node_modules", ".venv", "runs-inngest", "runs-langchain"] }, { source = "/logs/agent/sessions/projects" }]` (the second carries the harness's session files to the leak scan). `.venv` is excluded because a build's `scenarios/graphrag/.venv/bin/python` is a link to an absolute path, and Harbor's tar `data_filter` aborts the whole download on it (`AbsoluteLinkError`): in phase B every `/app` arrived half-copied, `src/` missing, and the verifier graded that. Harbor logs the failure as best-effort and records no exception; `analyze.py` reads `artifacts/manifest.json` and counts a trial whose `/app` failed to collect as infra. Tar's `--exclude` matches the name at any depth; `[environment]` `cpus = 6`, `memory_mb = 6144`, `storage_mb = 10240` on both stacks, from the measured peaks (Gates before any trial)
- keys in a trial:
  - Claude Code: `CLAUDE_CODE_OAUTH_TOKEN` (subscription, from `claude setup-token`), exported on the host with `CLAUDE_FORCE_OAUTH=1` and no `ANTHROPIC_API_KEY`: Harbor's agent reads it from the host environment and prefers an API key when both are set. Measured 2026-11-13: the init event's `apiKeySource` is `none`, and the token is in no file under the job folder. `setup-token` prints the token wrapped over two lines; both lines make the 108-character token (a first line alone fails with `401 OAuth access token is invalid`, recorded as `UnknownApiError`)
  - LangChain, every arm and the verifier: one benchmark-only `LANGSMITH_API_KEY` (free Developer plan) in `/app/.env`, with `LANGSMITH_TRACING=false`. The operator exports it as `CODECLIMB_BENCH_LANGSMITH_API_KEY`, and its region's endpoint as `CODECLIMB_BENCH_LANGSMITH_ENDPOINT` (default the US one; with an EU key and no endpoint the server exits with code 3); Harbor hands the host environment to `docker compose`, the compose files map it to `LANGSMITH_API_KEY` in `main`, and the trial image's entrypoint (`write-env.sh`) or the verifier's `test.sh` writes `/app/.env`. `artifacts` exclude `.env`, so the key reaches no job file (checked 2026-11-12: no file under the job folder holds it) and no image layer. The Agent Server exits without it. The `mcp-docs` lever on LangChain is the `langsmith` MCP, not the key
  - Inngest: none
  - no provider keys: mock nights need none, and app spend stays out of the build cost

### Trial environment

- one Docker daemon per trial: a `docker:27-dind` sidecar (`privileged: true`, `DOCKER_TLS_CERTDIR: ""`) in `environment/docker-compose.yaml`, with `DOCKER_HOST: tcp://127.0.0.1:2375` on `main`, which shares the sidecar's network namespace. The same shape on both stacks
- measured 2026-11-12 with plain `docker compose` (Docker Desktop 29.4.3, arm64) on both reference builds, `capitals-smoke` and `datenorm-smoke` with `--mock`. With `main` in its own network namespace neither build passes both nights: the Inngest relay's host-gateway alias points at the sidecar, where no proxy listens; the LangChain server publishes `127.0.0.1:8123` on the sidecar and bind-mounts an empty `/app` from the sidecar's filesystem
- what makes both pass:
  - `main` has `network_mode: "service:dind"`, so `127.0.0.1` and the Docker bridge are the same on both sides
  - `/app` and `/root/.pi` are named volumes mounted at the same paths in `dind` and `main` (LangChain bind-mounts both into its server container)
  - the `docker compose` and buildx plugins in `main` (`langgraphjs up` needs compose)
  - a healthcheck on `dind` (`docker info`) that `main` waits for: the daemon is not ready in its first seconds
  - Inngest: `CODECLIMB_PROXY_HOST=172.17.0.1`, the sidecar's bridge address, preset by the environment in the trial and in the verifier. The default loopback bind is unreachable from the relay, and a wrong bind address is a property of this environment, not of the stack
- scope of the measurement: nights 1 and 2 only. Nights 3 to 7 were measured later on LangChain, in the verifier's topology through `grade.sh` (see Verifier): night 5's kill and restart of the server container and night 7's graphrag image and `uv` host commands work there. Inngest's nights 3 to 7 are unmeasured
- Harbor accepts the topology (measured 2026-11-12, Harbor 0.25.0, the `topology-check` task with the `oracle` agent: 18 of 18 checks, twice), in the trial container and in the separate verifier container:
  - Harbor respects `network_mode` on its `main` service; `docker run` works from the trial and from the verifier, each on its own sidecar
  - the first Docker call needs no retry. Harbor starts the stack with `up --wait`, and `main` depends on the sidecar being healthy; the probe shows the outcome, the compose file gives the reason
  - the `/app` baked into the image is visible in `main` although `/app` is a named volume the sidecar mounts first, and a container on the sidecar daemon that bind-mounts `/app` reads and writes the same files
  - `artifacts` delivers `/app` to the verifier, where a container on the verifier's own sidecar reads it; `exclude` keeps `node_modules` out
  - a job-level mount into `/app` shows up in the trial, and its files travel to the verifier with the artifact. Its source must be an absolute path: Harbor's compose project directory is the task's `environment/` folder, so a relative source names a folder there, which Docker creates empty and mounts, silently. So mounts are passed on the command line (`--mounts`, built from the repo root), not written in a job file
  - with the blocked hosts on the sidecar service, `curl https://github.com` fails in the trial and in the verifier, while the open web loads and `npm ci` passes in both
  - recorded, not graded: a container on the sidecar daemon still reaches GitHub (the hole below)
- repeat it, $0: `tasks/topology-check/run.sh`
- sizes: the sidecar's volume peaked at 0.9 GB on Inngest and 6.5 GB on LangChain (the server image alone is 2 GB). A cold `npm run server` takes 2 minutes; each mock night 6 to 16 s
- the LangChain server needs `/app` to be a git checkout, so the verifier runs `git init` + one commit on the copy it receives
- a failed metering path does not fail a night: `run-night` still prints `done` and exits 0. Only the `meter.jsonl` check and `decision_reason` show it
- the stack's external services already run when the harness starts, in every arm, in the trial only (the verifier starts its own, fresh). The instruction's "What you have" list names them (`assemble.py` fills it per stack), so the harness uses them rather than starting its own
  - Inngest: the dev server, a service `inngest` in `environment/docker-compose.yaml`: the task image running `inngest-cli dev -u http://localhost:3000/api/inngest --no-discovery` (the command the given `dev:inngest` runs), on the sidecar's network, with a healthcheck `main` waits for. Measured 2026-11-13 with plain `docker compose`: from `main`, `http://127.0.0.1:8288` and the MCP endpoint `/mcp` answer 200
  - LangChain: none. The Agent Server (`npm run server`) runs the build's own graphs, so it is the build, not an external service; its Postgres and Redis come up with it; both MCP servers of the arms are remote. `SERVICES["langchain"]` stays empty
  - why: Claude Code connects to MCP servers once, at start, and does not reconnect (Arms), so `inngest-dev` works only if the dev server is up before `claude` starts. A real developer has these services running when they start a session
- not the host socket: `cc-meter` and `cc-meter-relay` are global names, and `docker ps` checks would see other trials. Fallback: host socket + one trial at a time
- the verifier needs the same daemon: `tests/docker-compose.yaml` holds the same topology for the separate verifier environment. Job-level mounts and `extra_docker_compose` are agent-only. `artifacts` re-upload `/app` to the same path in the verifier, dropping symlinks (fine: it runs `npm ci`). The host fallback (`verifier/run.py --app <artifact dir> --stack <s>` after the job) is not needed on local Docker; it stays for a provider without Docker-in-Docker

### Network: everything except GitHub

- the repo stays public, so the harness never reaches GitHub; it can reach everything else, web search included
- Harbor has only `public`, `allowlist` and `no-network`, no denylist. So `network_mode = "public"` plus 3 layers:
  - the verifier environment blocks the same hosts but one: `api.github.com`, where Pi refreshes a Copilot token (`https://api.github.com/copilot_internal/v2/token`, read in `@earendil-works/pi-ai`'s `dist/auth/oauth/github-copilot.js`). The access token lives about 30 minutes and the `real.*` family runs longer. The harness is gone by then, so nothing it does reaches GitHub
  - DNS: `extra_hosts` on the `dind` service in `environment/docker-compose.yaml` maps each blocked host to `0.0.0.0`; `main` shares its `/etc/hosts` (on `main` itself Docker rejects `extra_hosts` beside the shared network mode). Measured: `curl https://github.com` fails in `main`, `npm ci` passes. No wildcards: every host name needs its own entry. The harness runs as root and could edit `/etc/hosts`; layer 3 catches that
  - harness: Claude Code deny rules `WebFetch(domain:<host>)` for each blocked host and its `*.` subdomains, in the trial's managed settings (`assemble.py` writes them into each task's `environment/managed-settings.json` from `verifier/blocked_hosts.py`; the Dockerfile installs them at `/etc/claude-code/managed-settings.json`). Measured 2026-11-13 in the Inngest trial environment under `bypassPermissions`: `WebFetch` of the repo page, `api.github.com` and `raw.githubusercontent.com` returns `WebFetch denied access to domain:<host>`, while `www.inngest.com/llms.txt` and `docs.langchain.com/llms.txt` load. The LangChain image installs the same file; it was built, not probed
  - detection: the verifier's leak scan (`verifier/leak.py`, run before any stage touches `/app`) looks for a blocked host (any subdomain) or the repo owner (`decoding ai magazine`, with or without `-`, `_` or spaces; `codeclimb` alone is in the contracts) in what the harness did, not in what it read: the given inputs name `github.com` (16 files) and the owner (30 graphrag corpus files) themselves
  - network routes only, for blocked hosts: a build is asked to name GitHub hosts in its own code (the coder sandbox's web block), and npm lockfiles carry `github.com` metadata. On the LangChain reference, a rule that counts every host the build wrote finds 20 hits in 6 files (`src/pi/web.ts` and its tests, 110 lockfile URLs), so a host counts only where it can reach the network. The owner counts anywhere the harness wrote it. It reads:
    - the session files (`/logs/agent/sessions/projects/**/*.jsonl`, subagents included, carried by `artifacts`): blocked hosts in the input of `WebFetch`, `WebSearch`, `Bash` (a `docker run` included; heredoc bodies cut, see below) and any MCP tool, and in `WebSearch` results; the owner in any tool's input (a file written or edited included) and in `WebSearch` results. Not `WebFetch` results: docs pages link GitHub all the time
    - `/app` without `.git`, `node_modules`, `.venv`, caches, the runs folders, `generated/` and `.env`, in each file the harness wrote or changed: the owner anywhere; blocked hosts only in a Dockerfile's `RUN` and `ADD` instructions, `package.json` dependency specs (`github:` included) and `package-lock.json` `resolved` URLs. A given file counts only for names beyond those it held as given: `assemble.py` writes the baseline, each given file's sha256 and these names, to the task's `tests/verifier/given.json`
    - heredocs: a Bash heredoc body is file content, not a command, so the scan cuts it and keeps the command around it (`cat > src/web.ts <<'EOF'` and anything after the closing line). The file it writes is scanned under the `/app` rule. Phase B: all 3 trials wrote the coder's GitHub block (`GH_HOSTS = ["github.com", ...]`) through `cat > <file> <<'EOF'`, so counting heredocs set `leak` = 1 on every trial; with them cut, 0 session hits on all 3
    - accepted gaps: a host in other code the build runs (a script that fetches, a heredoc that writes one) does not count. Both are read by hand when a trial is reported apart
    - the reference builds score `leak` = 1 on the owner (the LangChain one's `AGENTS.md` and tests quote the repo URL): they were written with the repo at hand. The reference gate is on checks, not on `leak`. Measured 2026-11-13 through `grade.sh` on `langchain@2ab1ad3`: 34 of 34, `leak` 1 (2 owner hits), `leak_sessions` 0, `app_scanned` true, 451 s
  - a hit sets `leak` = 1; the trial keeps its `reward` and `checks` and is reported apart, never averaged. `checks.json` lists the hits; `leak_sessions` counts the session files read, so a scan that saw none shows. Tests on fixture sessions: `verifier/leak_test.py`
  - measured 2026-11-13: 0 on the `one-line`, `budget` (it read `SPEC.md` and `package.json`), `big` and `search` probes (a real `WebSearch` result is a `Links: [{title, url}]` string, which the scan reads); 1 on `network` (4 hits). In Harbor, a one-line trial with the verifier on: the sessions artifact reached the separate verifier, `leak` 0, `leak_sessions` 1, `reward` 1/34
- blocked hosts: `github.com`, `githubusercontent.com`, `github.io`, each with every subdomain, plus mirrors and indexers: `deepwiki.com`, `gitmcp.io`, `sourcegraph.com`, `gitee.com`. One list, `verifier/blocked_hosts.py`: the deny rules and the scan are made from it, and a test checks the DNS block in `tasks/shared/dind.compose.yaml` against it (the DNS block names each subdomain it blocks)
- the block costs the builds nothing (measured with a DNS sniffer, cold runs of install, image build, service start and both nights on both stacks): no lookup of a GitHub host. `inngest-cli` downloads from `cli.inngest.com`, uv's Python from `releases.astral.sh`, every lockfile entry from `registry.npmjs.org`. Read from code, not triggered by mock nights: Pi fetches `fd` and `rg` from GitHub releases when its grep and find tools run without them
- the hole: a container started on the sidecar daemon has its own `/etc/hosts` and resolves through 8.8.8.8, so it reaches GitHub (measured: HTTP 200 from `docker run`, from a build step and from the LangChain server container). Layers 1 and 2 do not cover it. Accepted: the harness runs as root, so any network block can be bypassed, and layer 3 decides `leak`. The scan therefore also reads the commands the harness ran and the files it wrote. A DNS sidecar that covers nested containers is added only if a pilot trial uses the hole
- no rename of "codeclimb": the name is in the contracts the checks read (npm scripts, `codeclimb-python`, `cc-<id>`)

### Arms

- an arm = the extra context a harness starts a trial with. Every arm gets the same given inputs, `SPEC.md`, `E2E.md`, `/docs/pi/` and an `/app/AGENTS.md` stub (one canary line, no guidance)
- 2 × 2 design: skills on/off × MCP + docs on/off

| arm | skills | MCP + docs | Inngest | LangChain |
|---|---|---|---|---|
| `bare` | no | no | nothing extra | nothing extra |
| `skills` | yes | no | every skill of the `inngest` plugin | every skill of `langchain-skills` and `langsmith-skills` |
| `mcp-docs` | no | yes | `inngest-dev` MCP (`http://127.0.0.1:8288/mcp`) + docs block with `inngest.com/llms.txt` | `langsmith` MCP (EU) + `langchain-docs` MCP + docs block with `docs.langchain.com/llms.txt` (TypeScript pages) |
| `full` | yes | yes | both | both |

- skills are vendored whole and unedited at a pinned commit: the arm measures the ecosystem as a developer gets it, not our selection
- Harbor fields: skills via `agents[].skills` (verified: a list of skill dirs, which Harbor copies into Claude Code's `$CLAUDE_CONFIG_DIR/skills/`); MCP via `agents[].mcp_servers`; the docs block via `extra_instruction_paths`
- Inngest: `context/inngest/skills/` is the `skills/` folder of `inngest/inngest-claude-code-plugin` at `78607dd41fa07a44829c3039bbd95814ac7f5f9c` (tree sha256 `8ca4655d…aedb10f`, in `context/inngest/SOURCE.md`): 14 skill dirs plus `references/`. The job files list the 14; `references/` cannot go in, because Harbor rejects a skill dir without `SKILL.md`, and a skill root that holds one (read from `harbor/skills.py`). So the `../references/expressions.md` links in `inngest-events`, `inngest-durable-functions` and `inngest-steps` dangle in a trial. Accepted: one page on expression syntax, also in the docs
- plugins: marketplace entries in `.claude/settings.json` are unpinned and fetched at run time from GitHub, which is blocked. So their skills are vendored as dirs, and the job lock file records name, `digest`, `git_commit_id`
- why MCP and docs are coupled: on Inngest one server serves both platform and docs tools
- effects, within a stack: skills = mean of (`skills` − `bare`, `full` − `mcp-docs`); MCP + docs = mean of (`mcp-docs` − `bare`, `full` − `skills`); interaction = (`full` − `mcp-docs`) − (`skills` − `bare`)
- `inngest-dev` is served by the dev server, so it runs before the harness starts (Trial environment). Measured (#48 smoke, `mcp-docs` and `full`, with the dev server started by the harness): Claude Code connects once at start, gets ECONNREFUSED, marks the server `failed` and does not reconnect after the dev server answers on 8288; a tool search for "inngest" finds nothing. Record MCP tool calls per trial, split platform vs docs tools; 0 calls = the lever was never used
- Inngest arm smoke (#48, 2026-11-13, `job-configs/probes/arm-smoke.sh inngest <arm>...`: the arm's job file with one attempt, no verifier and the stack's probe prompt, `arm-smoke-<stack>.md`; about $0.07–0.10 each): `bare` has 17 built-in skills, no MCP server, no extra prompt; `skills` has the 14 Inngest skills in `$CLAUDE_CONFIG_DIR/skills/` and the skills pointer in the prompt, no MCP; `mcp-docs` has `inngest-dev` registered and the docs block in the prompt, no Inngest skills; `full` has both. With the dev server pre-started, `mcp-docs` reports `inngest-dev` `connected` with 52 tools and called `get_apps` (37 s trial); `full` the same, with the 14 skills, the skills pointer and the docs block (38 s, $0.09)
- LangChain: `context/langchain/skills/<pack>/` is the `config/skills/` folder of each pack the `langchain-plugins` marketplace serves, at the commits a Claude Code install from it recorded on 2026-11-11 (the marketplace's `ref` is `main`), in `context/langchain/SOURCE.md`: `langchain-ai/langchain-skills@126c384d8552dcb476b226c244172186cc3f4328` (22 skills, tree sha256 `9d288e55…f4382226f`) and `langchain-ai/langsmith-skills@449c4e6af468997c1efb928046513736d8db448d` (6 skills, `0c5c920d…f1e56a51c`). Every child dir holds a `SKILL.md`, so each pack is one `skills` entry, a skill root Harbor expands
- LangChain MCP servers, both `streamable-http`, as the marketplace's `langchain-mcp` and `langsmith-mcp` plugins name them: `langchain-docs` at `https://docs.langchain.com/mcp` (no auth; tools `search_docs_by_lang_chain`, `query_docs_filesystem_docs_by_lang_chain`, `submit_feedback`, listed 2026-11-13) and `langsmith` at `https://eu.api.smith.langchain.com/mcp`. The plugin's `langsmith` server uses OAuth, which no one completes in a headless trial; measured 2026-11-13: the EU endpoint answers `initialize` with 200 to the benchmark key as `X-API-Key` (401 as `LANGSMITH-API-KEY` or a bearer token, 401 without a key; the US endpoint gives 403 to the EU key). So the job file sets `headers: { X-API-Key: "${CODECLIMB_BENCH_LANGSMITH_API_KEY}" }`: Harbor resolves it on the host, hands it to Claude Code through a generated exec-env variable, writes only `${MCP_AUTH_…}` into `.claude.json` and scrubs the value from trial output (read from `harbor/agents/mcp_headers.py` and `claude_code.py`). The plugin's `langchain-reference` server is not in the arm (the table names `langchain-docs` only)
- LangChain arm smoke (#49, 2026-11-13, `CODECLIMB_BENCH_LANGSMITH_API_KEY` exported; 33–42 s and $0.06–0.15 each, $0.41 in all): `bare` has 17 built-in skills, no MCP server, no extra prompt; `skills` has the 28 pack skills (45 in all) and the skills pointer, no MCP; `mcp-docs` has `langchain-docs` and `langsmith` both `connected` (3 + 77 tools) and the docs block, no pack skills; `full` has both. In `mcp-docs` and `full` the model called `search_docs_by_lang_chain`, then `list_workspaces` and `list_projects` (counts: 1 docs, 2 platform). `/app/.env` holds the key in every arm; the key's value is in no file under any of the four job folders
- the benchmark key's LangSmith workspace is not empty: `list_projects` returned `codeclimb` and `codeclimb-step0`, the operator's earlier projects. A harness in `mcp-docs` or `full` can read them `(guess: harmless, they hold no code; a fresh workspace removes the question)`
- docs blocks: Inngest 66 words, LangChain 57, the same shape (a heading, the docs index, the TypeScript pages or reference, one line per MCP server)
- lever counts: `analyze.py counts <trajectory.json>` counts from a trajectory's tool calls: `Skill` calls; MCP calls, split into docs tools (`inngest-dev`'s `grep_docs`, `list_docs`, `read_doc`; every tool of `langchain-docs`) and platform tools (every other); `WebFetch`, `WebSearch`, and Bash `curl`/`wget` of a non-local URL (doc fetches). Tests: `python3 -m unittest analyze_test`
- measured (#48 smoke, 2 trials): after the final reply, `claude --print` does not return while a `run_in_background` Bash task still runs. It returned about 10 min later, when Claude Code stopped the task at its background time limit, so a 1-minute probe took 10.6 min. So a trial that leaves `npm run worker` running gains about 10 min of idle agent wall-clock. `(guess: a background task is also stopped about 10 min after it starts while the session is still working)`
- measured 2026-11-13 with plain `docker compose`: a second `npm run dev:inngest` beside the pre-started one does not fail. It logs "Port conflict, using new port" and serves on 8290, while the worker still talks to 8288. So Inngest's `E2E.md` starts the dev server only if nothing answers on 8288
- the trajectory holds subagent calls: Harbor merges `<session>/subagents/*.jsonl` into `trajectory.json` as sidechain steps (read from `harbor/agents/installed/claude_code.py`, no smoke trial spawned one), so the counts cover them
- the docs block: stack doc links + the MCP pointers, the same shape and length ±20% on both stacks. Not the repos' `AGENTS.md`: both hold "ask the user" and "never run `npm test`" rules, which hurt a zero-human run
- each arm carries its own pointer: the line naming the skills ships with `skills`, the MCP tools and docs with `mcp-docs`. The build specs name neither
- `bare` is not docs-free: the open web is reachable in every arm. Record doc fetches per trial
- compare an arm's Δ within a stack, never across: the levers differ in kind
- `mattpocock-skills`: in no context arm (not ecosystem context); they are the `pocock` workflow
- LangSmith is part of the LangChain arms, so it measures nothing here: no `--plugin langsmith`. Harbor job dirs are the source of truth

### Workflow

- second question: does working build ticket by build ticket beat one long session on the same build spec? Run on `full` only
- `one-shot` (default, every arm): the harness builds from `SPEC.md` however it likes. It never sees the build tickets
- `pocock`: `full` + `SPEC.md` + the stack's pile of build tickets + Matt Pocock's skills (`mattpocock-skills` 1.3.1, vendored), driven by the prompt template
  - the pile is `specs/<stack>/tickets/`, frozen: written before the runs by Paul with an agent, never by the trial. The same pile in every trial removes decomposition noise
  - every build ticket in a pile is `ready-for-agent`: nothing waits on a human, and no pile holds a paid-night ticket
  - the assemble step rewrites the spec path inside each ticket to `SPEC.md` and changes nothing else. The pile's sha256 is logged per trial
  - the trial: `/implement` per build ticket, frontier first (any ticket whose blockers are done), until all are done; then run `E2E.md`
  - model-invocable skills on demand: `tdd`, `code-review`, `diagnosing-bugs`, `research`, `domain-modeling`, `codebase-design`, `prototype`
  - not loaded: `to-tickets` (the pile exists), `grilling` (asks the user), `pr` (GitHub), `wizard` (walks a human), `triage`, the setup skills
  - why not `/to-spec` or `/implement-spec`: the spec exists, and `/implement-spec`'s parallel worktree subagents would add a third variable (concurrency)
- zero-human patches, in the prompt template, not in the skills:
  - `/code-review` asks for a fixed point: use `/app`'s root commit
  - tickets are local files, never GitHub or another tracker. The setup skill's output is pre-written (`context/pocock/scaffold/`): `docs/agents/issue-tracker.md` (local markdown, `.scratch/codeclimb/issues/<NN>-<slug>.md`, the spec is `SPEC.md`, the tickets' own path after the rewrite, not the template's `.scratch/codeclimb/spec.md`), `docs/agents/domain.md` (single-context, the template unchanged), and an `## Agent skills` block appended to the `AGENTS.md` stub. No `triage-labels.md`
  - how they reach `/app`: `assemble.py` stages the rewritten pile and the scaffold in `tasks/codeclimb-<stack>/pocock/` (gitignored, `pocock_files_sha256` in `assembled.json`), and a job compose overlay, `job-configs/pocock.compose.yaml` (`environment.extra_docker_compose`), runs a one-shot service `pocock-files` on the task image that copies them into the trial's own `app` volume; `main` waits for it to complete. Not `--mounts`: a job mount is one bind of a host dir shared by every trial of the job, so a writable one carries attempt 1's `Status: done` into attempt 2, and a read-only one stops the harness closing tickets. The overlay's host path is absolute, from `CODECLIMB_POCOCK_DIR`, which `job-configs/pocock.sh` sets. Measured 2026-11-13: with plain `docker compose` on both stacks and in Harbor (`nop`, Inngest), `/app` holds the files with the one `given inputs` commit, a ticket edit in `main` leaves the host copy unchanged, `up --wait` accepts the one-shot service, and the `/app` artifact carries `.scratch/`
  - the template defines the closed state: a ticket is done when its acceptance criteria pass; the harness then sets its `**Status:**` line to `done` and commits the work with the ticket file
- invocation (verified with a `disable-model-invocation: true` dummy skill): a user-only skill runs only from the prompt template's first line, never from the model. `/implement` is called once per ticket by the model, so the vendored copy drops `disable-model-invocation`
- vendored: `context/pocock/skills/`, the eight skill dirs above from `mattpocock/skills@49dd158d1076134a641b33efb035946536778336` (1.3.1, the commit a Claude Code install recorded; byte-identical to its cache), tree sha256 `bcf4331f…afc835962b` upstream and `6ca5eeb0…bb36397f64` after the one edit (`context/pocock/SOURCE.md`)
- name clash: Claude Code 2.1.322 ships a built-in `code-review` skill (in every arm's init list), the same name as the pocock one. Measured in the smoke trial: the init list holds one `code-review`, and `Skill("code-review")` ran the pocock one (its Standards and Spec subagents), so the vendored skill wins
- measured 2026-11-13, Inngest smoke on the dummy pile (`jobs/smoke-pocock-inngest-133359`, 1 min 44 s, $0.61, 19 turns, cap $3 not hit): ticket 01 from the template's first line, then `Skill("implement")` on 02 (its blocker done); both set to `**Status:** done`, one commit per ticket (`01: A greet function`, `02: A farewell function`, each with its ticket file); one `code-review` from the root commit after 02, with its 2 subagents; no `tdd` call; no `gh` call; then the harness ran `E2E.md`, found nothing built and stopped. `analyze.py`: `workflow_skills` `{implement: 1, code-review: 1}` (the first ticket's `/implement` comes from the template, not a Skill call, so `implement` calls = tickets − 1), pile `{tickets: 2, tickets_done: 2, commits: 2}`
- the prompt template's first line is `/implement …`, so Claude Code loads `implement` for the first ticket; the model calls it for each next ticket. Counts: `analyze.py counts` reports workflow skill calls per name (`workflow_skills`), apart from the skills lever; `analyze.py pile <app artifact>` reports tickets, tickets done and commits after the given commit
- smoke trial: `job-configs/probes/pocock-smoke.sh <stack> [cap]`, the `full-pocock` job file on the two-ticket dummy pile `job-configs/probes/pocock-pile/` (02 blocked by 01), one attempt, no verifier, a budget cap and a 30-minute agent timeout
- logged on top of the metrics: pile sha256, ticket count, tickets done, commits, `tdd` / `code-review` calls, compactions, $ and tokens per subagent (`code-review` runs 2 in parallel)
- result: Δ`reward`, Δ`done`, Δ$ and Δwall-clock of `full × pocock` vs `full × one-shot`, per stack. The tickets and the per-ticket loop are not separated

### Verifier

- the checks are identical on both stacks: the seven mock nights of "Goal and done signal", which is the same list in both build specs. $0, no provider credentials
- `reward` = checks passed / N, a fraction in [0, 1]; equal weights; no `solution/solve.sh`. N is fixed when both reference builds pass, and is the same number on both stacks
- the checks, each counted once:
  - 5 build checks, in build order, so a half-built app scores above empty given inputs: `install` (`npm ci --ignore-scripts` exits 0), `typecheck`, `unit-tests` (`npm test`), `image` (`build:image` gives `codeclimb-python`), `services-up` (the stack's services answer within 60 s)
  - `build:image` runs before `npm test`, while the checks keep this order: both build specs promise that `docker images` lists `codeclimb-python`, so a build's tests may start a sandbox. Found in phase D2 (2026-11-14): both `pocock` builds had tests that start `codeclimb-python` sandboxes, and with `npm test` first, in the verifier's fresh daemon, they failed with "Unable to find image 'codeclimb-python:latest' locally"
  - night checks: one per row of the done signal's check tables. A row of the first table passes only if it holds in every night it applies to (nights 1, 2, 3 and 6, and the rows night 7 carries over); each added row of nights 3 to 6 and each row of night 7's own table counts once
- `done` = 1 if every check passes: secondary, reported beside `reward`
- the harness sees these checks (they are its done signal), so the verifier reruns them itself on a clean copy: separate verifier container, the build arrives through `artifacts` only, `npm ci --ignore-scripts`, rebuild images, start services, empty results directory. Results the harness left behind count for nothing
- one suite for both stacks, written against stack-neutral outputs (CLI, `results.jsonl`, `nights/<id>/`, `experiments.git`). An adapter per stack holds only: start services, stop services, service logs, crash the runtime (night 5: kill the worker, or kill the server container), and the runs folder name
- the first table's rows, as `checks.<row>` (one per row, counted) and `checks.night<n>.<row>` (per night, reported, not counted): `cli-done`, `end-files`, `validate-results`, `row-per-experiment`, `mock-commit`, `code-state`, `reviews`, `send-backs`, `notes`, `decision-reason`, `keep-rule` (`datenorm-smoke` and `capitals-smoke` nights only), `spend-zero`, `meter` (`capitals-smoke` only), `no-leftover-sandbox`. Night 7 carries `cli-done`, `end-files`, `validate-results`, `mock-commit`, `code-state`, `reviews`, `decision-reason`, `spend-zero` and `no-leftover-sandbox` into them
- the added rows, one each: `plateau-stop` (night 3), `hard-stop` (night 4: stopped once round 1 has started, with a following `run-night` that must print `stopped`), `crash-resume` (night 5: the adapter kills the runtime once `exps/<id>-r2-e0/` exists and starts it again; a night that ends before the kill lands runs again under a new id, up to 3 tries; the row fails if the adapter killed nothing), `lost-connection` (night 6)
- night 5's "only the step running at the kill reruns, on a new sandbox of the same name" is not checked: only the LangChain done signal has it, and the suite is the same on both stacks
- night 7's own rows, one each: `graphrag-rows`, `graphrag-sessions`, `graphrag-notes`, `graphrag-check-json`, `graphrag-extraction-inputs`, `graphrag-test-stages`, `graphrag-metrics-json`, `graphrag-stage-metrics`, `graphrag-meter`, `graphrag-noise`, `graphrag-lessons`. The verifier builds `codeclimb-graphrag` first; if it does not build, night 7 does not run and its rows fail
- N = 34: 5 build checks + 14 first-table rows + 4 added rows + 11 night-7 rows. The list is `CHECKS` in `verifier/run.py`; every run records all 34. Code: `verifier/nights.py`, unit tests `verifier/nights_test.py`
- if `services-up` fails, no night runs and every night check fails at once: the floor run stays short
- a check that raises fails with its traceback; a stage that crashes fails every check it had not recorded, with the traceback, and reports `checks.<stage>-crashed` = 0 (not counted, so N stays 34); `reward.json` is always written. Every command runs in its own process group, killed whole on a timeout
- grading inside Harbor: `job-configs/reference.sh <stack> [commit]` grades a reference build in Harbor's separate verifier environment, the place trials are graded. It exports the commit with `git archive` to `jobs/` (gitignored, never committed) and runs the `nop` agent with a job overlay, `job-configs/reference.compose.yaml`: a one-shot service fills the trial's `/app` volume with the build, so `artifacts` carries it to the verifier the way it carries a harness's build. The overlay also creates the empty `/logs/agent/sessions/projects` a harness leaves; without it that artifact fails to collect and Harbor refuses to regrade the trial ("collection failed in the source trial")
- measured 2026-11-13, inside Harbor: `main@4a71177` 34 of 34 (verifier 419 s and 426 s; trial 7m 54s), `langchain@2ab1ad3` 34 of 34 (verifier 414 s; trial 7m 47s). Every `checks.*` key equals the host run's. `leak` = 1 on both, as on the host (the reference builds quote the owner)
- regrade: `harbor job regrade <job dir> -p tasks/codeclimb-<stack>` reruns the separate verifier on the recorded `artifacts` with no new trial. Measured 2026-11-13 on the Inngest reference job: every key of `reward.json` equals the source trial's (34 of 34), verifier 436 s
- the host fallback, `grade.sh`, stays for grading a build without a Harbor job (the reference gate's 3 runs); Harbor's verifier environment runs all seven nights, so trials are graded there
- grading from the host: `verifier/grade.sh <build dir> <stack> [<out dir>]` runs the verifier image and topology of `tasks/codeclimb-<stack>/tests/` with plain `docker compose`, the build copied into its `/app` volume, so a host run gets its own daemon and never meets another stack's `cc-meter` or `:8123` on the host
- measured 2026-11-12, `langchain@2ab1ad3` (the branch head, with `results_path` relative to the runs folder) through `grade.sh`: the 5 build checks and the 14 first-table rows all pass, in 225 s
- measured 2026-11-12, same build, all seven nights through `grade.sh`: 34 of 34, `done` = 1, three runs in a row; the verifier's wall-clock 408 s, 392 s, 392 s (nights 1 to 7 take about 6, 11, 6, 6, 130, 41 and 34 s; night 5 waits for the runs sweeper). Night 5 killed the server container once round 2 had started; only round 2's and the test's sandboxes were created after the kill
- measured 2026-11-13, `main@4a71177` through `grade.sh`: 34 of 34, `done` = 1, three runs in a row; the verifier's wall-clock 468 s, 434 s, 446 s (nights 1 to 7 take about 11, 11, 11, 6, 170, 46 and 112 s). Night 5 killed the worker's process group only (the dev server kept running) once round 2 had started; only round 2's and the test's sandboxes were created after the kill. Same N as LangChain: the Inngest adapter adds no check
- a broken metering path (the relay pointed at a host that does not exist) fails `meter` with 0 calls while `cli-done` passes: `run-night` still prints `done`. The failed evaluations also start repair `e1` experiments, so `send-backs` and `notes` fail with it (measured 2026-11-12, same build)
- a negative check counts only with its positive one ("no `cc-<id>` container" counts only if `done.json` exists)
- regrade (`source_jobs`) works after a verifier fix, with no new trials
- `/logs/verifier/reward.json`:

| key | what |
|---|---|
| `reward` | checks passed / N. The comparison metric |
| `done` | 1 if every check passes, else 0 |
| `checks.<name>` | each check's pass (1) or fail (0), night checks per night: shows where a build broke. Harbor accepts only flat numbers in `reward.json`, so each check is its own key; `checks.json` beside it holds each check's output tail and the verifier's wall-clock |
| `leak` | 1 if the harness touched a blocked host or the repo owner: trial reported apart |
| `leak_sessions` | session files the leak scan read: 0 means it saw no trajectory |

- `hidden.<test>` and `real.<test>`: the two families of "Hidden and real checks", 1 or 0 each, beside the reward and never in it. A test that did not run has no key

### Hidden and real checks

- why: bare trials on both stacks score 34 of 34, so the reward, which is the harness's own done signal, does not separate arms. These families test what the build spec states but `E2E.md` never runs, as outcomes only: no build spec names a function, a step, a thread or a retry count, and none is added. The harness never sees them
- `hidden.*`: mock nights and probes, $0, no credential. `real.*`: small real-model nights on the operator's Copilot login. Both stand beside the reward: `reward` and N = 34 are unchanged
- reported by `analyze.py` beside the reward: per cell of counted trials, each trial's share of the `hidden.*` and `real.*` tests that ran for it (all, then per family) and each test some trial failed with its pass count. A trial graded before the families has no keys and is counted apart; `harbor job regrade` adds them. Measured 2026-11-15 on the e1 bare trials, regraded: Inngest 44 of 46 (`hidden.continue`, `real.meter-costs` fail), LangChain 44 of 46 (`hidden.starter-deterministic`, `real.meter-costs`); `meter-costs` now reports no key on such a night
- order inside a verifier run, after the 34: hidden tier 1, tier 2, tier 3a, real, tier 3b, tier 4. `reward.json` is written after the 34 and again after each family, so a hang or the verifier timeout never costs the reward. The services are checked before each family and started again if they are down
- configs: each test that needs one writes a copy of a given config with the named fields changed, at grade time, under the clean copy's `configs/verifier/`. The harness never sees them
- selection: `CODECLIMB_VERIFIER_FAMILIES` (`basic`, `hidden`, `real`, comma-separated; default all). `real` is skipped, with no keys, when no Copilot credential is set. `CODECLIMB_VERIFIER_ONLY` (test names, comma-separated) runs only those tests. Without `basic` the nights of the 34 don't run: `reward.json` then has `partial` = 1 and `done` = 0, for development only, never a reward
- a test passes on a trial only once both reference builds pass it; until then it is reported and not used. The reference results decide which tests are kept
- code: `verifier/families.py` (runner and helpers), `verifier/hidden_tests.py`, `verifier/durability_tests.py`, `verifier/platform_tests.py`, `verifier/real_tests.py`; the adapters add the hooks durability needs

Hidden tier 1: the files the seven nights wrote, and quick commands (about 20 s):

1. `row-identity`: every row's ids follow the build spec's id table; `stack` and `backend` hold the stack and `docker`
2. `checkpoint-lineage`: every `refs/exp/<night>-r<N>-e<n>` commit has exactly one parent (the starter is a root commit); night 2's `r2-e0` parent is the kept `r1-e0` commit
3. `weighted-score`: each scored experiment's `score` equals the weighted mean of `min(max(value, 0) / threshold, 1)` over the config's thresholds
4. `starter-deterministic`: nights 2, 4, 5 and 6 start from the same starter SHA
5. `rejected-diff`: every round that kept nothing has `bundle/history/r<N>.diff`
6. `done-json-contract`: `done.json` holds its fields; `kept.commit` equals its `refs/exp/<kept.exp_id>`; `test_metrics` equals the test row's `metrics`; one `test` row; with nothing kept the test row's commit is the starter
7. `sandbox-size`: a short mock night of its own; every `cc-` container has 2 vCPU and 2 GiB (`docker inspect`)
8. `validator-fixtures`: `validate-results` rejects a row with a bad `decision`, a bad `kind`, non-object `metrics`, a non-JSON line; accepts the build's own file
9. `stop-after-done`: `stop` on a finished night exits 0, writes no `stop.json`, leaves `done.json` unchanged
10. `config-rejects`: `reviewer_model` equal to `model` with equal thinking, `deadline: soon`, a `results_path` with `..`, a `budget_usd.experiment` (0.6) above `budget_usd.night` (0.5, change C6): each exits non-zero and creates no night folder; a night one of them starts anyway is stopped

Hidden tier 2: short mock nights (about 3 min):

11. `missing-gate`: a gate on a metric that does not exist: `r1-e0` reverts, no noise row, the test row's commit is the starter
12. `stop-thresholds`: `datenorm-smoke` with a threshold the starter's code meets: `stop_reason` `thresholds` after one experiment, one test row
13. `rounds-override-order`: `e2e/plateau.yaml --rounds 1`: `stop_reason` `max_rounds`
14. `plateau-never`: `e2e/budget.yaml` under `--mock`: all 6 rounds run, `stop_reason` `max_rounds`
15. `mock-offline-count`: `--mock-offline 3`: exactly 3 assistant messages with stop reason `error` in `r1-e0`'s session, none in `r2-e0`'s
16. `proxy-refuses-model`: `capitals-smoke` with `allowed_models` not holding the program's model: every meter line has `ok: false` and `error`, nothing is kept, the night ends `done`
17. `used-night-id`: a start with a finished night's id, and with a running one's: no new row, `done.json` unchanged, one create of `cc-<id>-r1-e0`
18. `continue`: `run-night continue --config <yaml> --night <id> --rounds 1` on a finished mock night: `r3-e0` and a second test row; every `eval_id` once
19. `seed`: `--seed <night 2 id> --rounds 1`: `r1-e0.parent_id` is `<id>-r0-seed`, its commit's parent is night 2's kept commit

Hidden tier 3a: durability, quick (about 1.5 min):

20. `stop-during-eval`: stop once round 1's evaluation sandbox exists: night 4's conditions, then 30 s with no new row and no new `cc-<id>` container
21. `eval-sandbox-lost`: `docker rm -f` round 1's evaluation sandbox once: the night ends `done`, `r1-e0` has one row, no `stop.json`
22. `server-rerun-mid-night` (LangChain): `npm run server` again mid-night: the night ends `done`, every `eval_id` once

Hidden tier 3b: durability with a crash (about 3 min each, 20 per stack):

23. `crash-mid-eval`: kill the runtime during round 1's evaluation: night 5's conditions, counted from that kill, except that round 1's evaluation may rerun on a sandbox of the same name; only a new create of round 1's coder sandbox `cc-<id>-r1-e0` fails
24. `crash-during-test-eval`: kill during the test evaluation: one test row; no coder or review of rounds 1 and 2 runs again
25. `graceful-restart`: night 5 with SIGTERM (Inngest: the worker group; LangChain: `docker stop` of the server container): night 5's conditions and no `stop.json`
26. `crash-at-init`: kill as soon as `run-night --no-wait` returns: `done.json`, every `eval_id` once, one create of `cc-<id>-r1-e0`
27. `session-reopen-after-kill` (Inngest): kill mid-session: no second create of `cc-<id>-r1-e0`; the session before the kill is a prefix of the final one
28. `lost-sandbox-fresh-restart` (Inngest): kill, `docker rm -f cc-<id>-r1-e0`, restart: exactly one new create of it, one `r1-e0` row with the starter as its commit's only parent
29. `double-kill` (Inngest): night 5, then a second kill once the resumed session grows: night 5's conditions
30. `server-stop-keeps-state` (LangChain): after a finished night, `server:stop` then `server`: every thread is still listed (`POST /threads/search`), the used id starts nothing, a fresh mock night ends `done`
31. `crash-with-watchdog` (LangChain): night 5 with `npm run api` running: night 5's conditions and no `stop.json`

The stack-only tests come 3 and 3, so both stacks report the same count.

Hidden platform tests (`verifier/platform_tests.py`): runtime behaviour the stacks' skills and docs teach and the build spec relies on, so a bare build is the likeliest to miss it (proposed 2026-11-16 from a map of each stack's skills and MCP servers against its build spec). Mock nights, $0, both stacks. Tier 3a holds 50 to 52, 54 and 59, tier 3b 55 and 58; tier 4 runs last, after 3b, and restarts the services with test hooks appended to `.env`, then restores `.env` and restarts them again:

50. `continue-after-stop`: stop once round 1 has its row, then `continue --rounds 1`: exit 0 and `done` printed, `done.json`, no `stop.json`, a new experiment row, one test row, every `eval_id` once, no `cc-<id>` container
51. `outside-cancel`: once round 1's coder sandbox exists, cancel every active run through the platform's own API (Inngest: `DELETE /v1/runs/<id>` on the dev server for each running or queued run `GET /api/v2/runs` lists; LangChain: `POST /threads/<t>/runs/<r>/cancel` for each running or pending run of each busy thread). The adapter knows no function, graph or event name of the build. Within 60 s: `stop.json` with a reason other than `manual` and no `cc-<id>` container; no `done.json`, no test row
52. `fail-at-init`: a scenario copy whose `bundle` command is `exit 1`, so the night fails in init, before `night.json`: the following `run-night` prints `stopped` and exits 0 within a mock night's 300 s; `stop.json`, no `done.json`, no `cc-<id>` container
53. `backstop-mid-step` (tier 4): `CODECLIMB_BACKSTOP_S=30` and a scenario copy whose stage runs `sleep 300` first: within 90 s of the start `stop.json` and no `cc-<id>` container; no `done.json`, no test row
54. `eval-keeps-failing`: for 120 s, `docker rm -f` every round-1 evaluation sandbox as it appears: `done.json` within 300 s after, no `stop.json`, one `r1-e0` experiment row, at most one `r1-e1`
55. `kill-after-row`: kill the runtime as soon as round 1's row lands (the delay is reported, not graded), restart; twice over: night 5's conditions, `reviews/r1.json` unchanged if it existed at the kill, no round-1 coder or evaluation sandbox created after the kill
56. `pause-timeout` (tier 4): `CODECLIMB_MOCK_CREDIT=coder:1` and `CODECLIMB_PAUSE_TIMEOUT_S=60`, no resume: `pause.json` with no `cc-<id>` container within 60 s, then within the timeout plus 60 s `stop.json` and no `cc-<id>` container; no `done.json`
57. `pause-resume` (tier 4): `CODECLIMB_MOCK_CREDIT=coder:1`: `pause.json` with no `cc-<id>` container, then `run-night resume`: exit 0, `done.json` within 300 s, no `pause.json`, one line in `pauses.jsonl`, every `eval_id` once, no `stop.json`
58. `stop-then-crash`: once round 1 started, send a stop and kill the runtime 0.5 s later; after the restart send the stop again, as an operator would, if the first stop command exited non-zero or no `stop.json` exists. Within a crash's 480 s of the restart: `stop.json`, no `cc-<id>` container, no `done.json`. Rows in the 30 s after are reported, not graded: the LangChain reference wrote one there (its resumed night's next sandbox was refused, an `error` row); test 20 grades rows after a stop without a crash
59. `hard-deadline-mid-step` (change C7): 53's slow-stage night with `hard_deadline: 30s` in the config instead of the hook: `stop.json` with `reason` `hard_deadline` no earlier than 25 s, after round 1's evaluation sandbox was created; within 90 s of the start no `cc-<id>` container; no `done.json`, no test row

Build spec lines these rest on, added 2026-11-16 with the operator's approval: an ended night is one with a `done.json` or a `stop.json`, continued from its kept commit or its round-0 commit (50, both specs); a cancel from outside is a hard stop (51, Inngest; LangChain already said so); `CODECLIMB_MOCK_CREDIT=<who>:<n>`, the mock credit error as an environment hook (56, 57, both specs; LangChain's had no way in). The bounds reuse numbers both specs state: a following `run-night` exits within 60 s of a stop, a mock night within 300 s. Added 2026-11-17 with the operator's approval, for changes C7 and C6 (Maintenance tasks), one line each, the same in both specs: the `hard_deadline` config key, a hard stop even mid-step with `stop.json` `reason` `hard_deadline` (59); `budget_usd.experiment` above `budget_usd.night` refused at load (10). The pins have neither, so they fail 10 and 59 by design.

- measured 2026-11-16 through `grade.sh` (`hidden` only, the nine tests), on the references with the patches below, uncommitted: all 9 pass on both stacks, Inngest in 11 min, LangChain in 16 min. A second run of 53, 56 and 58 with the not-early bounds: all pass on Inngest; on LangChain 53 and 56 pass and 58 fails, a coder sandbox `cc-<id>-r1-e0` still there 480 s after the restart, so the LangChain reference passed 58 in 6 runs of 7. Diagnosed with server logs: in every run its `run-night stop` wrote `stop.json`, then crashed starting the stop graph on the downed server, and was not sent again since `stop.json` existed; the stop graph never ran, and only the resumed night's own teardown removed the round's sandbox, except once (cause (guess): the kill landed while the coder sandbox was being created, so the resumed run held no handle to it). Since then 58 sends the stop again when the first stop command failed: LangChain 4 of 4 (first stop exit 1 every time, clean 2 to 3 s after the restart, no row after the stop), Inngest 1 of 1 (first stop exit 0, not sent again)
- the pinned references, same day, all nine: Inngest (`0c395fd`) fails 52 (`run-night` still running at 300 s, no `stop.json`), 53 (no `stop.json` within 90 s, the evaluation sandbox left), 56 and 57 (the night never paused); LangChain (`2ab1ad3`) fails 53, 56 and 57 the same way and passes 52. Causes (guess): Inngest wrote `stop.json` only beside a `night.json`; neither read the timing hooks; Inngest had no credit hook and LangChain's had no way in
- the reference patches: Inngest reads `CODECLIMB_BACKSTOP_S` and `CODECLIMB_PAUSE_TIMEOUT_S`, writes `stop.json` for a night still in init, and gains the credit hook; LangChain reads both timing hooks and passes `CODECLIMB_MOCK_CREDIT` into its `mock_credit` start input
- on the e1 bare trials (2026-11-14), on 52 to 55 and 58 only (50, 51, 56, 57 rest on spec lines those builds never had): Inngest 4 of 5, failing 52 (`run-night` still waiting at 300 s, no `stop.json`; cause (guess): the night function retries a failed init 10 times); LangChain 4 of 5, failing 53 (no `stop.json` by 90 s, the evaluation sandbox still running; cause (guess): its backstop is checked between rounds only)

`real.*`: seven small real nights, each a copy of a given config with only its size changed, `overfit` as given (measured about $0.31 to $0.38 and 21 min per run):

| night | config | cap |
|---|---|---|
| R1 climb | `e2e/overfit.yaml` as given, after `build:scenario:overfit` | 4 rounds, $0.50 |
| R2 loop | `datenorm-smoke`, `experiment_min: 4`, `eval_min: 2` | 2 rounds, $0.50 |
| R3 metered | `capitals-smoke`, `experiment_min: 4` | 1 round, $0.50 |
| R4 budget | `e2e/budget.yaml` as given | $0.05 |
| R5 deadline | `datenorm-smoke`, `deadline: 3m`, `max_rounds: 5`, `plateau_rounds: 0`, `experiment_min: 2` | $0.50 |
| R6 tokens | `datenorm-smoke`, `max_tokens` about one round's, `max_rounds: 5`, `plateau_rounds: 0` | $0.50 |
| R7 stop | `datenorm-smoke --no-wait`, stopped 60 s into the coder | $0.50 |

No night lowers `budget_usd.night` below the config's $0.50: both build specs make the budget stop reserve room for one more round, and a build may reserve the whole `budget_usd.experiment` ($0.20 datenorm, $0.25 capitals). At lower caps such a build stopped R2 after round 1, R3 and R7 before round 1, and R5 and R6 on `budget` (the e1 bare trials, 2026-11-15). Spend stays bounded by `max_rounds` and the deadline

32. `overfit-thresholds` (R1): `stop_reason` `thresholds` within 4 rounds
33. `overfit-test-equals-dev` (R1): the test row's accuracy equals the kept row's dev accuracy
34. `overfit-lineage` (R1): the kept commits form one chain from the starter, each kept score above the last
35. `budget` (R4): `stop_reason` `budget`, stopped between rounds: the last round has its row and its review, no later round started, no `stop.json`, one test row. Spend over the cap is not graded: both build specs check the stop between rounds only
36. `deadline` (R5): `stop_reason` `deadline`, stopped between rounds as in 35
37. `tokens` (R6): `stop_reason` `tokens`
38. `stop-halts-spend` (R7): within 60 s of the stop no new meter line, no session growth, no `cc-<id>` container; `stop.json` `manual`, no test row
39. `hypothesis-handoff` (R2): `reviews/r1.json` has a non-empty `hypothesis`; it is `r2-e0`'s row `hypothesis`, its commit message's text and in its coder's first prompt
40. `history-in-bundle` (R2): `bundle/history/notes/r1-e0.md` holds a coder part and the reviewer's verdict, and `history/r1.diff` exists if round 1 kept nothing, both before `cc-<id>-r2-e0` is created
41. `feedback-reaches-coder` (R2): round 1's `feedback` is in round 2's coder prompt
42. `reviewer-model` (R2): each review's `model` is the config's `reviewer_model`
43. `keep-consistency` (R2, R3): every keep or revert matches the weighted score against the checkpoint's plus the noise margin
44. `coder-sandbox-clean` (R1 to R3): during a coder's work, its sandbox holds no file with the hash of a `gold/` or `evaluators/` file and no environment variable naming a provider key or token but the proxy's; names only are recorded
45. `eval-sandbox-separate` (R1 to R3): each evaluation runs in a container other than the coder's, with none of the coder's `/tmp/notes.md`, `/tmp/tasks.json`
46. `no-held-out-to-coder` (R2, R3): no dev or test item's input or answer is in a coder session, the bundle or a note
47. `reviewer-no-dev-item` (R2, R3): no dev item's input or answer is in a review's `feedback` or `hypothesis`
48. `meter-costs` (R3): evaluation meter lines have `cost_usd` above 0 and tokens, none with `error`; scored rows have `model_calls` above 0. No key when no evaluation called a model (no meter line, `model_calls` 0 on every scored row): a capitals program may answer from a table, as both e1 bare trials' did
49. `spend-adds-up` (R3): `done.json`'s `spend_usd` equals the rows' `coder_usd + dev_usd + program_usd + reviewer_usd` within a cent

- the credential: `CODECLIMB_BENCH_PI_AUTH`, the `github-copilot` entry of the operator's `~/.pi/agent/auth.json` as JSON, passed to the verifier service only. `test.sh` writes it to `/root/.pi/agent/auth.json` (mode 600) before the services start; both build specs read Pi's `auth.json` there (`CODECLIMB_PI_AUTH_PATH` unset). No check detail holds its value
- real results vary run to run: a `real.*` test is reported per trial and read as a pass rate over trials
- measured 2026-11-15 through `grade.sh`, one run per family per stack, on `main@4a71177` and `langchain@2ab1ad3`:
  - hidden tiers 1 and 2: Inngest 17 of 19, LangChain 18 of 19, about 4 min per stack. `weighted-score` failed on both on its `noise.json` margin half (both write the raw A/A move, 0, and neither build spec says it is the bounded margin); that half is dropped and every `score` matches. `continue` failed on Inngest: without `--mock` it loaded a mock night as real and stopped on the model check ("no github-copilot credentials"), against its spec's "a night under `runs-inngest/mock/` is continued … as a mock". Fixed in `main@0c395fd`, measured 2026-11-15 through `grade.sh`: 34 of 34, `continue` and `seed` pass
  - `checkpoint-lineage` checks the experiment refs only: the starter ref is a root commit
  - durability: all 10 per stack pass. Inngest 3a 77 s, 3b about 19 min; LangChain 3a 56 s, 3b about 12 min. On LangChain `graceful-restart` passes without its restart path: the night ends inside `docker stop`'s 10 s grace. `crash-mid-eval` forbids a new create of round 1's coder sandbox only, since a rerun evaluation may reuse its name. The Inngest reference names evaluation sandboxes `cc-<night>-r1-eval`, not `cc-<eval id>` as its id table says; the tests accept both
  - real: Inngest 15 of 18, LangChain 17 of 18, about 21 min and $0.31 to $0.38 per stack (at least $0.85 in all, R7's unmeasured). `deadline` failed on both and `tokens` on Inngest at the old $0.10 cap, which ended R5 and R6 on `budget` first; at $0.25 both pass on both stacks (R5: 3 rounds, $0.10 to $0.15, 3 to 5 min; R6: 1 round, $0.04 to $0.07, 2 to 3 min). `budget` failed on Inngest on its spend half ($0.055 against $0.05, which neither build spec bounds); that half is replaced by the between-rounds check. R1 reached `thresholds` in round 1 on both, so `overfit-lineage`'s chain is exercised by unit tests only
  - R5 and R6 caps raised from $0.10 to $0.25, then every real night to the configs' $0.50 (operator, 2026-11-15)
  - dropped by the operator (2026-11-15): 3's `noise.json` margin half; 35's spend within `budget_usd.night`, now a between-rounds check that 36 shares

### Reference builds

- a reference build proves the verifier before any trial is graded. Both stacks have one
- build-task pins, re-pinned 2026-11-17 to `main@5a81c07` (branch `pin-inngest-c7c6`) and `langchain@3612892` (`pin-langchain-c7c6`): the maintenance base below with the C7 and C6 patches on top (Inngest `1452a93` and `1360cb4`, LangChain `9d04590` and `9911231`, cherry-picked). Why: a build-task reference must pass every check it grades, and the build specs gained the C7 (`hard_deadline`) and C6 (`budget_usd.experiment` above `budget_usd.night` refused) lines on 2026-11-17, so `hard-deadline-mid-step` (59) and the new `config-rejects` (10) case grade build trials, which the maintenance base fails (Maintenance tasks). The C7 and C6 gate runs measured each patch alone: 34 of 34 and 37 of 38 hidden, the one failure the other change's test. Full grade of both pins (`job-configs/reference.sh <stack>`, which defaults to them, `real` skipped): (pending). `analyze.py` reads only these commits as the build tasks' reference (`assemble.BUILD_PINS`); reference runs of other commits are reported as their own cells
- maintenance base, unchanged: `main@bcabd72` and `langchain@400bd40` (`maintenance.BASES`), pinned 2026-11-16: each adds one commit of test hooks for the platform tests (`CODECLIMB_BACKSTOP_S`, `CODECLIMB_PAUSE_TIMEOUT_S`, `CODECLIMB_MOCK_CREDIT`), and on Inngest `stop.json` for a night still in init. `400bd40` sits on `langchain@9567643`, two commits past `2ab1ad3` (a graphrag config and its lessons). Measured inside Harbor through `job-configs/reference.sh`, `real` skipped: both reward 1, 34 of 34 checks and 37 of 37 hidden tests; unit tests 111 (Inngest) and 131 (LangChain) pass. The descriptions below are of the commits these build on
- Inngest: `main@0c395fd`: `main@4a71177`, then three commits that change no code the verifier reaches (`configs/graphrag.yaml`, graphrag `lessons.md`, a chart label), then one fix: `run-night continue` on a night under `runs-inngest/mock/` uses the mock config, so it skips the model check (`4a71177` stopped with "no github-copilot credentials", failing `hidden.continue`). It adds `--mock-offline N` (the coder's model calls 2 to N+1 of the night's first experiment fail as "fetch failed") and a `run-night stop` that waits for `stop.json` and prints `stopped` (`main@46a71b6` printed only that it sent the event, failing night 4). `run-night` prints `done` and `stopped` on a line of their own, as the LangChain build does: `main@bab033e` printed `[run-night] done:`, which the verifier does not read as printing `done`, so `cli-done`, `plateau-stop` and `hard-stop` failed (31 of 34). The plateau config, the `runs-inngest/` runs folder and configs equal to this branch's were already on `main`. `scenarios/` differs from this branch by one line, `inngest_image` in `graphrag/scenario.yaml`, which no evaluation reads
  - measured 2026-11-13, by hand on the host per `specs/inngest/e2e.md`: all seven nights pass every check listed for them; typecheck and the 110 unit tests pass. Night 5's resumed coder holds 13 send-backs, not 8: its count starts again after the restart, as the build spec says, and C8 is not among night 5's checks. Night 6's first session holds six assistant messages with stop reason `error`, then normal ones
- LangChain: `langchain@2ab1ad3`, with `results_path` relative to `runs-langchain/` and configs and `scenarios/` equal to this branch's. Its seven nights pass through the verifier (the measurement above)
- configs are normalized across `main`, `langchain` and this branch, with `langchain`'s as the source of truth
- rule: never grade a harness on a check a reference build fails. A build spec change that alters a check needs the reference to pass it; otherwise the check is dropped on both stacks
- dropped on both stacks under this rule: night 7's check that a dev evaluation has a `metrics.json` only when every stage was scored. The stacks differ there (Inngest writes it only then, LangChain always), so the done signals check only that the test evaluation has one
- the build specs are still being improved, so the pinned commits are re-checked by the reference gate after every spec change that touches the done signal
- if a reference fails a check inside the trial image because the build spec asks more than the reference does, patch the reference or drop the check
- build spec rewrite, 2026-11-14: in phases C to D2 every arm scored 34 of 34, because the build specs were written from the reference builds and already held the how (API usage, measured platform facts, build order) that skills, MCP and docs would teach. Both specs were cut to the what and the why, in the same seven sections (goal and done signal, architecture, features, interfaces the build must honour, runtime and tools, numbers, dependencies): Inngest 1100 → 372 lines, LangChain 1304 → 471. Every interface the verifier reads is kept in "Interfaces the build must honour"; every verifier literal the old specs named is still named. `e2e.md` lost only its how-words. Phases B to D2 ran on the old specs (`46fdb65`); results on the new ones are not comparable with them. The build tickets still cite the old sections and are to be regenerated
  - two review rounds against the verifier (Opus, then Fable) added what the specs had never stated (`docker ps -a`, `done`/`stopped` as the first word of a line, the verifier's time limits, the grading environment) and restored rules the rewrite had dropped (the wrap-up after the send-back cap, a gate failing above its cap). Specs at `d4286aa`: Inngest 377 lines, LangChain 441
  - first measurement, 2026-11-14 17:49, one `bare` trial per stack (`jobs/e1-*-bare-*`): both 34 of 34, `done` 1, no web fetch or search. Inngest $9.65, 46.7 agent min, 114 turns; LangChain $10.84, 68.8 min, 116 turns; against old-spec `bare` (phase C means) $15.10, 59.9 min and $12.71, 53.7 min. With no skills, MCP or docs, the harness still fills every gap the cut left from what it already knows of Inngest and LangGraph, so reward stays at the ceiling: the spec's detail was not what made the arms equal

### Gates before any trial

| gate | pass condition |
|---|---|
| reference | the verifier scores `done` = 1 on each stack's reference build |
| flake | the verifier run 3× on each reference build gives 1 each time |
| floor | Harbor's `nop` agent (given inputs only) passes no night check. Its `reward` is the floor, reported beside every cell |
| blocklist | from inside a trial, `curl github.com` and a `WebFetch` of the repo both fail; `inngest.com` and `docs.langchain.com` load |
| transcripts | 2 failed + 2 passed trials read; scores match what happened |

- results, 2026-11-13, on `main@4a71177` and `langchain@2ab1ad3`:
  - reference: `done` = 1 on both, through `grade.sh` and inside Harbor (`job-configs/reference.sh`), every check equal (Verifier)
  - flake: 3 of 3 runs `done` = 1 on each stack through `grade.sh` (Verifier); inside Harbor 4 more on Inngest and 3 on LangChain over the day (the last under the resource limits), all 34 of 34
  - floor: `nop` jobs (`job-configs/<stack>-nop.yaml`) inside Harbor, no night check passes: Inngest `reward` 1/34 = 0.029 (`install`), LangChain 3/34 = 0.088 (`install`, `typecheck`, `image`), because its build spec gives a scaffold with `typecheck` and `build:image` scripts. Floors differ by stack, one more reason to compare arms within a stack only. Trials took 1m 58s and 12m 24s
  - blocklist: the `blocklist` probe (`STACK=<stack> job-configs/probes/run.sh blocklist`, $0.20 Inngest, $0.18 LangChain), Claude Code on Opus 5.5 in each stack's trial environment: `curl` to `github.com` and `raw.githubusercontent.com` fails ("Failed to connect ... port 443"), `WebFetch` of the repo is denied ("WebFetch denied access to domain:github.com"), and `curl` and `WebFetch` of `www.inngest.com/llms.txt` and `docs.langchain.com/llms.txt` load (200)
  - transcripts: phase B (2026-11-13), 3 trials read against their scores. Harbor's grades (0.06–0.09, `typecheck` and every night failing) contradicted the agents' final reports ("all seven nights pass", each night described); the cause was the `/app` artifact (Task, `.venv`), and the leak flags were heredocs (Verifier). After the fixes, each build cloned from its trial's `.git` and graded through `grade.sh` scores 34 of 34, matching its report night for night. No trial has failed for real yet, so the gate's "2 failed" half waits for phase C. Phase C: 2 more passed trials read (Inngest `bare` `hFVMHQE`, LangChain `full` `GmLAZzu`); each final report says all seven nights pass, describing each night, and each scores 34 of 34 with every per-night check 1. All 12 phase C trials passed, so the "2 failed" half is still unmet
- resources: sampled every few seconds with `docker stats` during a reference job per stack inside Harbor. Peaks of `main`: Inngest 6.1 CPUs, 2.45 GB, 2.2 GB on disk (`/app`, `/root`, `/tmp`); LangChain 2.2 CPUs, 0.73 GB, 1.0 GB. The `dind` sidecar: Inngest 1.25 CPUs, 0.2 GB, 1.4 GB of images; LangChain 1.9 CPUs, 1.05 GB, 4.1 GB. Both tasks get `cpus = 6`, `memory_mb = 6144` (the peak plus room for Claude Code, which a trial's `main` also runs) and `storage_mb = 10240`, the same on both stacks. Harbor's Docker environment applies `cpus` and `memory_mb` to `main` alone (inspected: `NanoCpus` 6e9, `Memory` 6 GiB), in the trial and in the separate verifier environment, which copies `[environment]`; it does not enforce `storage_mb`. Under these limits both references still score 34 of 34 (Inngest verifier 430 s, LangChain 419 s)
- older floors (2026-11-12, build checks only): Inngest 0.2, LangChain 0.6, of the 5 build checks. The LangChain floor's verifier takes 16 min, most of it the 600 s wait for a `npm run server` that never returns (the scaffold's placeholder serves on 2024, not 8123)

### Jobs, repeats, cost

- one job file per (stack × arm), in `job-configs/`: `n_attempts`, `n_concurrent_trials: 1` (one subscription), `retry.max_retries: 1`, `retry.exclude_exceptions`, `agents[].override_timeout_sec`, `artifacts`
  - `exclude_exceptions` replaces Harbor's default list (`RetryConfig` in Harbor 0.25.0), so the job file writes it whole: the default `AgentTimeoutError`, `VerifierTimeoutError`, `RewardFileNotFoundError`, `RewardFileEmptyError`, `VerifierOutputParseError`, `ApiUsageLimitError`, `AgentSafetyRefusalError`, `AgentAuthenticationError`, `ModelNotFoundError`, `UnsupportedModelParametersError`, plus `NonZeroAgentExitCodeError` and `UnknownApiError` (see telling the stops apart). Otherwise a timed-out 8-hour trial runs again
- every trial runs on the subscription. `cost_usd` is Claude Code's own estimate at API prices (`total_cost_usd` of the stream's `result` event, `modelUsage.*.costBasis` = `list`), the only $ figure. Harbor's per-model `model_usage.*.cost_usd` is its own LiteLLM estimate and differs (measured: $0.031 against Claude Code's $0.048 for the same turn)
  - a session can emit several `result` events: when the agent ends its turn while a background task runs, Claude Code wakes the session again when the task finishes (a `command_lifecycle` event with `wakeup_source` `loop_wakeup`, then a new `init`), and each segment ends in its own `result`. `total_cost_usd` is cumulative and `num_turns` counts one segment. Harbor 0.25.0 reads the first `result` into `agent_result.cost_usd` (`_parse_total_cost_from_stream_json`), so `analyze.py` takes cost from the last `result` and sums `num_turns` over all of them. Measured in phase C, 2 of 12 trials: Inngest `bare` `hFVMHQE`, 3 results (135 + 23 + 3 turns; Harbor $16.00, true $16.26; the first segment ended "Waiting for the background app agent"), LangChain `full` `GmLAZzu`, 2 results (126 + 1; $13.34, true $13.44)
- a per-trial cap, `kwargs: { max_budget_usd: "32" }` in every arm's job file: 2× the costliest phase-B trial ($15.78), rounded up. Harbor types it as a string. Measured 2026-11-13 with a $0.01 cap on the subscription: it counts the same estimate and stops the trial, but only after the turn that crosses it (the trial spent $0.04, 3 turns). Claude Code ends with result `subtype` `error_max_budget_usd`, `terminal_reason` `budget_exhausted`, exit 1; Harbor records `NonZeroAgentExitCodeError` (no `BudgetExceededError`). Its policy group, `UNCLASSIFIED`, grades the build but sets Harbor's `reward_valid` false (read from `error_policy.py`; the probe ran without a verifier). Harbor 0.25.0 has no `override_error_policy`; `analyze.py` counts a capped trial's reward, so the expensive failures stay in the mean
- size of the job: the Inngest reference is ~8,900 lines of TypeScript + ~2,000 of tests. C + D + D2 = 30 trials, about $450 at API prices and 30 h of agent time at phase B's pace (D2's pocock workflow unmeasured)
- infra errors (sandbox build, API rate limit, the subscription's usage limit) are retried and excluded; agent timeout, context exceeded and non-zero exit count: the verifier still grades whatever was built. Report retried attempts too
- telling the stops apart: Harbor's exception type is not enough. Harbor matches `You've hit your usage limit`, while Claude Code 2.1.322 composes `You've hit your <kind> limit`, so a usage-limit stop is not reliably `ApiUsageLimitError`; it may come out as `NonZeroAgentExitCodeError` (the cap's type) or, if Harbor's `rate.?limit` or `API Error` patterns match the stream's `result` event, `ApiRateLimitError` or `UnknownApiError`. All read from both sources; a usage limit was not triggered. So `analyze.py` keys on the stream, `agent/claude-code.txt`, whatever Harbor's type:
  - usage limit: an assistant event with `error` = `rate_limit` or `billing_error`, or the `result` event's `api_error_status` = 429. Infra: excluded, and rerun by hand after the limit resets (an automatic retry would hit the same limit, so neither `NonZeroAgentExitCodeError` nor `UnknownApiError` is retried)
  - budget cap: `result.subtype` = `error_max_budget_usd`. Counts
  - otherwise Harbor's exception type and policy decide
  - the shape is measured on one API-error stop, the 401 of a bad token (2026-11-13): an assistant event with `error` = `authentication_failed` and `api_error_status` = 401, a `result` event with `is_error` true, `api_error_status` 401 and `terminal_reason` `api_error`, recorded as `UnknownApiError`
- arm order randomized within a day; arms compared against each other run in the same time window
- phases:

| phase | cells | trials | stop rule |
|---|---|---|---|
| A gates | reference, flake, `nop`, blocklist | 0 | any gate fails → fix the task |
| B pilot | Inngest `bare`, `full`; LangChain `full` | 1 each | sets the cap, the timeout, the storage and memory sizes, where usage data lives. LangChain enters C only after one trial reaches `services-up`, so its builds don't all sit at the floor |
| C bounds | 2 stacks × {`bare`, `full`} | 3 each = 12 | `full − bare` inside noise → stop, report "no detectable context effect" |
| D other arms | 2 stacks × {`skills`, `mcp-docs`} | 3 each = 12 | completes the 2 × 2 |
| D2 workflow | 2 stacks × `full × pocock` | 3 each = 6 | vs phase C's `full × one-shot`, same time window where possible |

- phase B results, 2026-11-13, Claude Code 2.1.322 on Opus 5.5 at medium effort, the three trials run side by side (one minute apart), no usage limit hit:

| trial | agent | $ (API price) | tokens in / cache read / cache write / out | turns | tool calls | score |
|---|---|---|---|---|---|---|
| Inngest `bare` | 51m 30s | 15.78 | 36.6M / 36.1M / 0.47M / 0.25M | 140 | 180 | 34 / 34, `done` 1 |
| Inngest `full` | 49m 38s | 13.92 | 34.9M / 34.5M / 0.38M / 0.20M | 139 | 137 | 34 / 34, `done` 1 |
| LangChain `full` | 62m 24s | 14.97 | 35.0M / 34.5M / 0.43M / 0.23M | 136 | 134 | 34 / 34, `done` 1 |

  - scores: Harbor's verifier graded a half-copied `/app` (Task, `.venv`), so each trial is infra in `analyze.py`. Each build was cloned from its trial's intact `.git` (`fsck` clean; every agent committed its work) and graded through `grade.sh`, 431–440 s each, `leak` 0 on `/app`. Trial folders and recovered builds: `jobs/pilot-*`, `jobs/recovered/` (gitignored)
  - the 3 sessions rescanned with heredoc bodies cut: 0 hits
  - the `.venv` exclude, checked in Harbor ($0): the recovered Inngest `full` build plus a `scenarios/graphrag/.venv/bin/python` link to `/usr/bin/python3`, through a `nop` trial with `job-configs/reference.compose.yaml`: `/app` collects `ok` without `.venv`, 34 of 34, `done` 1
  - levers: Inngest `full` invoked `inngest-steps` and called `inngest-dev` 3 times (`list_runs`, `get_run_trace`); LangChain `full` used no pack skill and no MCP tool; no trial fetched docs. Inngest `bare` and LangChain `full` each invoked the built-in `dataviz` skill (for the web app), so `analyze.py` counts the arm's own skills (the trial lock's names) as `skill` and every other skill as `other_skill`
  - LangChain reached `services-up` (and every night), so it enters phase C
  - ceiling: all three cells scored 34 of 34 in about an hour, `bare` included. If phase C's `bare` builds also score 1, `reward` cannot show a context effect; the effect would show in `cost_usd`, wall-clock and turns only
- phase C results, 2026-11-13 21:51 to 2026-11-14 01:30, Claude Code 2.1.322 on Opus 5.5 at medium effort. The four jobs (`jobs/c-*-20261113-2151`, gitignored) ran side by side, launched one minute apart in shuffled order (Inngest `bare`, Inngest `full`, LangChain `full`, LangChain `bare`), each running its 3 attempts in sequence: 4 trials at a time, against phase B's 3, so wall-clock comparisons with phase B carry that difference. No usage limit, no infra error, no retry, `leak` 0, `/app` collected `ok` in every trial. Means per cell (n = 3; costs after the multi-`result` fix):

| cell | reward | $ (API price) | agent min | turns | tool calls | skill / MCP calls |
|---|---|---|---|---|---|---|
| Inngest `bare` | 1, 1, 1 | 15.10 (13.7, 16.3, 15.3) | 59.9 | 151 | 159 | 0 / 0 |
| Inngest `full` | 1, 1, 1 | 12.50 (12.8, 12.4, 12.3) | 51.7 | 130 | 128 | 1 each / 3 in one trial |
| LangChain `bare` | 1, 1, 1 | 12.71 (12.5, 12.6, 13.0) | 53.7 | 130 | 129 | 0 / 0 |
| LangChain `full` | 1, 1, 1 | 13.89 (13.4, 13.4, 14.9) | 60.6 | 132 | 131 | 0 / 0 |

  - `full − bare`, exact one-sided tests in the pre-set directions (`analyze.py`, `p <= ALPHA`; at 3 vs 3 the smallest p is 1/20 = 0.05, so an effect is called only when every `full` trial lies above every `bare` one):
    - reward: 0 on both stacks. All 12 builds score 34 of 34: the ceiling. Reward cannot show a context effect here
    - cost, tested as "`full` costs more": LangChain +$1.18, p = 0.05, called at the floor. Its `full` trials used no pack skill and no MCP tool, so the levers' use cannot explain it; the larger context can (45 skills and 2 MCP servers in `init`, against 17 and none in `bare`; cache reads 32.1M against 28.7M). Inngest −$2.61, the opposite direction: not called by the pre-set test; two-sided p = 0.10, descriptive only
    - the two stacks move cost in opposite directions, so there is no consistent context effect on cost either. Wall-clock (Inngest −8.3 min, LangChain +6.9) and turns (−21, +2) follow cost, none past the floor
  - result: no detectable context effect on reward (ceiling), and no consistent one on cost. Per the stop rule, the operator decides whether phase D runs
- phase D results, 2026-11-14 08:17 to 12:02, same harness, model and effort as phase C. The four jobs (`jobs/d-*-20261114-0817`, gitignored) ran side by side, launched one minute apart in shuffled order (LangChain `mcp-docs`, Inngest `skills`, Inngest `mcp-docs`, LangChain `skills`), 4 trials at a time as in phase C. No usage limit, no infra error, no retry, `leak` 0. Total $160.80 at API prices. Means per cell (n = 3):

| cell | reward | $ (API price) | agent min | turns | tool calls | skill / MCP docs calls |
|---|---|---|---|---|---|---|
| Inngest `skills` | 1, 1, 1 | 14.30 (12.9, 16.5, 13.4) | 62.9 | 141 | 157 | 1 each / – |
| Inngest `mcp-docs` | 1, 1, 1 | 12.99 (11.5, 12.6, 14.9) | 51.6 | 137 | 135 | – / 3 in one trial |
| LangChain `skills` | 1, 1, 1 | 13.15 (12.8, 12.5, 14.0) | 64.6 | 134 | 130 | 0 / – |
| LangChain `mcp-docs` | 1, 1, 1 | 13.16 (16.4, 11.1, 12.0) | 47.9 | 128 | 127 | – / 0 |

  - levers per trial: every Inngest trial given skills (`skills` and `full`, 6 of 6) invoked one pack skill; no LangChain trial given skills (6 of 6) invoked one. Docs MCP: 1 of 3 Inngest `mcp-docs` trials (`Aywznti`, 3 calls), 0 of 3 LangChain. Platform MCP (`inngest-dev`): 1 of 6 Inngest trials that had it (`full` `YxsZ5ZD`, 3 calls). No `web_fetch` or `web_search` in any trial; `bash_fetch` 1 in 4 trials. `other_skill` (built-in skills such as `dataviz`) 1 in 4 trials
  - multi-`result` sessions: 4 of 12 (Inngest `skills` `TxyXfPT` 2; LangChain `skills` `6k8WikX` 3, `WKT622W` 2, `cEiJ75y` 5), handled by the last-`result` cost and summed turns
  - 2 × 2 per stack, with phase C's `bare` and `full` (`analyze.py`; main effects pool 6 trials against 6):
    - reward: skills 0, MCP + docs 0, interaction 0 on both stacks. All 24 builds score 34 of 34
    - cost: Inngest skills −$0.65, MCP + docs −$1.96, interaction +$0.31; LangChain skills +$0.58, MCP + docs +$0.60, interaction +$0.30. None is called by the pre-set test
  - stack comparison on the 34 shared checks: both stacks score 1.000 in every arm; mean cost per arm Inngest 15.10 / 14.30 / 12.99 / 12.50 (`bare`, `skills`, `mcp-docs`, `full`), LangChain 12.71 / 13.15 / 13.16 / 13.89. Neither stack is cheaper in every arm
  - result: no detectable effect of skills, of MCP + docs, or of their interaction, on reward or cost, on either stack, at n = 3. Reward sits at the ceiling in every cell, so the build specs do not separate the arms; a harder task or a finer reward is needed before more repeats can show a context effect
- phase D2 trial run, 2026-11-14 13:12 to 14:47: one `full × pocock` trial per stack instead of three, to check the workflow end to end before the build specs and tickets are tuned (the operator's call). The operator accepts the one-trial run in place of the three-trial one: a three-trial job runs the same job files with `n_attempts` 3, so it is taken to work if this one did. Both side by side, `-k 1` on the job files, cap $32 not hit, no usage limit, no infra error, `leak` 0:

| trial | reward (Harbor, then regrade) | $ (API price) | agent min | turns | tool calls | tickets done | commits |
|---|---|---|---|---|---|---|---|
| Inngest `pocock` `pW5jnmE` | 0.941, then 1 | 18.70 | 82.7 | 179 | 196 | 40 / 40 | 43 |
| LangChain `pocock` `xkVfypS` | 0.971, then 1 | 18.89 | 82.1 | 179 | 201 | 46 / 46 | 49 |

  - against phase C's `full × one-shot` means: +$6.20 and +31 min on Inngest, +$5.00 and +21.5 min on LangChain; reward equal after the regrade. The tickets and the per-ticket loop are measured together, not apart
  - `unit-tests` failed in both Harbor grades: the builds' tests start `codeclimb-python` sandboxes, and the verifier ran `npm test` before `build:image`. Fixed in the verifier (Verifier, the build checks); both reference builds score 34 of 34 with the new order (`grade.sh`, 2026-11-14), and `harbor trial regrade` of both trials (`jobs/d2-regrade-20261114-1522`) scores 34 of 34
  - Inngest `hard-stop` failed in the first grade (`stop.json` reason `cancelled`, not `manual`, and sandbox `cc-<night>` still present after 30 s) and passed in the regrade: a flaky check on this build. One build's flake, not yet seen on a reference build
  - the workflow was not followed as written: neither agent called `implement` through the Skill tool (only the template's first `/implement`), and each called `code-review` once, after the last ticket, with its 2 subagents; no `tdd` call. Each did close every ticket with its own commit. `context/pocock/prompt.md` needs a firmer per-ticket instruction before the three-trial run
- each phase from B on starts only with the operator's go-ahead
- the full run, every cell from scratch: `job-configs/run-all.sh [slots]` runs the 10 job files (8 one-shot, 2 `full × pocock`), 3 attempts each, 30 trials, with at most `slots` jobs at once, one trial each (default 3). It assembles both stacks once first (`pocock.sh` would re-assemble a stack's task while that stack's other jobs run), starts the 2 pocock jobs first (each about 3 × 95 min, so starting them last leaves slots idle at the end), then the one-shot jobs in shuffled order, one minute apart. `DRY=1` prints the order and checks each job file with `--print-config`, no trial
  - slots: 3 by the operator's choice (2026-11-14), to stay clear of the subscription's usage limits; 4 is the most measured (phases C and D). Estimate from phases C to D2: one-shot about 72 min a trial start to graded, pocock about 95 min, 38.5 slot-hours, so about 13 h at 3 slots and 10 h at 4. About $440 at API prices. Above 4 the 9 CPUs Docker Desktop gets are the limit (Inngest grading alone peaks at 6.1): CPU contention slows the timed night checks (`hard-stop`'s 30 s, `crash-resume`, `lost-connection`) into false failures (guess)
- power: n = 3 per cell, so only large effects show. The 2 × 2 helps: each main effect pools 6 trials vs 6. Add repeats to a cell only when its result is borderline

### Layout and commands

- Harbor 0.25.0 (`uv tool install harbor`)

```
specs/inngest/spec.md  e2e.md  tickets/  given/      (langchain/: same shape)
scenarios/  configs/  docker/  LICENSE                 shared given inputs
tasks/codeclimb-inngest/                               (codeclimb-langchain/: same shape)
  instruction.md
  task.toml
  environment/Dockerfile            Node 24, Python, uv, Docker CLI, pinned stack CLI, Claude Code
  environment/docker-compose.yaml   daemon sidecar, GitHub block
  environment/app/                  generated by assemble.py, gitignored
  tests/Dockerfile                  verifier image. Harbor treats a tests/Dockerfile as bundling the tests: it does not upload tests/, so the image COPYs it to /tests
  tests/docker-compose.yaml         daemon sidecar for the verifier
  tests/test.sh                     runs run.py → /logs/verifier/reward.json
  tests/verifier/                   copied from verifier/ by assemble.py
tasks/shared/instruction.md         the instruction of both tasks; assemble.py copies it into each (gitignored copy)
tasks/shared/dind.compose.yaml      the sidecar and its GitHub block, `extends`-ed by all four compose files
verifier/blocked_hosts.py           the blocked list; assemble.py writes Claude Code's deny rules from it into each environment/ (gitignored)
verifier/leak.py                    the leak scan; assemble.py writes its baseline, tests/verifier/given.json (gitignored)
verifier/run.py, adapters/          the verifier, one copy; assemble.py copies it to each task's tests/verifier/ (gitignored)
tasks/topology-check/               not a benchmark task: proves the trial topology inside Harbor, $0
context/<stack>/skills/             vendored skill dirs, pinned
context/<stack>/docs-block.md       the MCP + docs arm's prompt addition
context/<stack>/skills-pointer.md   the skills arm's one-line prompt addition
context/<stack>/SOURCE.md           where the vendored skills come from: repo, commit, tree sha256
context/pocock/skills/              implement (flag dropped), tdd, code-review, ...
context/pocock/scaffold/            docs/agents/issue-tracker.md, domain.md, agent-skills-block.md (for AGENTS.md)
context/pocock/SOURCE.md            the skills' repo, commit, digests and the one edit
job-configs/pocock.compose.yaml     the overlay that copies tasks/codeclimb-<stack>/pocock/ into each trial's /app
job-configs/pocock.sh               runs a full-pocock job (assembles, sets CODECLIMB_POCOCK_DIR)
job-configs/run-all.sh              every cell from scratch, at most <slots> jobs at once, pocock first
job-configs/reference.compose.yaml  the overlay that puts a reference build into a nop trial's /app
job-configs/reference.sh            grades a stack's reference build inside Harbor (exports it, runs the nop job)
job-configs/maintenance.sh          grades a maintenance task's /app as given with the nop agent (assembles it first)
job-configs/maintenance.compose.yaml  that job's overlay: the empty sessions folder, so the trial can be regraded
tasks/codeclimb-<stack>-<task>/     a maintenance task, generated by `assemble.py maintenance`, gitignored
tasks/shared/maintenance.md         the maintenance prompt template, the same for both stacks
gate.py, gate_test.py               the maintenance gate: 3 reference runs on the base and 3 on the task commit → verdict
maintenance.py                      the maintenance task registry: requests, target tests, commits, per-stack prompt text
context/pocock/prompt.md            "/implement per ticket, frontier first" + {{ instruction }}
job-configs/<stack>-{bare,skills,mcp-docs,full,full-pocock}.yaml    plus topology-check.yaml
job-configs/probes/                 the harness probes: run.sh and its prompt templates (subscription)
jobs/                               Harbor's job output, gitignored
assemble.py                         given inputs + SPEC.md + E2E.md → a task's environment/app/; the pile → the pocock mount
analyze.py, analyze_test.py         job dirs → trials.jsonl → per-cell outcome, 2 × 2 effects, stack comparison
code_metrics.py, code_metrics_test.py  one build → its code and practice metrics file (Metrics), in the analysis container
analysis/Dockerfile                 the analysis container: Node 24.22.3, cloc 2.04, and package.json + lockfile's pinned tools
analysis/eslint.measure.mjs         type escapes and complexity per function (syntax only)
analysis/eslint.ruleset.mjs         the benchmark's lint ruleset (type-checked)
analysis/measure.py                 runs the tools inside the container
analysis/fixture/                   a small build with known counts, for code_metrics_test.py
docs/codeclimb-eval-spec.md         this file
docs/adr/
GLOSSARY.md
```

- job file, `full` arm (fields verified in the 2026-11-11 dummy runs and the 2026-11-13 probes):

```yaml
job_name: inngest-full
n_attempts: 3
n_concurrent_trials: 1
tasks: [{ path: tasks/codeclimb-inngest }]
environment: { type: docker }
retry: { max_retries: 1, exclude_exceptions: [...] }   # the whole list above
agents:
  - name: claude-code
    model_name: anthropic/claude-opus-5-5
    skills: [context/inngest/skills/<skill>, ...]      # one entry per skill dir
    mcp_servers: [{ name: inngest-dev, transport: streamable-http, url: http://127.0.0.1:8288/mcp }]
    kwargs: { reasoning_effort: medium, max_budget_usd: "32" }   # the cap, from phase B
extra_instruction_paths: [context/inngest/skills-pointer.md, context/inngest/docs-block.md]
```

- other arms: `bare` drops `skills`, `mcp_servers` and `extra_instruction_paths`; `skills` keeps `skills` and only the skills pointer; `mcp-docs` drops `skills` and keeps only the docs block. `full-pocock` adds the pocock skills (`context/pocock/skills`, one skill root), `kwargs.prompt_template_path: context/pocock/prompt.md` and `environment.extra_docker_compose: [job-configs/pocock.compose.yaml]`
- checked in `harbor job schema`: `mcp_servers[].transport` is `stdio`, `sse` (default) or `streamable-http`; `extra_instruction_paths` is job-level; `kwargs.prompt_template_path` must name `instruction` (the probes wrap it in `{% if false %}`)
- commands:
  - topology check, $0: `tasks/topology-check/run.sh`
  - assemble a task: `python3 assemble.py <stack> [--pile <dir>]`
  - check a config, $0: `harbor run -c job-configs/<file>.yaml --print-config`
  - floor gate: `harbor run -p tasks/codeclimb-<stack> -a nop`
  - reference gate: `verifier/grade.sh <git archive of the reference commit> <stack>`, 3×; inside Harbor: `job-configs/reference.sh <stack>`
  - assemble a maintenance task: `python3 assemble.py maintenance <task> <stack> [--pocock]` → `tasks/codeclimb-<stack>-<task>/`; its floor, $0: `job-configs/maintenance.sh <task> <stack>`
  - maintenance gate, $0: per stack, `CODECLIMB_VERIFIER_FAMILIES=hidden CODECLIMB_VERIFIER_ONLY=<targets> job-configs/reference.sh <stack> <sha> -k 3` on the base and on the task commit, then `python3 gate.py <task> jobs`
  - every phase: `harbor run -c job-configs/<file>.yaml`, arm files in shuffled order. The `full-pocock` files run through `job-configs/pocock.sh <stack>`, which assembles and sets the overlay's absolute path
  - regrade after a verifier fix, no new trial: `harbor job regrade <job dir> -p tasks/codeclimb-<stack>` (or `source_jobs` in a job file)
  - analysis: `python analyze.py ./jobs`
  - code and practice metrics of one build, $0 (Docker; the image builds on first use): `python3 code_metrics.py --app <trial>/artifacts/app --stack <stack> --out <trial>/code-metrics.json --reference <the stack's reference metrics file>`; `analyze.py` carries the file in the trial's row when it is there. A reference's own metrics: the same command on a `git archive` of the build-task pin (Reference builds), without `--reference`

### Metrics

- one row per trial in `trials.jsonl`: stack, arm, workflow, harness + CLI version, model id, effort, attempt, `exception_type`, `reward_valid`, `reward`, `done`, per-check results, `leak`, agent wall-clock, verifier wall-clock, tokens (in / out / cache), agent $, turns, tool calls, skill (the arm's own) / other skill (built-in) / MCP / doc-fetch counts, skill digests, spec sha256, given-inputs sha256, task hash, Harbor version, start time
- sources (field names measured on the subscription, 2026-11-13): trial `result.json` → `agent_result.cost_usd` (only when the stream has no `total_cost_usd`; see Jobs, repeats, cost), `n_input_tokens` (input + cache read + cache creation), `n_cache_tokens` (cache read), `n_output_tokens`, per-model `model_usage`; `agent_info.version` and `model_info.name`; phase timings `environment_setup`, `agent_setup`, `agent_execution`, `verifier`, each `{started_at, finished_at}`; `agent/trajectory.json` → `steps` and `final_metrics.total_steps`, with cache creation in `final_metrics.extra.total_cache_creation_input_tokens`; `agent/claude-code.txt` (the stream) → the last `result` event's `total_cost_usd`, `subtype`, `terminal_reason` and `subagent_stats`, and `num_turns` summed over every `result`. Effort: the session file under `agent/sessions/`
- outcome per cell: the 3 `reward` values plotted, mean, min–max; `done` as k/3; per-check pass counts show where builds break
- arm value: the 2 × 2 effects on `reward` and $, within a stack. Exact permutation test over trials; at 3 vs 3 the smallest one-sided p is 0.05; pooled 6 vs 6 main effects go down to 0.001. Direction fixed before the run (`full` > `bare`). Claim an effect only at p ≤ 0.05, else "not detectable at n = 3"
- `analyze.py <jobs dir>` (code: `analyze.py`, tests: `analyze_test.py` on a synthetic jobs folder with a known effect):
  - one row per finished trial of a `codeclimb-<stack>` task in `<jobs dir>/trials.jsonl`, with every field above. `arm` from the trial's config (skills and MCP servers set or not; `nop` with the reference overlay is `reference`), `workflow` `pocock` from the overlay, `probe` from a probe template, else `one-shot`; `attempt` numbers a job's cell by start time. Harbor stores no `reward_valid`: it is recomputed with Harbor's error policy (a reward, and no exception outside the agent-budget and refusal groups). The spec and given-inputs sha256 come from the task's `assembled.json` at analysis time; the row's `task_digest` (the trial's `lock.json`) shows whether the task changed since
  - `status`: `counted`; `infra` (a usage-limit stop in the stream, whatever Harbor's type, or an exception type of the policy's sandbox, model-provider, Harbor or cancel groups), listed with its cost, in no mean; `leak` (a harness trial with `leak` = 1; a `nop` or reference trial's leak comes from the build's own files and counts), listed, in no mean; `no-reward`; `regraded`. A regrade row (`harbor job regrade`) takes its source trial's fields and the new rewards, and replaces the source in every mean. A budget-capped trial (`NonZeroAgentExitCodeError`, `error_max_budget_usd`) counts, with `reward_valid` false
  - retried attempts: Harbor deletes a retried attempt's trial folder (`shutil.rmtree` in `trial/queue.py`), so only the job's `stats.n_retries` is left. The report lists those counts; a retried attempt's cost is not recorded anywhere
  - the report: per cell the `reward` values, mean, min, max, `done` k/n, per-check passes and mean $; the skills, MCP + docs and interaction effects of the one-shot arm trials per stack, on `reward` and on `cost_usd`; the stack comparison per (workflow, arm) on the checks both stacks share; the trials kept out of every mean
  - tests: a main effect is a pooled two-sample exact test over every split (C(12, 6) = 924 at n = 3); the effect's value is the spec's mean of two differences, equal to the pooled difference when cells are balanced. The interaction's exact test with equal cells is the two-sample test of `full` + `bare` against `skills` + `mcp-docs` (every split of those halves has the same number of cell assignments); unequal cells enumerate every assignment, sampled past 2 million. One-sided, `greater` for every effect on both metrics: the lever on scores higher, and costs more. Measured 2026-11-13 on the fixture (skills on about 0.95, off about 0.25): skills +0.700 with p = 1/924, MCP + docs and the interaction "not detectable at n = 3"; on `./jobs` it ran over 30 trials (the `nop`, reference, probe and smoke ones) in under a second
- false-done rate: trials whose last message claims done while `done` = 0
- did the harness run `E2E.md` itself (trajectory): yes / no
- glue-code LOC: `cloc` of the build minus the given inputs
- code quality: binary judge checklist (durable primitive per experiment: `step.invoke` / `task`; no secrets in sandboxes; no hardcoded thresholds), a different model family as judge, its own reward key, off until it agrees with Paul on 5 builds
- cut: the API-key cross-check of `cost_usd` (no API key is used), "errors from non-existent framework APIs" as a count of hallucinations (replaced by the SDK type errors below), observability scoring (nothing checks it)

Developer-experience metrics (decided 2026-11-17). Report only: columns in `trials.jsonl` and the `analyze.py` report, never checks, never in `reward` or `resolved`. Each is shown for the trial and, where marked (ratio), as a ratio to the same stack's reference build. Phase B to D2 trials ran on the old build specs: their metrics are computed, labelled `old specs`, and never pooled with trials on the current specs

- process, from the session files (`agent/sessions/projects/-app/*.jsonl`; `trajectory.json` observations hold only `content`):
  - time split: time inside tool calls, time outside them (includes idle waits on background tasks, so it is not model time), and feedback latency (median seconds of a service start or a `run-night` call)
  - milestones, the same on both stacks: $ and minutes to the first `services-up`, the first night 1 `done`, the first night 5 pass. They replace cost per build ticket (only `pocock` has tickets) and time to the first green test (unit tests are the harness's choice)
    - $ to a milestone (guess: an estimate, not checked against a metered run): the trial's `cost_usd` × the share of the session's priced tokens spent by the milestone's time. Each assistant message's final usage is priced relative to an input token at Anthropic's list ratios, input 1, cache read 0.1, cache write 1.25 (5 min) or 2 (1 h), output 5 (`analyze.py` `PRICE`); the session files carry no per-message $, and the ratios are the same for every model, so the share needs no model price
  - rework ratio: lines written in the session (`toolUseResult.structuredPatch` and `bashEditDiff`, so writes through Bash count) ÷ lines in the final build. The final build: the text lines of every file of the trial's `/app` but the shared given inputs, the benchmark's stubs (`SPEC.md`, `E2E.md`, `AGENTS.md`), generated folders (the code metrics' list and the runs folders) and npm's `package-lock.json`; a write outside it counts on neither side. `bashEditDiff` counts some changed files only in `moreFiles`, so the ratio is a floor
  - thrash: the same error line recurring across commands without a file change between
  - failures during the build: `error TS\d+` and `# fail N` parsed from command output with heredoc bodies cut first (as `verifier/leak.py` does); exit codes are masked by `| head`, so they are not used
  - SDK type errors: TS2339, TS2305, TS2554 naming a stack-SDK symbol, a cheap proxy for calls to APIs that do not exist
  - lookups: reads of `node_modules/<stack SDK>` and of `/docs/pi`, beside the skill, MCP and doc-fetch counts above (no trial so far fetched the web; 2 of 12 trials with an MCP server called it)
- code, on the build's `/app` without the given inputs and the Next.js app:
  - what is measured: the TypeScript and JavaScript files, without the given inputs (the shared dirs, `specs/<stack>/given/`'s paths, the stubs), the Next.js app (a folder holding `next.config.*` wholly; at the root, the config, `next-env.d.ts` and `app/`, `pages/`, also under `src/`) and generated files. A glue route inside the Next.js app (Inngest's `api/inngest`) is left out with it. Test files (under `test/`, `tests/`, `__tests__/`, or `*.test.*`, `*.spec.*`) count in size, not in glue, domain or coverage
  - size (ratio): lines of code without comments, comment lines, files, modules (`cloc`, identical files counted each time). A module is a folder holding measured non-test files
  - glue and domain: a glue file imports the stack SDK (Inngest: `inngest`, `@inngest/*`; LangChain: `@langchain/*`, `langsmith`; tracing counts on both). Glue and domain lines (ratio), distinct SDK symbols used, files importing the SDK
  - type escapes per 1000 lines (ratio): `any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, non-null `!`
  - duplication (`jscpd`), dead code and unused exports (`knip`), complexity per function
  - unit-testable share: `npm test` line coverage with no service up, split glue and domain. No service includes no Docker: tests that need a sandbox skip themselves, so `langchain@400bd40` passes 115 here against 131 with Docker (its four Docker suites: coder crash resume, evaluator, meter relay, Docker sandbox), measured 2026-11-17
  - dependencies beyond the build spec's dependency table (not `given/package.json`)
- practices:
  - flags: CI config, pre-commit hooks, a linter and a formatter configured, and whether each passes; a README or AGENTS.md. CI and the hooks are not run in the analysis container (no CI runner, no commit to hook): `ci_passes` and `pre_commit_passes` are null, with the reason
  - one benchmark-owned ruleset run from outside the build: typescript-eslint, type-checked, with `no-floating-promises`; violations per 1000 lines (ratio). `recommendedTypeChecked` with inline config off, over a project of exactly the measured files that extends the build's own `tsconfig.json`. `no-floating-promises` allows `node:test`'s `test`, `describe` and hooks (`allowForKnownSafeCalls`, typescript-eslint's documented exception): the runner awaits them, and every test call would count otherwise
  - the given `tsconfig.json` weakened: its sha256 against `tests/verifier/given.json`
  - own-test flakiness: `npm test` 3 times, the pass counts
- runtime, already in `checks.json`: seconds per night, resume latency after a kill (night 5), cold start (`services-up`), image size
- tools: `cloc`, `jscpd`, `knip`, typescript-eslint and the coverage tool run at pinned versions in the benchmark's own analysis container, never in a build's `package.json` (approved 2026-11-17). Pinned: cloc 2.04, jscpd 5.4.2, knip 6.44.1, eslint 10.14.0, typescript-eslint 8.72.1 on typescript 6.0.3, c8 12.0.0 (coverage), Node 24.22.3 (`analysis/`). A tool that fails gives null and its error, never 0. Type escapes and complexity per function come from ESLint rules too (`no-explicit-any`, `no-non-null-assertion`, `ban-ts-comment`, a selector for `as unknown as`, `complexity`), not from text search. Mutation testing is not used: slow on code that starts sandboxes, and it grades the tests the harness chose to write

### Maintenance tasks

- what: a task that starts from a reference build and asks the harness for one change (a request) or one repair (a planted fault, stated only as its symptom). It measures how easy each stack is to change and to debug; a build task measures how easy it is to build
- base: the maintenance base, `main@bcabd72` and `langchain@400bd40` (Reference builds; not the build-task pins, which carry C7 and C6). Each maintenance task is one commit on top of its stack's base, on the reference branch, named on this branch only by SHA (ADR 0002). Re-pinning the maintenance base rebuilds its maintenance tasks
- the confound: a maintenance task measures the stack as the reference build shapes it (Inngest's reference has a few large files, LangChain's many small ones). Each kind has a control with nothing stack-specific in it; each stack's result is read as platform task minus control
- `/app`: the `git archive` of the task's commit, without the reference's `AGENTS.md`, `.mcp.json`, `.claude/` and `notes/`, and what the workflow leaves out, by the same rule as a build task (decided 2026-11-17): one-shot (the default) also drops all of `docs/` and any glossary (`GLOSSARY.md`, `CONTEXT.md`); `pocock` keeps the glossary, `docs/adr/` and `docs/agents/` (the docs its skills write) and drops the rest of `docs/`, so never a spec copy (the LangChain reference's `docs/codeclimb-spec-langchain.md` names this spec and a reference commit, and fails the assemble's scan); plus `SPEC.md`, the `AGENTS.md` stub and a fresh `git init` with one commit, so neither `git log` nor `git diff` shows the change. A repair's commit also removes the tests and comments that describe the fixed behaviour. The leak scan's baseline (`given.json`) is written from this `/app`, so the reference's files are not counted as the harness's
- prompt: one stack-neutral template naming only the request or the symptom, in CLI output, night files and `docker ps -a`, never a test name; `assemble.py` fills the runs folder and service commands, as for `E2E.md`
- trial: the `bare` arm, the one-shot workflow. The tooling arm (`bare` against `mcp-docs`) on live repairs is later
- target tests: shared by both stacks and passed reliably by both references. Never the stack-only tests (22, 27 to 31). `stop-then-crash` (58) only after both references pass it 5 of 5
- `resolved`: the target tests pass and every other test passes as it did on the base. Beside it, as metrics: $, turns and minutes (from the first `services-up`: the `/app` has no `node_modules` or images), diff lines and files against the reference's own fix, whether a regression test was added
  - minutes: from the first `services-up` (the process metrics' detector) to the session's last tool call; null when services never came up
  - the trial's change: its final `/app` against the `/app`'s own first commit, committed or not, untracked files counted whole, gitignored files and `package-lock.json` left out; lines are added plus removed. The reference's own fix is the task commit → base diff, its size recorded by `assemble.py` in `assembled.json` (`fix`); `fix_ratio` is the change's lines over the fix's
  - a regression test was added: a test file (the code metrics' rule) gains lines in the change
- gate, $0 under `--mock` through `job-configs/reference.sh <stack> <sha>` with `CODECLIMB_VERIFIER_ONLY`:
  - the base passes the target tests 3 of 3
  - a repair's commit fails them 3 of 3, on both stacks; a change is gated by the reference's own patched version passing them 3 of 3
  - `typecheck` and `unit-tests` stay green
  - equal distance across the stacks: the same set of failing tests, fix size within 2×. Also recorded: import hops from the CLI entry to the changed line, seconds to reproduce
  - a pair that fails the gate is dropped, not tuned
- comparison: per task pair, both stacks. `resolved` is expected at the ceiling, so $ and time are the outcome. A one-sided p ≤ 0.05 needs at least 5 pairs in one direction
- tiers: T1 found by reading, T2 needs one mock night, T3 needs a kill or a cancel mid-night, T4 intermittent

Repairs, hardest first:

| id | fault → symptom | target tests | tier |
|---|---|---|---|
| R8 | the sandbox is created outside the durable step → a kill during its creation orphans it | `crash-at-init` (26), `kill-after-row` (55), over 3 verifier runs | T4 |
| R10 | R14, with only the failed night's folder and the service logs given | as R14: `crash-during-test-eval` (24) | T3 |
| R14 | replay after a crash is broken (step ids not deterministic) → the resumed night reruns finished work or stalls | `crash-during-test-eval` (24) | T3 |
| R11 | the runtime blinks for 20 s mid-round (Inngest: the dev server; LangChain: the Agent Server's Postgres and Redis) → the night crashes or never resumes | a new shared hidden test, a 20 s pause of the runtime's containers, which both references pass 5 of 5 first | T3 |
| R15 | the results row and the note are written only at the end of the night → a kill mid-night loses them | `crash-mid-eval` (23), `graceful-restart` (25), `row-per-experiment`, `notes` | T3 |
| R2 | the backstop is checked between rounds only → the evaluation sandbox outlives it | `backstop-mid-step` (53), `stop-during-eval` (20) | T3 |
| R5 | cleanup skipped on an outside cancel → `cc-<id>` left | `outside-cancel` (51), `no-leftover-sandbox` | T3 |
| R12 | the connection from the coder's sandbox to the metering proxy drops and is not retried → the coder's calls fail while the evaluation's work | `meter`, night 1's checks, `spend-zero` | T2 |
| R3 (control) | `continue` loads a mock night as real | `continue` (18) | T1 |

Changes, hardest first:

| id | request | target tests | tier |
|---|---|---|---|
| C7 | a `hard_deadline` config key that aborts the running experiment | `hard-deadline-mid-step` (59), 53 driven by the new key; both references patched first | T3 |
| C2 | `continue` again, on a base with it cut | `continue` (18), `continue-after-stop` (50); `seed` (19) unchanged | T3 |
| C3 | the pause for credits again, on a base with it cut | `pause-timeout` (56), `pause-resume` (57) | T3 |
| C4 | the cancel from outside as a hard stop again, on a base with it cut | `outside-cancel` (51) | T3 |
| C8 | two nights at once, both ending `done` | the first table's rows on both nights. If both references already pass, C8 is replaced by C9 (the stack SDK up one minor version), which needs the operator's dependency approval | T2 |
| C6 (control) | one more config refused at load | `config-rejects` (10) plus the new case | T1 |
| C1 (smoke, never counted) | the test hooks, on `0c395fd` and `9567643` | `backstop-mid-step` (53), `pause-timeout` (56), `pause-resume` (57) | T2 |

- a change on a base with the feature cut: the cut also removes the feature's tests, CLI help and README lines
- a change must be additive: one that alters behaviour an existing test grades breaks the reference rule
- C1 proves the machinery only: its two commits differ in size (Inngest 7 files, LangChain 2), so it compares nothing
- R2 and R3 come from real bugs, each seen on one stack (53 on the LangChain e1 build, `0c395fd` on Inngest), and R5 is close to one (51 failed on the LangChain e1 build, measured 2026-11-16); the other stack's copy is authored and must pass the gate
- first authored and gated: R14 and its control R3, C7 and its control C6. The others follow once a pilot reads clean
- R14's targets narrowed to `crash-during-test-eval` (24), 2026-11-17: at one run per stack, the fault commits `f76da25` (Inngest) and `c3a1ec3` (LangChain) both fail `crash-resume` and 24, only Inngest fails 23, both pass 26 and 1 (no crash fault reaches them), and the LangChain pin passed `crash-resume` only 2 of 3, so it cannot be a target. Its symptom is what 24 saw: Inngest rewrote both rounds' `code-state.json` and recreated their coder sandboxes, LangChain rewrote `reviews/r1.json` and `reviews/r2.json`; the symptom names only the rewritten files. Gate on 24, 3 runs per side: (pending)
- C7 and C6, gated 2026-11-17 (`gate.py c7|c6` on the jobs `reference-inngest-bcabd72-141950`, `reference-langchain-400bd40-143159`, `reference-inngest-1452a93-145054`, `reference-langchain-9d04590-145929`, `reference-inngest-1360cb4-151501`, `reference-langchain-9911231-152722`): the task commit is the maintenance base; the base it is gated against is the reference's own patch, one commit on the maintenance base, Inngest `1452a93` (C7) and `1360cb4` (C6), LangChain `9d04590` and `9911231`. Through `job-configs/reference.sh`, `hidden` only, `CODECLIMB_VERIFIER_ONLY=hard-deadline-mid-step,config-rejects`, 3 runs each: both pins fail 59 and 10 3 of 3 (59: no `stop.json` by 90 s, the evaluation sandbox left; 10: the new case exits 0 and makes a night folder); each C7 patch passes 59 3 of 3 (`stop.json` `hard_deadline` 30 to 31 s after the start, no sandbox left), each C6 patch passes 10 3 of 3; typecheck and unit tests green in every run. Fix sizes: C7 Inngest 33 lines in 4 files (a function that sleeps until the deadline, writes `stop.json`, then sends the night stop), LangChain 23 in 6 (the backstop's timer with its own reason); C6 3 and 5 lines in 2 files each. Import hops 1, reproduce 93 s (C7) and 22 to 26 s (C6). Both pairs pass. One full run per patch (`basic` and `hidden`, `real` skipped; jobs `reference-inngest-1452a93-154613`, `reference-langchain-9d04590-162507`, `reference-inngest-1360cb4-165820`, `reference-langchain-9911231-174044`), the bases' grades for `resolved`: all four 34 of 34 and 37 of 38 hidden, the one failure the other change's test (10 on the C7 patches, 59 on the C6 patches), as on the pins; every other test passes as on the pins
- pilot: one trial per stack of C1, R14, R3, C7 and C6, on the subscription, after the operator's go-ahead. Cost (guess) $1 to $4 a trial
- later: a trace task (read-only: a resumed night's folder and logs, questions the verifier answers from the same files); the tooling arm on R2, R5, R14


### Building `/app`

- `assemble.py <stack>` builds a task's `environment/app/` from files on this branch only: the shared given inputs, `specs/<stack>/given/`, `SPEC.md`, `E2E.md`
- configs: copied from the root `configs/` unchanged
- only files on the branch or about to be: tracked, or untracked and not ignored (`git ls-files --cached --others --exclude-standard`), so a stray `.env`, `node_modules/` or `__pycache__/` never reaches `/app`
- the reference SHAs it scans for are constants in `assemble.py`: update them when a reference is re-pinned
- `SPEC.md`: the build spec with `[[note|alias]]` → `alias` and `[[#Section]]` → `Section`. The build specs themselves are kept clean of the repo path, commit SHAs, issue numbers, branch names, this benchmark, and any skill or MCP an arm carries
- fail the assemble, naming each file and string, if the output contains a commit SHA of a reference build, `01-Projects` or `codeclimb-eval-spec` (anywhere), or `benchmark` or the name of a skill pack or MCP server (`pocock`, `langchain-skills`, `langsmith-skills`, `langchain-mcp`, `langsmith-mcp`, `langchain-docs`, `inngest-dev`), case-insensitive
  - the second group is checked only in the files the benchmark writes (`SPEC.md`, `E2E.md`, `AGENTS.md`, `given/`): the shared given inputs are vendored unchanged, and the graphrag corpus discusses benchmarks and names a skill author
  - not checkable by name: the `inngest` plugin and the `langsmith` MCP, whose names the build specs use for the stack itself
- the `AGENTS.md` stub is one line, `<!-- harbor-canary GUID … -->`, without Harbor's usual "BENCHMARK DATA …" sentence
- the shared given inputs in `/app` are `scenarios/`, `configs/`, `docker/`; `LICENSE` stays out
- Inngest `given/`: main's `.gitignore` with `runs/` replaced by `runs-inngest/` plus `generated/`, the build spec's folders. `package.json` holds `inngest` 4.25.0 only and two scripts: `dev:inngest` (the CLI pinned at `inngest-cli@1.52.0`, pointed at `http://localhost:3000/api/inngest`, discovery off) and `hello` (`INNGEST_DEV=1 node src/hello.ts`: Node 24 runs TypeScript, so no `tsx`). `src/hello.ts` serves the `hello-world` function on `test/hello.world` at that URL. Checked 2026-11-12: `npm ci --ignore-scripts` exits 0 and the dev server lists `codeclimb-hello-world`
- LangChain `given/`: what the LangChain build spec's "What you get" calls the scaffold, from the branch's scaffold commit `1025cea`: `package.json` with the LangGraph and LangSmith packages, `yaml`, `zod`, `tsx`, `typescript` and `@types/node` at the build spec's versions, and the scripts `server` (a placeholder: `langgraphjs dev` on `127.0.0.1:2024`), `typecheck`, `build:image`, `build:image:graphrag`, `build:dataset`; `langgraph.json` with the one graph `hello` (`./src/hello.ts:graph`) and `env: .env`; langchain's `.env.example` and `tsconfig.json`; its `.gitignore` with `runs/` replaced by `runs-langchain/` plus `generated/` (the duplicate trailing `runs-langchain/` dropped). The build spec, not "the stack SDK only", decides this stack's `package.json`. Checked 2026-11-12: `npm ci --ignore-scripts` and `npm run typecheck` exit 0; with a `.env` present, `npm run server` serves `hello` and a run returns `Hello, x`
- `specs/langchain/e2e.md` is the Inngest one with only the service commands (`npm run server`, the `.env` key, `docker kill` of the server container) and the runs folder changed, as the two done signals differ
- records the sha256 of `SPEC.md`, of the given inputs (every other file of `/app` except `E2E.md` and `AGENTS.md`) and of the pile (`specs/<stack>/tickets/`), for `trials.jsonl`, in `tasks/codeclimb-<stack>/assembled.json` (gitignored). A tree's sha256 is over its sorted `<path> <file sha256>` lines
- `git init` and the one commit happen in the task image, not in the assemble
- tests: `python3 -m unittest assemble_test`

## Open points

- maintenance tasks: the pilot's cost per trial (guess $1 to $4); whether both references already run two nights at once (C8); whether a 20 s runtime pause can be made the same on both stacks (R11)
- how a subscription usage-limit stop shows in a trial: read from the sources, not triggered (see Jobs, repeats, cost). The first one in phase B confirms the `analyze.py` rule
