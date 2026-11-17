# Setup

After this guide `npm test` passes, the `codeclimb-python` image exists, and Pi has credentials for every model your config names (or you run `--mock`, which needs none).

## Prerequisites

| Tool | Min version | Purpose | Install |
|---|---|---|---|
| Node.js | 20 | The worker, the CLI and the Next.js app | [nodejs.org](https://nodejs.org) |
| Docker | Docker Desktop or Engine, running | Coder and evaluator sandboxes, the `cc-meter` network | [docker.com](https://docs.docker.com/get-docker/) |
| Python 3 | 3.x on the host | Dataset builders (`npm run build:dataset*`) | [python.org](https://www.python.org) |
| uv | any | graphrag's host-side evaluators run through `uv` | [install](https://docs.astral.sh/uv/) |
| cloudflared or ngrok | any | Only for [Inngest](https://inngest.link/dai-gh) Sandboxes with `allowed_models`: a public URL for the metering proxy | `brew install cloudflared`, or [ngrok](https://ngrok.com) |

## Install

```bash
git clone https://github.com/decodingai-magazine/codeclimb.git
cd codeclimb
npm ci --ignore-scripts
cp .env.example .env
```

`.env` is gitignored. One file serves local and cloud mode; `npm run worker`, `npm run run-night`, `npm run lessons` and the smoke scripts load it through `codeclimb/env.ts`, and variables already set in the shell win.

Check the install:

```bash
npm test
```

Prints `ℹ tests 111` and `ℹ fail 0` (measured on `0c395fd`).

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

## Inngest dev server config

`inngest.json` points the dev server at `http://localhost:3000/api/inngest` and turns off auto-discovery. `npm run dev:inngest` passes `--ignore-scripts=false --allow-scripts=inngest-cli` to `npx`, because the CLI downloads its binary in a postinstall script and npm 12 needs `--allow-scripts` to run it.

The dev server exposes an MCP endpoint at `http://127.0.0.1:8288/mcp` (configured in `.mcp.json`) for listing functions, sending events and checking runs from a coding agent.

> [!WARNING]
> Never put `INNGEST_DEV` in `.env`: cloud mode shares that file, and the SDK would quietly use the dev server instead of Inngest Cloud.

## Environment variables

| Variable | Required | Read by | Purpose |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | For `anthropic/<id>` models | `codeclimb/pi/session.ts` | Pi coder and reviewer on Anthropic; [console.anthropic.com](https://console.anthropic.com) |
| `OPENCODE_API_KEY` | For `opencode/<id>` and `opencode-go/<id>` | `codeclimb/pi/session.ts` | One key for OpenCode Zen and Go |
| `OPENROUTER_API_KEY` | For `openrouter/<id>` models | `codeclimb/pi/session.ts`, `codeclimb/meter/openrouter.ts` | Coders, or the program's models in `allowed_models`; [openrouter.ai/keys](https://openrouter.ai/keys) |
| `OPENROUTER_BASE_URL` | No (default `https://openrouter.ai/api`) | `codeclimb/meter/openrouter.ts` | Another OpenRouter endpoint, for tests |
| `CODECLIMB_PI_AUTH_PATH` | No (default `~/.pi/agent/auth.json`) | `codeclimb/pi/session.ts` | Another Pi credentials file |
| `INNGEST_EVENT_KEY` | Cloud mode only | `codeclimb/env.ts` | Inngest dashboard, **Manage → Event Keys** |
| `INNGEST_SIGNING_KEY` | Cloud mode only | `codeclimb/env.ts` | Inngest dashboard, **Manage → Signing Key** |
| `CODECLIMB_ENV` | Set by the `:cloud` scripts | `codeclimb/env.ts` | `cloud` requires both Inngest keys and pins the proxy port to 7422 |
| `INNGEST_DEV` | Set by the local scripts | `codeclimb/env.ts`, `scripts/worker.ts` | `1` puts the SDK in local mode; never in `.env` |
| `CODECLIMB_API_HOST` | No (default `127.0.0.1`) | `codeclimb/api.ts` | Where the worker API binds |
| `CODECLIMB_API_PORT` | No (default `PORT`, else `7421`) | `codeclimb/api.ts`, `scripts/worker.ts` | Worker API and metering proxy port |
| `PORT` | No | `codeclimb/api.ts` | API port on a host that sets it, when `CODECLIMB_API_PORT` is unset |
| `CODECLIMB_WORKER_TOKEN` | When the API binds off loopback | `codeclimb/api.ts`, `app/api/worker/[...path]/route.ts` | Bearer token for every request but `/v1` |
| `CODECLIMB_WORKER_URL` | No (default `http://127.0.0.1:7421`) | `app/api/worker/[...path]/route.ts` | Where the app reaches the worker API |
| `CODECLIMB_PROXY_HOST` | On Linux Docker | `codeclimb/meter/index.ts` | The `docker0` address, such as `172.17.0.1`; Docker Desktop uses `host.docker.internal` |
| `CODECLIMB_PROXY_PORT` | No (random locally, 7422 in cloud) | `codeclimb/meter/index.ts`, `codeclimb/env.ts` | Pins the metering proxy port |
| `CODECLIMB_METER_URL` | No | `codeclimb/meter/index.ts` | Public proxy URL ending in `/v1`, overriding the tunnel the worker finds |
| `CODECLIMB_WORKER_ID` | No (default `codeclimb-worker-local`) | `scripts/worker.ts` | The `connect()` worker's instance id |
| `CODECLIMB_ROOT` | No (default: cwd) | `codeclimb/paths.ts`, `codeclimb/config.ts`, `codeclimb/api.ts` | Checkout the worker resolves config paths against |

## External services

### Pi model providers

Pi drives the coders and the reviewer. It runs in the worker on the host, never in a sandbox, so credentials stay on the host. `model`, `reviewer_model` and `allowed_models` take `<provider>/<id>`:

| Provider | `<provider>` | Credentials | Example model | Billing |
|---|---|---|---|---|
| GitHub Copilot | `github-copilot` | `npx pi`, then `/login github-copilot` | `github-copilot/claude-haiku-5.5` | Subscription |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY`, or `npx pi` then `/login anthropic` | `anthropic/claude-haiku-5-5` | Paid API |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY`, or `/login opencode` | `opencode/kimi-k3` | Credits |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY`, or `/login opencode-go` | `opencode-go/kimi-k3` | Subscription |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-haiku-4.5` | Paid API, catalog prices |

- `/login` writes `~/.pi/agent/auth.json`.
- The same model has different ids per provider: Copilot uses dots (`claude-haiku-5.5`), Anthropic and OpenCode use dashes (`claude-haiku-5-5`). List the ids of every provider with credentials:

  ```bash
  npx pi --list-models haiku
  ```

- `reviewer_model` is compared to `model` as a string, so `anthropic/claude-haiku-5-5` reviewing `github-copilot/claude-haiku-5.5` passes validation but is the same model critiquing itself.
- `coder_thinking` (default `medium`) and `reviewer_thinking` (default `low`) set Pi's effort. A reviewer on a coder's exact model needs an explicit, different `reviewer_thinking`.
- `run-night` checks before it starts that every model exists, has credentials and is on the account's plan; the worker checks again in its `check-models` step. The check finds missing keys, not wrong ones: a bad key fails the first model call as `agent_error`.

Check one model end to end (needs Docker and `codeclimb-python`; spends one model call):

```bash
npx tsx scripts/smoke-pi-sandbox.ts anthropic/claude-haiku-5-5
```

### Inngest Cloud

Optional; local nights use the dev server. Free plan with 50k executions/month at [Inngest](https://inngest.link/dai-gh). Fills `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`. Inngest Sandboxes (`--sandbox inngest`) need the cloud worker. How to run on it: [02_running.md#inngest-cloud](02_running.md#inngest-cloud).

### OpenRouter

Paid, catalog prices. Fills `OPENROUTER_API_KEY`. Used for coders on `openrouter/<id>` and for the program's own model calls in `allowed_models`, which the metering proxy forwards directly (not through Pi) and charges at the `usage.cost` OpenRouter reports.

## Cost

`coder_usd` and the `budget_usd` caps use Pi's catalog prices for every provider: real spend for an Anthropic key, OpenRouter or Zen credits; an estimate for the Copilot and Go subscriptions.

| Run path | Config | Cap (`budget_usd.night`) | Paid with |
|---|---|---|---|
| Mock night | any, with `--mock` | $0, no provider called | Nothing |
| Smoke nights | `capitals-smoke`, `datenorm-smoke`, `graphrag-smoke` | $0.50 | Copilot subscription (estimate) |
| Full datenorm | `datenorm.yaml` | $3.00 | Copilot subscription (estimate) |
| Full graphrag | `graphrag.yaml` (Opus 5.5 coder and reviewer, 4 OpenRouter models for the program) | $60 | Anthropic key + OpenRouter |

For scale: a 26-round graphrag night on Opus 5.5 ran 11.8 hours for $74.63, of which about $3.50 was the program's OpenRouter calls.

Next: [02_running.md](02_running.md)
