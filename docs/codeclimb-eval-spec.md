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
- like for like: both stacks are local only (Inngest dev server and one worker; `langgraphjs up`), with Docker sandboxes, the same scenarios, the same night configs, the same seven mock nights and the same checks
- a cross-stack claim is made only on checks both stacks share, and only once both reference builds pass the verifier
- cut from the earlier design: experiments per hour, `t_provision` and `t_teardown`, setup hours, backend LOC as a comparison of hand-run nights
- no trial and no check needs a provider key: every graded night runs with `--mock`. A real-model night needs a model credential for the coder and the reviewer whatever the scenario, and `capitals` also for the model its program calls. So the benchmark never uses a provider key: the paid night 8 is out of both piles and both done signals, and no real-model night is run on any build. `graphrag-smoke` (night 7) stays graded, since it needs no key under `--mock`

## Benchmark

- question: which piece of each ecosystem's agent context (skills, or MCP + docs) helps a harness most when it builds CodeClimb from its build spec, and at what cost
- primary claim: within a stack, the skills and MCP + docs effects of a 2 × 2
- unit: one Harbor trial = (stack × arm × workflow). Zero human input
- harness: Claude Code on Opus 5.5 (`anthropic/claude-opus-5-5`), effort `medium`, on the operator's Claude subscription; model id, effort and CLI version pinned. One harness and one model only: Codex is cut
  - effort: Harbor's `claude-code` agent takes it as `kwargs.reasoning_effort` (`low` … `max`) and passes `--effort <level>` to `claude` (read from its source, Harbor 0.25.0). Measured 2026-11-13: the trial log's command line has `--effort medium`, the session file records `"effort":"medium"`; the ATIF trajectory and the stream's init event do not carry it. Model: `agent_info.model_info.name` and every agent step's `model_name` are `claude-opus-5-5`
  - probes: `job-configs/probes/run.sh <probe>...` runs short trials in the Inngest trial environment, the task's instruction replaced by a template from `job-configs/probes/` and no verifier: `one-line`, `network`, `search`, `budget`, `big`. They use the subscription ($0.86 in all on 2026-11-13; each trial's environment setup takes about 21 s with a warm image)
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
- `task.toml`: `[agent] timeout_sec = 28800`, `[verifier] timeout_sec = 10800` (placeholders until phase B; the verifier's own limits sum to about 9100 s, so a hung build still gets a `reward.json`), `environment_mode = "separate"`; `artifacts = [{ source = "/app", exclude = [".env", "node_modules", "runs-inngest", "runs-langchain"] }, { source = "/logs/agent/sessions/projects" }]` (the second carries the harness's session files to the leak scan); `cpus`, `memory_mb`, `storage_mb` set after the reference gate
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
  - LangChain: decided with its arms (#49)
  - why: Claude Code connects to MCP servers once, at start, and does not reconnect (Arms), so `inngest-dev` works only if the dev server is up before `claude` starts. A real developer has these services running when they start a session
- not the host socket: `cc-meter` and `cc-meter-relay` are global names, and `docker ps` checks would see other trials. Fallback: host socket + one trial at a time
- the verifier needs the same daemon: `tests/docker-compose.yaml` holds the same topology for the separate verifier environment. Job-level mounts and `extra_docker_compose` are agent-only. `artifacts` re-upload `/app` to the same path in the verifier, dropping symlinks (fine: it runs `npm ci`). The host fallback (`verifier/run.py --app <artifact dir> --stack <s>` after the job) is not needed on local Docker; it stays for a provider without Docker-in-Docker

### Network: everything except GitHub

- the repo stays public, so the harness never reaches GitHub; it can reach everything else, web search included
- Harbor has only `public`, `allowlist` and `no-network`, no denylist. So `network_mode = "public"` plus 3 layers:
  - DNS: `extra_hosts` on the `dind` service in `environment/docker-compose.yaml` maps each blocked host to `0.0.0.0`; `main` shares its `/etc/hosts` (on `main` itself Docker rejects `extra_hosts` beside the shared network mode). Measured: `curl https://github.com` fails in `main`, `npm ci` passes. No wildcards: every host name needs its own entry. The harness runs as root and could edit `/etc/hosts`; layer 3 catches that
  - harness: Claude Code deny rules `WebFetch(domain:<host>)` for each blocked host and its `*.` subdomains, in the trial's managed settings (`assemble.py` writes them into each task's `environment/managed-settings.json` from `verifier/blocked_hosts.py`; the Dockerfile installs them at `/etc/claude-code/managed-settings.json`). Measured 2026-11-13 in the Inngest trial environment under `bypassPermissions`: `WebFetch` of the repo page, `api.github.com` and `raw.githubusercontent.com` returns `WebFetch denied access to domain:<host>`, while `www.inngest.com/llms.txt` and `docs.langchain.com/llms.txt` load. The LangChain image installs the same file; it was built, not probed
  - detection: the verifier's leak scan (`verifier/leak.py`, run before any stage touches `/app`) looks for a blocked host (any subdomain) or the repo owner (`decoding ai magazine`, with or without `-`, `_` or spaces; `codeclimb` alone is in the contracts) in what the harness did, not in what it read: the given inputs name `github.com` (16 files) and the owner (30 graphrag corpus files) themselves
  - network routes only, for blocked hosts: a build is asked to name GitHub hosts in its own code (the coder sandbox's web block), and npm lockfiles carry `github.com` metadata. On the LangChain reference, a rule that counts every host the build wrote finds 20 hits in 6 files (`src/pi/web.ts` and its tests, 110 lockfile URLs), so a host counts only where it can reach the network. The owner counts anywhere the harness wrote it. It reads:
    - the session files (`/logs/agent/sessions/projects/**/*.jsonl`, subagents included, carried by `artifacts`): blocked hosts in the input of `WebFetch`, `WebSearch`, `Bash` (a `docker run` included) and any MCP tool, and in `WebSearch` results; the owner in any tool's input (a file written or edited included) and in `WebSearch` results. Not `WebFetch` results: docs pages link GitHub all the time
    - `/app` without `.git`, `node_modules`, `.venv`, caches, the runs folders, `generated/` and `.env`, in each file the harness wrote or changed: the owner anywhere; blocked hosts only in a Dockerfile's `RUN` and `ADD` instructions, `package.json` dependency specs (`github:` included) and `package-lock.json` `resolved` URLs. A given file counts only for names beyond those it held as given: `assemble.py` writes the baseline, each given file's sha256 and these names, to the task's `tests/verifier/given.json`
    - accepted gaps: a shell heredoc that writes a host into a file counts (a shell command); a host in other code the build runs (a script that fetches) does not. Both are read by hand when a trial is reported apart
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
- Inngest arm smoke (#48, 2026-11-13, `job-configs/probes/arm-smoke.sh inngest <arm>...`: the arm's job file with one attempt, no verifier and a probe prompt; about $0.07–0.10 each): `bare` has 17 built-in skills, no MCP server, no extra prompt; `skills` has the 14 Inngest skills in `$CLAUDE_CONFIG_DIR/skills/` and the skills pointer in the prompt, no MCP; `mcp-docs` has `inngest-dev` registered and the docs block in the prompt, no Inngest skills; `full` has both. With the dev server pre-started, `mcp-docs` reports `inngest-dev` `connected` with 52 tools and called `get_apps` (37 s trial)
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
  - tickets are local files, never GitHub or another tracker. The setup skill's output is pre-written and added per job through a mount (`--mounts` on the command line, with an absolute source path): `docs/agents/issue-tracker.md` (local markdown, `.scratch/codeclimb/issues/<NN>-<slug>.md`, spec at `.scratch/codeclimb/spec.md`), `docs/agents/domain.md` (single-context), and an `## Agent skills` block in the `AGENTS.md` stub (verified: a read-only bind mount of a host dir shows up in the harness's `/app`; the harness copies files out of it). No `triage-labels.md`
  - the template defines the closed state: `/implement` sets `Status: done` once the ticket's acceptance criteria pass
- invocation (verified with a `disable-model-invocation: true` dummy skill): a user-only skill runs only from the prompt template's first line, never from the model. `/implement` is called once per ticket by the model, so the vendored copy drops `disable-model-invocation`
- logged on top of the metrics: pile sha256, ticket count, tickets done, commits, `tdd` / `code-review` calls, compactions, $ and tokens per subagent (`code-review` runs 2 in parallel)
- result: Δ`reward`, Δ`done`, Δ$ and Δwall-clock of `full × pocock` vs `full × one-shot`, per stack. The tickets and the per-ticket loop are not separated

### Verifier

- the checks are identical on both stacks: the seven mock nights of "Goal and done signal", which is the same list in both build specs. $0, no provider credentials
- `reward` = checks passed / N, a fraction in [0, 1]; equal weights; no `solution/solve.sh`. N is fixed when both reference builds pass, and is the same number on both stacks
- the checks, each counted once:
  - 5 build checks, in build order, so a half-built app scores above empty given inputs: `install` (`npm ci --ignore-scripts` exits 0), `typecheck`, `unit-tests` (`npm test`), `image` (`build:image` gives `codeclimb-python`), `services-up` (the stack's services answer within 60 s)
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
- grading from the host: `verifier/grade.sh <build dir> <stack> [<out dir>]` runs the verifier image and topology of `tasks/codeclimb-<stack>/tests/` with plain `docker compose`, the build copied into its `/app` volume, so a host run gets its own daemon and never meets another stack's `cc-meter` or `:8123` on the host
- measured 2026-11-12, `langchain@2ab1ad3` (the branch head, with `results_path` relative to the runs folder) through `grade.sh`: the 5 build checks and the 14 first-table rows all pass, in 225 s
- measured 2026-11-12, same build, all seven nights through `grade.sh`: 34 of 34, `done` = 1, three runs in a row; the verifier's wall-clock 408 s, 392 s, 392 s (nights 1 to 7 take about 6, 11, 6, 6, 130, 41 and 34 s; night 5 waits for the runs sweeper). Night 5 killed the server container once round 2 had started; only round 2's and the test's sandboxes were created after the kill
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

- later, not in the reward: hidden contract checks the mock nights don't reach. Add them as a separate key only if `done` saturates (most trials pass):
  - `pins`: resolved versions equal the build spec's table; every contract npm script exists
  - `validator-fixtures`: `validate-results` accepts 3 good files, rejects 5 bad ones
  - `config-rejects`: reviewer = coder, unparsable deadline, threshold ≤ 0, invalid night id → non-zero exit
  - `held-out-night`: a mock night on a config the harness never saw passes the common check table
  - `stop-deadline`, `stop-thresholds`: one mock night each, `stop_reason` forced by config
  - `test-once`: exactly one `test` row in every night
  - `checkpoint-lineage`: each round's commit parent is the last kept commit (`experiments.git`)
  - `scoring-hashes`: `night.json.metric_script_sha256` equals the verifier's map; `scenarios/` and `configs/` byte-identical to the given inputs
  - `sandbox-isolation`: during a mock night no coder container holds `gold/`, `evaluators/` or a provider key
  - `pi-isolation`: canaries in `~/.claude/CLAUDE.md` and the `/app/AGENTS.md` stub are absent from all `exps/*/session/` files
  - `worker-api`, `continue`, `seed`: one probe each, per their build spec sections
  - now in the reward through the seven nights, so off this list: plateau, hard stop, crash resume

### Reference builds

- a reference build proves the verifier before any trial is graded. Both stacks have one
- Inngest: `main`, at a new commit that adds what the Inngest build spec gained: `--mock-offline`, `configs/e2e/plateau.yaml`, the `runs-inngest/` results directory, and the normalized configs. Until that patch lands the pin is `e384bb5`, which cannot run nights 3 and 6 (read from the code: no `--mock-offline`, no `configs/e2e/`; not run)
- LangChain: `langchain`, at a new commit with the `results_path` relative to the runs folder. Until then the pin is `bce6a16`
- configs are normalized across `main`, `langchain` and this branch, with `langchain`'s as the source of truth
- rule: never grade a harness on a check a reference build fails. A build spec change that alters a check needs the reference to pass it; otherwise the check is dropped on both stacks
- dropped on both stacks under this rule: night 7's check that a dev evaluation has a `metrics.json` only when every stage was scored. The stacks differ there (Inngest writes it only then, LangChain always), so the done signals check only that the test evaluation has one
- the build specs are still being improved, so the pinned commits are re-checked by the reference gate after every spec change that touches the done signal
- each build spec's "Known gaps" lists places where the spec asks more than its reference does. If a reference fails a check inside the trial image, patch the reference or drop the check

### Gates before any trial

| gate | pass condition |
|---|---|
| reference | the verifier scores `done` = 1 on each stack's reference build |
| flake | the verifier run 3× on each reference build gives 1 each time |
| floor | Harbor's `nop` agent (given inputs only) passes no night check. Its `reward` is the floor, reported beside every cell |
| blocklist | from inside a trial, `curl github.com` and a `WebFetch` of the repo both fail; `inngest.com` and `docs.langchain.com` load |
| transcripts | 2 failed + 2 passed trials read; scores match what happened |

- measured floors (2026-11-12, build checks only): Inngest 0.2 (`install`); LangChain 0.6 (`install`, `typecheck`, `image`), because its build spec gives a scaffold with `typecheck` and `build:image` scripts. Floors differ by stack, one more reason to compare arms within a stack only. The LangChain floor's verifier takes 16 min, most of it the 600 s wait for a `npm run server` that never returns (the scaffold's placeholder serves on 2024, not 8123)

### Jobs, repeats, cost

- one job file per (stack × arm), in `job-configs/`: `n_attempts`, `n_concurrent_trials: 1` (one subscription), `retry.max_retries: 1`, `retry.exclude_exceptions`, `agents[].override_timeout_sec`, `artifacts`
  - `exclude_exceptions` replaces Harbor's default list (`RetryConfig` in Harbor 0.25.0), so the job file writes it whole: the default `AgentTimeoutError`, `VerifierTimeoutError`, `RewardFileNotFoundError`, `RewardFileEmptyError`, `VerifierOutputParseError`, `ApiUsageLimitError`, `AgentSafetyRefusalError`, `AgentAuthenticationError`, `ModelNotFoundError`, `UnsupportedModelParametersError`, plus `NonZeroAgentExitCodeError` and `UnknownApiError` (see telling the stops apart). Otherwise a timed-out 8-hour trial runs again
- every trial runs on the subscription. `cost_usd` is Claude Code's own estimate at API prices (`total_cost_usd` of the stream's `result` event, `modelUsage.*.costBasis` = `list`), the only $ figure. Harbor's per-model `model_usage.*.cost_usd` is its own LiteLLM estimate and differs (measured: $0.031 against Claude Code's $0.048 for the same turn); use `agent_result.cost_usd`
- a per-trial cap, `kwargs: { max_budget_usd }`, set to 2× the costliest phase-B trial. Measured 2026-11-13 with a $0.01 cap on the subscription: it counts the same estimate and stops the trial, but only after the turn that crosses it (the trial spent $0.04, 3 turns). Claude Code ends with result `subtype` `error_max_budget_usd`, `terminal_reason` `budget_exhausted`, exit 1; Harbor records `NonZeroAgentExitCodeError` (no `BudgetExceededError`). Its policy group, `UNCLASSIFIED`, grades the build but sets Harbor's `reward_valid` false (read from `error_policy.py`; the probe ran without a verifier). Harbor 0.25.0 has no `override_error_policy`; `analyze.py` counts a capped trial's reward, so the expensive failures stay in the mean
- size of the job: the Inngest reference is ~8,900 lines of TypeScript + ~2,000 of tests. C + D + D2 = 30 trials; what they take from the subscription is unknown until B
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

