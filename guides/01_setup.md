# Setup

After this guide `npm test` passes, the `codeclimb-python` image exists, `.env` holds a LangSmith key, and Pi has credentials for every model your config names (or you run `--mock`, which needs none).

This branch (`langchain`) builds CodeClimb on LangGraph JS, the self-hosted Agent Server and LangSmith. The [Inngest](https://inngest.link/dai-gh) build is on `main`.

## Prerequisites

| Tool | Min version | Purpose | Install |
|---|---|---|---|
| Node.js | 24 | The CLI, the worker API and the Next.js app; the server image runs Node 24 too | [nodejs.org](https://nodejs.org) |
| Docker | Docker Desktop or Engine, running | The Agent Server stack (server, Postgres, Redis), coder and evaluator sandboxes, the `cc-meter` network | [docker.com](https://docs.docker.com/get-docker/) |
| git, tar, bash | any | Export and the experiment repository on the host | Ships with macOS and Linux |
| Python 3 | 3.x on the host | Dataset and scenario builders (`npm run build:dataset*`, `build:scenario:overfit`) | [python.org](https://www.python.org) |
| uv | any | `npm run lessons` by hand on graphrag; the server image has its own | [install](https://docs.astral.sh/uv/) |

## Install

```bash
git clone -b langchain https://github.com/decodingai-magazine/codeclimb.git codeclimb-langchain
cd codeclimb-langchain
npm ci --ignore-scripts
cp .env.example .env
```

`.env` is gitignored. The CLI, the worker API and the Agent Server container all read this one file (`src/env.ts`, and `env` in `langgraph.json`); variables already set in the shell win. In a git worktree, symlink the main checkout's `.env` instead of copying it.

Check the install:

```bash
npm test
```

Prints `ℹ tests 131` and `ℹ fail 0` (measured on `9567643`). After a code change also run:

```bash
npm run typecheck
```

## Sandbox image

Every scenario runs on `codeclimb-python` (Python 3.14, git, uv), built from `docker/python.Dockerfile`:

```bash
npm run build:image
```

graphrag needs `codeclimb-graphrag` on top of it (`docker/graphrag.Dockerfile`, the scenario's fixed `requirements.txt`):

```bash
npm run build:image:graphrag
```

`docker images` then lists `codeclimb-python` (and `codeclimb-graphrag`).

## Environment variables

| Variable | Required | Read by | Purpose |
|---|---|---|---|
| `LANGSMITH_API_KEY` | Yes, even for mock nights | The Agent Server, `src/tracing.ts` | The server does not boot without it; also tracing and feedback. [Create a key](https://docs.langchain.com/langsmith/create-account-api-key) under **Settings → API Keys** |
| `LANGSMITH_TRACING` | No (`.env.example`: `true`) | `src/tracing.ts` | `false` sends no traces (saves the free plan's 5k traces/month); the key is still needed |
| `LANGSMITH_PROJECT` | No (default `codeclimb`) | `src/tracing.ts` | The tracing project runs land in |
| `LANGSMITH_ENDPOINT` | For an EU key | LangSmith client | `https://eu.api.smith.langchain.com`; a key used against the other region gets 403 with an empty message |
| `LANGSMITH_WORKSPACE_ID` | When the key reaches several workspaces | LangSmith client | The workspace to trace into |
| `ANTHROPIC_API_KEY` | For `anthropic/<id>` models | Pi, through `src/pi/models.ts` | Pi coder and reviewer on Anthropic; [console.anthropic.com](https://console.anthropic.com) |
| `OPENCODE_API_KEY` | For `opencode/<id>` and `opencode-go/<id>` | Pi, through `src/pi/models.ts` | One key for OpenCode Zen and Go |
| `OPENROUTER_API_KEY` | For `openrouter/<id>` models | `src/pi/models.ts`, `src/meter/backends.ts`, `src/pi/check.ts` | Coders, or the program's models in `allowed_models`; [openrouter.ai/keys](https://openrouter.ai/keys) |
| `OPENAI_API_KEY` | No | `src/meter/backends.ts` | Embeddings key when Pi resolves none for `openai` |
| `CODECLIMB_PI_AUTH_PATH` | No (default `~/.pi/agent/auth.json`) | `src/pi/models.ts`, `src/cli/server.ts` | Another Pi credentials file; mounted at `/pi/auth.json` in the server container |
| `CODECLIMB_SERVER_URL` | No (default `http://127.0.0.1:8123`) | `src/control.ts` | Where the CLI and the worker API reach the Agent Server |
| `CODECLIMB_ROOT` | No (default: cwd) | `src/night/types.ts` | The checkout config paths and `runs-langchain/` resolve against |
| `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT` | No (default `127.0.0.1:7421`) | `src/cli/api.ts` | Where the worker API binds |
| `CODECLIMB_WORKER_TOKEN` | When the API binds off loopback | `src/cli/api.ts`, `web/app/api/worker/[...path]/route.ts` | Bearer token for every API route |
| `CODECLIMB_WORKER_URL` | No (default `http://127.0.0.1:7421`) | `web/app/api/worker/[...path]/route.ts` | Where the app reaches the worker API |

`npm run server` sets the rest for the server container through `docker/langgraph-up.compose.yaml`: `CODECLIMB_HOST_ROOT`, `CODECLIMB_HOST_GIT_DIR`, `CODECLIMB_HOST_PI_AUTH`, `CODECLIMB_PROXY_HOST`, `CODECLIMB_PROXY_PORT`, `CODECLIMB_RELAY_TARGET`, `N_JOBS_PER_WORKER`, `BG_JOB_TIMEOUT_SECS` and the `UV_*` paths. Leave them out of `.env`.

## External services

### LangSmith

Required: the Agent Server checks the key at boot and exits with code 3 without it. Sign up at [smith.langchain.com](https://smith.langchain.com) (free Developer plan: 5,000 traces a month, 50,000 events an hour; [pricing](https://www.langchain.com/pricing)). Fills `LANGSMITH_API_KEY`, and optionally `LANGSMITH_TRACING`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID`.

- **What it holds.** One trace per experiment, evaluation and review, each tagged with `night_id` and `exp_id`; dev metrics mirrored as feedback on the experiment's trace. [LangSmith observability](https://docs.langchain.com/langsmith/observability).
- **Read-only.** No decision ever reads a trace or feedback: `results.jsonl` and `experiments.git` are the source of truth.
- **Volume.** A 72-round night writes about 250 traces. `LANGSMITH_TRACING=false` switches all of it off.

`.mcp.json` points a coding agent at the LangSmith MCP (`https://eu.api.smith.langchain.com/mcp`) for reading traces.

### Pi model providers

Pi drives the coders and the reviewer. It runs inside the Agent Server process, never in a sandbox, so credentials stay out of sandboxes. `model`, `reviewer_model` and `allowed_models` take `<provider>/<id>`:

| Provider | `<provider>` | Credentials | Example model | Billing |
|---|---|---|---|---|
| GitHub Copilot | `github-copilot` | `npx pi`, then `/login github-copilot` | `github-copilot/claude-haiku-5.5` | Subscription |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY`, or `npx pi` then `/login anthropic` | `anthropic/claude-haiku-5-5` | Paid API |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY`, or `/login opencode` | `opencode/kimi-k3` | Credits |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY`, or `/login opencode-go` | `opencode-go/kimi-k3` | Subscription |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-haiku-4.5` | Paid API, catalog prices |

- `/login` writes `~/.pi/agent/auth.json`, which `npm run server` mounts read-write into the server container (Pi writes refreshed subscription tokens back).
- The same model has different ids per provider: Copilot uses dots (`claude-haiku-5.5`), Anthropic and OpenCode use dashes (`claude-haiku-5-5`). List the ids of every provider with credentials:

  ```bash
  npx pi --list-models haiku
  ```

- `reviewer_model` is compared to `model` as a string, so `anthropic/claude-haiku-5-5` reviewing `github-copilot/claude-haiku-5.5` passes validation but is the same model critiquing itself.
- `coder_thinking` (default `medium`) and `reviewer_thinking` (default `low`) set Pi's effort.
- `run-night` checks every model before it starts (`src/pi/check.ts`), and the server checks again with its own credentials. The check finds missing keys, not wrong ones: a bad key fails the first model call as `agent_error`.

### OpenRouter

Paid, catalog prices. Fills `OPENROUTER_API_KEY`. Used for coders on `openrouter/<id>` and for the program's own model calls in `allowed_models`, which the metering proxy forwards directly (not through Pi) and charges at the `usage.cost` OpenRouter reports.

## Cost

`coder_usd` and the `budget_usd` caps use Pi's catalog prices for every provider: real spend for an Anthropic key, OpenRouter or Zen credits; an estimate for the Copilot and Go subscriptions. LangSmith stays free on the Developer plan.

| Run path | Config | Cap (`budget_usd.night`) | Paid with |
|---|---|---|---|
| Mock night | any, with `--mock` | $0, no provider called | Nothing (a free LangSmith key) |
| Smoke nights | `capitals-smoke`, `datenorm-smoke`, `graphrag-smoke` | $0.50 | Copilot subscription (estimate) |
| Full datenorm | `datenorm.yaml` | $3.00 | Copilot subscription (estimate) |
| Full graphrag | `graphrag.yaml` (Opus 5.5 coder and reviewer, 4 OpenRouter models for the program) | $60 | Anthropic key + OpenRouter |

For scale: a 26-round graphrag night on Opus 5.5, on the Inngest twin, ran 11.8 hours for $74.63, of which about $3.50 was the program's OpenRouter calls.

Next: [02_running.md](02_running.md)