- each phase from B on starts only with the operator's go-ahead
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
context/pocock/scaffold/            docs/agents/issue-tracker.md, domain.md, AGENTS.md block
context/pocock/prompt.md            "/implement per ticket, frontier first" + {{ instruction }}
job-configs/<stack>-{bare,skills,mcp-docs,full,full-pocock}.yaml    plus topology-check.yaml
job-configs/probes/                 the harness probes: run.sh and its prompt templates (subscription)
jobs/                               Harbor's job output, gitignored
assemble.py                         given inputs + SPEC.md + E2E.md → a task's environment/app/; the pile → the pocock mount
analyze.py, analyze_test.py         job dirs → trials.jsonl → 2 × 2 effects; so far the lever counts
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
    kwargs: { reasoning_effort: medium, max_budget_usd: "<cap>" }   # the cap is added after phase B
extra_instruction_paths: [context/inngest/skills-pointer.md, context/inngest/docs-block.md]
```

- other arms: `bare` drops `skills`, `mcp_servers` and `extra_instruction_paths`; `skills` keeps `skills` and only the skills pointer; `mcp-docs` drops `skills` and keeps only the docs block. `full-pocock` adds the pocock skills, `kwargs.prompt_template_path: context/pocock/prompt.md` and, on the command line, `--mounts` of `context/pocock/scaffold/` and the assembled pile (→ `/app/.scratch/codeclimb/issues/`) into `/app`
- checked in `harbor job schema`: `mcp_servers[].transport` is `stdio`, `sse` (default) or `streamable-http`; `extra_instruction_paths` is job-level; `kwargs.prompt_template_path` must name `instruction` (the probes wrap it in `{% if false %}`)
- commands:
  - topology check, $0: `tasks/topology-check/run.sh`
  - assemble a task: `python assemble.py <stack>`
  - check a config, $0: `harbor run -c job-configs/<file>.yaml --print-config`
  - floor gate: `harbor run -p tasks/codeclimb-<stack> -a nop`
  - reference gate: `verifier/run.py --app <git archive of the reference commit> --stack <stack> --out <reward.json>`, 3×
  - every phase: `harbor run -c job-configs/<file>.yaml`, arm files in shuffled order. The `full-pocock` files also need `--mounts` with absolute paths, so they run through a small script, as `tasks/topology-check/run.sh` does
  - regrade after a verifier fix: `source_jobs` in a job file
  - analysis: `python analyze.py ./jobs`

### Metrics

- one row per trial in `trials.jsonl`: stack, arm, workflow, harness + CLI version, model id, effort, attempt, `exception_type`, `reward_valid`, `reward`, `done`, per-check results, `leak`, agent wall-clock, verifier wall-clock, tokens (in / out / cache), agent $, turns, tool calls, skill / MCP / doc-fetch counts, skill digests, spec sha256, given-inputs sha256, task hash, Harbor version, start time
- sources (field names measured on the subscription, 2026-11-13): trial `result.json` → `agent_result.cost_usd`, `n_input_tokens` (input + cache read + cache creation), `n_cache_tokens` (cache read), `n_output_tokens`, per-model `model_usage`; `agent_info.version` and `model_info.name`; phase timings `environment_setup`, `agent_setup`, `agent_execution`, `verifier`, each `{started_at, finished_at}`; `agent/trajectory.json` → `steps` and `final_metrics.total_steps`, with cache creation in `final_metrics.extra.total_cache_creation_input_tokens`; `agent/claude-code.txt` (the stream) → the `result` event's `num_turns`, `subtype`, `terminal_reason` and `subagent_stats`. Effort: the session file under `agent/sessions/`
- outcome per cell: the 3 `reward` values plotted, mean, min–max; `done` as k/3; per-check pass counts show where builds break
- arm value: the 2 × 2 effects on `reward` and $, within a stack. Exact permutation test over trials; at 3 vs 3 the smallest one-sided p is 0.05; pooled 6 vs 6 main effects go down to 0.001. Direction fixed before the run (`full` > `bare`). Claim an effect only at p ≤ 0.05, else "not detectable at n = 3"
- false-done rate: trials whose last message claims done while `done` = 0
- did the harness run `E2E.md` itself (trajectory): yes / no
- glue-code LOC: `cloc` of the build minus the given inputs
- code quality: binary judge checklist (durable primitive per experiment: `step.invoke` / `task`; no secrets in sandboxes; no hardcoded thresholds), a different model family as judge, its own reward key, off until it agrees with Paul on 5 builds
- cut: the API-key cross-check of `cost_usd` (no API key is used), "errors from non-existent framework APIs" (no cheap, reliable count), observability scoring (nothing checks it)

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

- how a subscription usage-limit stop shows in a trial: read from the sources, not triggered (see Jobs, repeats, cost). The first one in phase B confirms the `analyze.py` rule
