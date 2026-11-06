# codeclimb

Next.js app with [Inngest](https://www.inngest.com) background functions.

## Local development

Requires Node.js 20+. Follows the [Inngest local development guide](https://www.inngest.com/docs/local-development).

```bash
npm install
```

Run the Inngest Dev Server and the app in two terminals:

```bash
# Terminal 1: Inngest Dev Server (UI at http://localhost:8288)
npm run dev:inngest

# Terminal 2: Next.js app (http://localhost:3000)
INNGEST_DEV=1 npm run dev
```

- `INNGEST_DEV=1` puts the Inngest SDK in local mode. Without it, the v4 SDK runs in cloud mode and fails because it has no Inngest Cloud signing key. To skip the prefix, add `INNGEST_DEV=1` to `.env.local`.
- The Dev Server reads `inngest.json`, which points it at `http://localhost:3000/api/inngest` and turns off auto-discovery.
- `dev:inngest` passes both `--ignore-scripts=false` and `--allow-scripts=inngest-cli` to `npx`. The CLI downloads its binary in a postinstall script, and npm 12 needs `--allow-scripts` to run it.

Open http://localhost:8288. **Apps** should list `codeclimb` and **Functions** should list `hello-world`.

The app has no login. `npm run dev` and `npm run start` listen on `127.0.0.1` only, so only this machine can reach it.

### Trigger the hello world function

From the app, via `inngest.send()`:

```bash
curl -X POST http://localhost:3000/api/hello -d '{"name": "codeclimb"}'
```

Or from the Dev Server UI: open **Functions**, pick `hello-world`, select **Invoke** and send:

```json
{ "data": { "name": "codeclimb" } }
```

Then open **Runs** to see the steps and output.

### Debug the endpoint

```bash
curl -s http://localhost:3000/api/inngest
```

In local mode this returns `"mode": "dev"` and `"function_count": 1`.

### Agent access (MCP)

The Dev Server exposes an MCP endpoint at `http://127.0.0.1:8288/mcp` for listing functions, sending events and checking runs from a coding agent.

## CodeClimb loop

CodeClimb is an optimization loop. Pi coding agents write a program inside sandboxes, and the loop keeps the best change each round until the program meets evaluation thresholds. This iteration has a few limits:

- It runs on your machine in two modes: the **local Inngest dev server** with **Docker sandboxes**, or **Inngest Cloud** with **Inngest Sandboxes** (see [Run on Inngest Cloud](#run-on-inngest-cloud)). Inngest Cloud keeps a night durable, and the sandboxes run the coders' commands and the evaluations. [docs/cloud-migration.md](docs/cloud-migration.md) tracks the migration.
- It's headless: the worker's API is the interface, and the Next.js app is one client of it (see [The app](#the-app-watch-stop-export)).
- The coders and the reviewer are **models driven by Pi**: GitHub Copilot, Anthropic (API key), OpenCode Zen or OpenCode Go. The bundled configs use Copilot Haiku.
- It uses small built-in scenarios: `datenorm`, which normalizes messy date strings to ISO dates, and `capitals`, whose program calls a model, to exercise cost metering.

### Authenticate Pi

Pi runs in the worker on the host, never in a sandbox, so credentials stay on the host. `model`, `reviewer_model` and `allowed_models` is `<provider>/<id>`, and its provider needs credentials:

| Provider | `<provider>` | Credentials | Example model |
|---|---|---|---|
| GitHub Copilot | `github-copilot` | `npx pi`, then `/login github-copilot` | `github-copilot/claude-haiku-5.5` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY`; or `npx pi`, then `/login anthropic` → API key | `anthropic/claude-haiku-5-5` |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY`; or `npx pi`, then `/login opencode` | `opencode/kimi-k3` |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY`; or `npx pi`, then `/login opencode-go` | `opencode-go/kimi-k3` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openrouter/anthropic/claude-haiku-4.5` |

- `/login` writes `~/.pi/agent/auth.json`. Set `CODECLIMB_PI_AUTH_PATH` to use another file.
- Put env keys in `.env.local` (gitignored). `npm run worker`, `npm run run-night` and the smoke script load it, and variables already set in the shell win. Zen and Go share one `OPENCODE_API_KEY`.
- The same model has different ids per provider: Copilot uses dots (`claude-haiku-5.5`), Anthropic and OpenCode use dashes (`claude-haiku-5-5`). `npx pi --list-models <search>` lists the ids of every provider that has credentials.
- `reviewer_model` is compared to `model` as a string. `anthropic/claude-haiku-5-5` as the reviewer and `github-copilot/claude-haiku-5.5` as a coder pass validation, but they are the same model critiquing its own work.
- `coder_thinking` (default `medium`) and `reviewer_thinking` (default `low`) set Pi's effort. A reviewer on a coder's exact model needs an explicit, different `reviewer_thinking`.
- OpenRouter works for any model in Pi's catalog, priced at catalog prices. It suits `allowed_models`: one key, and the config lists which models the program may use.
- `run-night` checks before it starts that every model exists, has credentials and is on the account's plan. The worker checks again with its own environment and fails the night's `check-models` step if a model is not ready; `run-night` then keeps following, so read the error in the dev server UI and press Ctrl-C. The check finds missing keys, not wrong ones: a bad key fails the first model call as `agent_error`.
- `coder_usd` and the `budget_usd` caps use Pi's catalog prices for every provider. They are real spend for an Anthropic API key or Zen credits, and an estimate for the Copilot and Go subscriptions.

Check one model end to end with `npx tsx scripts/smoke-pi-sandbox.ts anthropic/claude-haiku-5-5` (needs Docker and the `codeclimb-python` image).

### Run a night

Prerequisites:

- Docker is running.
- Pi has credentials for every model in the config (see [Authenticate Pi](#authenticate-pi)).
- The Inngest dev server is running (`npm run dev:inngest`).

```bash
npm run build:image                    # docker image codeclimb-python (python 3.14 + git), shared by every scenario
npm run worker                         # terminal 2: connect() worker (orchestrator + Pi)
npm run run-night -- --config configs/datenorm-smoke.yaml   # starts the night and follows results.jsonl
npm run run-night -- stop --night <night_id>                # soft cancel: aborts Pi, destroys sandboxes
npm run run-night -- resume --night <night_id>              # continue a night paused out of credits
npm run run-night -- --config configs/capitals-smoke.yaml --mock   # scripted models, free: checks the loop end to end
npm run validate-results -- runs/datenorm-smoke/results.jsonl
npm test                               # unit tests (keep rule, stops, schema)
```

A night is a linear loop: one experiment per round, on `model`, each starting from the checkpoint (the last kept commit). It runs these steps:

1. **Experiment.** A `run-experiment` child gives Pi a fresh sandbox built from the scenario's image plus the checkpoint, with the scenario's bundle (spec and train examples) at `/spec`, plus the reviewer's feedback and hypothesis from the last round. Pi works until it is done or hits a timeout or `$` cap, and the orchestrator commits `/repo` as one commit. Experiments are `r<round>-e0`.
   A scenario can name a `check`: a host command that reads the experiment's files before evaluation. An experiment that fails it is not evaluated (graphrag: the few-shot manifest and the dev/test id scan).
2. **Evaluation on dev.** A `run-evaluator` child clones the commit into its own sandbox. Per stage of `scenario.yaml`, the host writes the dev inputs (`inputs`), the sandbox runs the program on them (`run`), and the host scores the downloaded outputs (`score`). The checkpoint is not run again: its stored dev scores are the reference.
3. **Guardrails.** An experiment can be kept only if it passes the gates, loses no headline metric of `scenario.yaml` by more than its margin against the checkpoint's scores, and leaves no stage with empty output. While the checkpoint is the starter, which is never run, only a failed run or an empty stage or gate stops it.
4. **Review.** A reviewer model reads the spec, the scenario's `protocol`, the experiment's metrics and their change from the checkpoint, per-item dev errors where the stage has a `details` command, and the diff. With a scenario `headline`, every headline metric counts equally and `primary_metric` only names the score. It reads no test data. It runs on every experiment, also one the guardrails forbid: it says why it is worse and writes the feedback and one hypothesis for the next round. If the review fails, the mechanical rule decides: keep on a primary gain of at least `min_gain`.
5. **Keep or revert.** A kept experiment becomes the checkpoint. A reverted one is dropped, and the next round restarts from the same checkpoint with the reviewer's feedback, so it doesn't go down the same path.
6. **Test.** After any stop, the final checkpoint is scored on test once.

A night stops on the first of these, checked between rounds (`stop_reason` in `done.json`):

| Stop | Config | When |
|---|---|---|
| `thresholds` | `thresholds` | The checkpoint's dev scores pass them |
| `max_rounds` | `max_rounds` | The last round finished |
| `deadline` | `deadline` | The deadline passed |
| `budget` | `budget_usd.night` | Spend plus the costliest round so far and the test eval would cross it |
| `tokens` | `max_tokens` (optional) | Coder and reviewer tokens plus the costliest round so far would cross it |
| `plateau` | `plateau_rounds` (default 3, `0` = off) | That many rounds in a row kept nothing |

The test eval gets its own evaluator too. A worker restart onto this code cannot replay a night started by an older worker, so let running nights finish or stop them first.

#### Mock mode

`--mock` runs a night on scripted models, to check that the loop works end to end for free. Metrics mean nothing.

- **Real:** Inngest, sandboxes, Pi sessions and their tools, commits, evals, the metering proxy, keep rules and reports.
- **Scripted:** the coder appends a line to `MOCK.md` with bash, the reviewer keeps nothing, and a program's model calls get a canned answer at no cost. No provider is called, so `--mock` needs no credentials.
- **Results** land in `runs/mock/<name>/`, away from real reports.

The `codeclimb-e2e` skill in `.claude/skills/` lists what to run and check.

#### Out of credits: pause and resume

A night pauses instead of failing when a provider reports it is out of credits. Without this, the failed calls score as a bad result: a program that gets a 402 on every call looks like a low F1, and the reviewer and the keep rule act on it.

- **What is detected.** A 402 or a key limit (403 `Key limit exceeded`) from OpenRouter on a program call, and a credit or quota error from Pi on a coder or reviewer turn. A rate limit is not a credit error: Pi retries it.
- **Where it stops.** The CLI and the night's page say which experiment, eval or review stopped, whether the program, coder or reviewer hit it, on which model, and the provider's message. `pause.json` holds the same.
- **What is kept.** A coder commits its partial work and resumes the same Pi session. Evaluations that finished stay; only the stopped ones rerun, and calls that failed are not scored. Sandboxes are destroyed while paused, so nothing bills.
- **Resuming.** Add credits, then run `npm run run-night -- resume --night <night_id>` or press Resume on the night's page. Time spent paused doesn't count against the night's deadline. Still out of credits? It pauses again at the same place.
- **Limits.** A pause lasts 3 days, then the night stops. Stop works while paused. A child function never waits: it returns the stop to `run-night`, which waits on `codeclimb/night.resume`, because a waiting child would hit its `step.invoke` timeout.

All output lands under `dirname(results_path)`:

| Path | Content |
|---|---|
| `results.jsonl` | One row per experiment and per extra eval. `npm run validate-results -- --schema` prints the schema. `reviewer_usd` is the round's review cost, repeated on every row of that round as the spec says, so don't sum it across rows. `done.json` has the night's real spend. |
| `experiments.git` | Bare repo with one commit per experiment, pinned by `refs/exp/<exp_id>`. |
| `nights/<id>/night.json` | Resolved config, start time and deadline, and metric-script hashes. |
| `nights/<id>/done.json` | Stop reason, kept commit and test metrics. |
| `nights/<id>/reviews/r<N>.json` | The reviewer's feedback and hypotheses for round N. |
| `nights/<id>/pause.json` | Where a paused night stopped. Removed on resume. |
| `nights/<id>/pauses.jsonl` | Every pause of the night, with its resume time. |
| `report.html` | Interactive report over every night in `results.jsonl`, rebuilt after each round and at the end of a night. |
| `nights/<id>/exps/<exp_id>/session/*.jsonl` | Pi session transcripts, reopened to resume after a crash. |
| `nights/<id>/evals/<eval_id>/` | Items with gold (host only), raw outputs, the runner's `timings.jsonl`, `meter.jsonl` (the program's model calls) and `metrics.json`. |

### Run on Inngest Cloud

The same worker and CLI can use Inngest Cloud instead of the dev server, with Docker sandboxes on your machine or Inngest Sandboxes (`--sandbox inngest`). Results land in the same `runs/` folders.

1. Put the production keys in `.env.cloud.local` (gitignored):
   - `INNGEST_EVENT_KEY`: create one under **Manage → Event Keys** in the Inngest dashboard.
   - `INNGEST_SIGNING_KEY`: under **Manage → Signing Key**.
2. Use the `:cloud` scripts. They set `CODECLIMB_ENV=cloud`, which loads `.env.cloud.local` before `.env.local`:

```bash
npm run worker:cloud                                                          # terminal 1: connect() worker on Inngest Cloud
npm run run-night:cloud -- --config configs/datenorm-smoke.yaml               # terminal 2: start and follow a night
npm run run-night:cloud -- stop --night <night_id>
npm run run-night:cloud -- --config configs/datenorm-smoke.yaml --sandbox inngest   # Inngest Sandboxes instead of Docker
```

- Cloud mode refuses to start if a key is missing or if `INNGEST_DEV` is set, because the SDK would quietly use the dev server instead.
- Runs, traces and scores appear in the Inngest dashboard under the `codeclimb-worker` app.
- The local and cloud workers can run at the same time, since each one only sees its own Inngest.
- The worker runs the night, so the machine must stay on and online until it ends. On macOS the worker holds `caffeinate -i`, so the Mac doesn't idle-sleep (closing the lid still sleeps it). If the worker drops off, Inngest Cloud keeps the run and retries the step once it reconnects, and a coder resumes its Pi session. Its sandbox keeps running meanwhile, which counts against its hour.

#### Inngest Sandboxes

`--sandbox inngest` (or `sandbox: inngest` in a config) runs every coder and evaluator in an Inngest sandbox (`codeclimb/sandbox/inngest.ts`): a microVM with 2 vCPUs and 2 GB, on Inngest's base image (Python 3.14, git). It needs the cloud worker; the dev-mode worker refuses it.

- **Setup.** Each coder sandbox gets `/spec` uploaded from the night's bundle and the git defaults the Docker image bakes in, so the scenario's `image` is ignored.
- **One hour per sandbox.** Inngest pauses a sandbox after one hour of active runtime, and the limit can't be raised. Coders get a new sandbox per experiment, and `timeouts.experiment_min` and `timeouts.eval_min` may be at most 50 on `inngest`. A round's evaluator is replaced by a new one before a candidate that might not finish in its hour, and latency is compared only between candidates on the same evaluator.
- **Network.** Egress is open (the beta has no allowlist). Gold and provider keys still never enter a sandbox. With `allowed_models`, the coder prompt says to call models only through the endpoint.
- **Metering.** Sandboxes can't reach `localhost`, so with `allowed_models` the proxy needs a public URL. Cloud mode pins it to port 7422 (`CODECLIMB_PROXY_PORT`), `npm run tunnel` publishes it with ngrok, and the worker finds the tunnel through ngrok's local API. `CODECLIMB_METER_URL` (ending in `/v1`) overrides that with any other tunnel. Only `/v1` is published, and each call needs its evaluation's token, which carries a budget cap.

  ```bash
  npm run tunnel                                                                   # terminal 1: needs a free ngrok account
  npm run worker:cloud                                                             # terminal 2
  npm run run-night:cloud -- --config configs/capitals-smoke.yaml --sandbox inngest
  ```

- **Cleanup.** Stops, cancelled runs and the end of a night sweep every backend the worker reaches, so a stop never strands a billed sandbox. Inngest has no labels: a run's sandboxes are tracked in the worker's memory, and the night's prefix sweep covers a restarted worker.
- **Checks.** `CODECLIMB_ENV=cloud npx tsx scripts/smoke-inngest-sandbox.ts` exercises every backend method on one sandbox. `CODECLIMB_ENV=cloud npx tsx scripts/sandboxes.ts` lists the newest sandboxes and their status.

### The app: watch, stop, export

The Next.js app (`npm run dev`, on `127.0.0.1:3000`) is the browser front end for a worker, with light and dark themes. Nights start only from the CLI (`npm run run-night`); the app watches, stops and exports them. It never runs Pi or sandboxes: every page reads the worker's API through `/api/worker/*`, which adds the worker token on the server.

- **Nights** (`/`): every night on the worker's disk with status, round, best score against the threshold, and spend against the budget.
- **Live night** (`/nights/<id>`): status, round, spend and elapsed time against budget and deadline, **Stop**, the current round's experiment every 5 s (phase, elapsed, coder and dev spend, tokens), KPIs (kept score, validation, test), and the report rendered natively in the app (convergence chart, metric-family heatmap, experiments by round, extra evaluations, reviewer feedback), refreshed when a result lands. Selecting an experiment shows its metrics, hypothesis and diff. **Export** works on kept commits (the best is selected by default): **Download git repo** gives a `.tar.gz` of a ready git repository, the files checked out on `codeclimb/<exp_id>` with the kept lineage as history. For a folder or a git remote, use `POST /api/nights/:id/export/:exp` or `npm run export` (below).

The worker serves the API on `CODECLIMB_API_PORT` (default `127.0.0.1:7421`) next to `connect()`, plus the metering proxy at `/v1` on the same port:

| Endpoint | Purpose |
|---|---|
| `GET /api/nights`, `GET /api/nights/:id` | Night summaries from `runs/*/nights/*` |
| `GET /api/nights/:id/live` | Summary plus the current round's experiment and the exportable experiments |
| `GET /api/nights/:id/report` | The night's report data as JSON (`ReportData`), which the app renders |
| `POST /api/nights/:id/stop` | Send `codeclimb/night.stop` |
| `GET /api/nights/:id/export/:exp?format=repo\|source\|bundle` | Download an experiment: a git repo `.tar.gz` (default), the tree only, or a git bundle |
| `POST /api/nights/:id/export/:exp` | `{kind: "dir", path}` writes the git repo into a folder on the worker's machine; `{kind: "remote", url, branch?}` pushes the lineage |

The API needs no token on loopback, which is how the app and the CLI use it. To reach it from another machine or integrate CodeClimb into something else, set `CODECLIMB_API_HOST` and `CODECLIMB_WORKER_TOKEN` on the worker, and `CODECLIMB_WORKER_URL` and `CODECLIMB_WORKER_TOKEN` on the app. Every request but `/v1` then needs the token as a bearer.

### Standard metrics: latency and cost

Every scenario gets the same two metrics, measured outside the code the coders write, on top of its own metrics:

- **Latency** is the program's own time: the hidden runner times each operation it sends the program. It leaves out sandbox setup, clone, scoring and teardown. The runner writes `timings.jsonl` next to its outputs, one line per operation: `{"op": "query", "id": "...", "ms": 12.3, "warmup": true}`. Warm-up records count toward nothing. That gives `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s` and `latency_total_s`.
- **Cost** is only the program's model calls, metered by the proxy below: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd` and `model_calls`. They are 0 for a program that calls no model. Coder and reviewer spend stays in `coder_usd` and `reviewer_usd`, and the program's calls while the coder develops in `dev_usd`. All three are outside optimization and count toward `budget_usd.night`.

Both are always measured and appear in `results.jsonl`, the report and the Inngest trace. Each night's config chooses whether they are optimized:

```yaml
standard_metrics:
  latency: true                      # default true
  cost: true                         # default true
  latency_metric: latency_total_s    # default
  cost_metric: cost_per_item_usd     # default
  min_efficiency_gain: 0.10          # relative cut a change needs
```

An optimized metric (lower is better) is named to the coder and the reviewer: an experiment that keeps the score and cuts one by more than `min_efficiency_gain` is worth keeping. The reviewer decides; the mechanical rule reads the primary metric alone. Gates you set on any metric apply either way.

The coder and reviewer prompts name the optimized metrics, and the hypothesis log shows their change next to the primary's. A metric that is not optimized stays out of the prompts unless a gate names it.

#### Metering proxy

A program may call models only when `allowed_models` lists some, and only through the metering proxy in the worker. Provider keys never enter a sandbox: a sandbox gets a proxy token for its own ledger, valid for the models in `allowed_models` only, and revoked when its run ends.

- **Network.** Metered evaluators join `cc-meter`, an internal Docker network with no route anywhere. Its only other member is `cc-meter-relay`, a small Python TCP relay that also sits on the default bridge and forwards to the proxy on the host. With `allowed_models`, coder sandboxes join it too; without it, they stay on `--network none`. The relay runs on the scenario's baseline image, so that image needs `python3`. The worker leaves `cc-meter-relay` and `cc-meter` in place between nights and recreates the relay when its proxy port changes.
- **Program side.** The runner's environment has `OPENAI_BASE_URL` and `OPENAI_API_KEY` (and `CODECLIMB_LLM_BASE_URL` / `CODECLIMB_LLM_API_KEY`). The key is a token valid for this eval only and revoked when its run ends. The program uses `POST $OPENAI_BASE_URL/chat/completions` with a model from `allowed_models`, such as `github-copilot/claude-haiku-4.5`, or `/embeddings`. Chat goes through Pi, with the same credentials and catalog prices as the coders. The runner calls `POST $CODECLIMB_LLM_BASE_URL/_op` with `{"op": "query"}` to attribute later calls to an operation.
- **Coder side.** While Pi develops, its shell commands get the same `OPENAI_BASE_URL` and `OPENAI_API_KEY`, keyed to the experiment's own ledger, so the coder can run its program against the real model. The coder prompt names the models and the budget. That spend is the row's `dev_usd`, never `cost_usd`: only the evaluation measures the program's cost. Each Pi attempt opens a new token; spend carries over across a restart. Calls are logged to `nights/<id>/exps/<exp_id>/meter-dev.jsonl`.
- **Limits.** `budget_usd.eval` caps one eval's model spend (default: `budget_usd.experiment`). `budget_usd.dev` caps one experiment's development calls (default: `budget_usd.eval`), and `coder_usd + dev_usd` stops the coder at `budget_usd.experiment`. A cap is checked before each call, so the call that crosses it still runs. Errors: `401` bad or revoked token, `403` model not allowed, `402` budget spent, `400` unsupported request, `502` upstream failure (what a failed call cost is still charged).
- **Not supported yet.** Streaming, tools and non-text content in chat. Outside OpenRouter, embeddings only for `openai/text-embedding-3-small` and `-large`, priced from a table in `codeclimb/meter/backends.ts`. Operation attribution assumes the runner sends operations one at a time. Containers on `cc-meter` can reach one another; nothing listens in them, and within a night a round's coders and its evaluator never run at the same time. Two nights on one worker share the network.
- **OpenRouter.** `openrouter/<id>` models in `allowed_models` skip Pi: the proxy calls OpenRouter directly with `OPENROUTER_API_KEY`, forwards `response_format`, `seed`, `top_p`, `stop` and `reasoning`, and charges the `usage.cost` OpenRouter reports. A night refuses to start if the endpoints API lists no endpoint for one of them. Decisions models such as `typesafe/jev-1.14` refuse chat, so the proxy serves them at `POST /v1/decisions` (`{model, state, questions}`), forwarded to OpenRouter's alpha decisions API. Rerank models such as `qwen/qwen3-reranker-8b` are served at `POST /v1/rerank` (`{model, query, documents, top_n}`).
- **Linux.** The proxy binds `127.0.0.1`, which Docker Desktop reaches through `host.docker.internal`. On Linux, set `CODECLIMB_PROXY_HOST` to the `docker0` address, such as `172.17.0.1`. `CODECLIMB_PROXY_PORT` pins the port, which is random by default.

```bash
npm run build:image
npm run run-night -- --config configs/capitals-smoke.yaml   # one round; the program calls github-copilot/claude-haiku-4.5, while the coder develops too
```

### Harder scenario: `datenorm-hard`

`datenorm` is fully specified, so one round solves it. `datenorm-hard` is built to need several rounds:

- **Breadth.** It adds 6 families: `holiday`, `nth_weekday`, `yearless`, `multi_date`, `fuzzy` and `week_date`. They make up about half the items.
- **Interference.** `invalid` gets traps aimed at loose fixes, such as `Augustine 23, 1990`, `part no. W37-5` and `Easter plans`.
- **A vague spec.** `SPEC.md` says *which kinds* of input appear but not the conventions behind the gold answers. Examples are which year `Nov 30` means, which of two dates counts, and how loose month matching may be. `METRICS.md` explains each family name, so a per-family accuracy number tells the loop where to look. The coder and reviewer prompts tell the agents to treat open choices as hypotheses to A/B across branches. `HIDDEN_RULES.md` lists the gold conventions.

```bash
npm run build:image              # the shared codeclimb-python image
npm run build:dataset:hard       # the hidden dataset
```

No config ships for it: copy `configs/datenorm.yaml` and point `scenario:` at `scenarios/datenorm-hard`.

### Multi-stage scenario: `graphrag`

`scenarios/graphrag` is a GraphRAG system over 56 articles, scored in three stages, each on gold input: extraction (mention and relation F1), graph building (B-cubed precision and recall) and retrieval (per query kind). Its own `README.md` documents the gold data and every metric; `docs/scenario-contract.md` records how it plugs into codeclimb.

- **Local data.** `corpus/` and `gold/` are gitignored, so a fresh clone lacks them and a night fails at the bundle step. Copy them from scrabble's `datasets/graphrag` into `scenarios/graphrag/`.
- **Host side.** The evaluators run through `uv` with the scenario's `pyproject.toml` (click, loguru, pydantic). `uv` must be on the worker's PATH.
- **Sandbox side.** The program is `python -m graphrag <stage> --root --inputs --out [--graph]` in the `codeclimb-graphrag` image, which adds the fixed `requirements.txt` to `codeclimb-python`. The starter writes empty predictions.
- **Bundle.** The coder gets `spec/agent/`, the 12 train articles, train's gold graph, and train examples and inputs per stage. The export fails if any file names a dev or test document.
- **Metrics.** Each stage's report is flattened with the stage in front, such as `extraction.mentions.f1`, `graph.b_cubed.recall` and `retrieval.by_kind.single_hop.metrics.edge_recall_at_k.mean`.

```bash
npm run build:image:graphrag     # codeclimb-python, then codeclimb-graphrag
npm run run-night -- --config configs/graphrag-smoke.yaml
```

### Report and export

Each night rewrites `report.html` next to `results.jsonl` after every round. It is one self-contained file in the Decoding AI design system and opens offline. It covers every night in the results file:

- **All Nights:** stop reason, rounds, kept accuracy, test, spend and wall time per night.
- **How the Night Converged:** each experiment's score per round, the kept step line, the threshold, and the final test score. Click a point to select that experiment.
- **Metric Families:** a heatmap of the share of items wrong per family, along the kept lineage or across all experiments, with ▲/▼ where a kept commit moved a family.
- **Experiments:** every experiment grouped by round, with its hypothesis, score, change from its parent, keep or revert, and cost. The extra evaluations and the reviewer's feedback each round follow.
- **Detail and export:** the selected experiment's metrics and diff against its parent, and an export panel. The night's best kept commit is selected by default.

```bash
npm run report -- --config configs/datenorm.yaml           # rebuild runs/datenorm/report.html
npm run report -- --config configs/datenorm.yaml --serve   # http://127.0.0.1:7420 with a working Export button
```

Opened from disk, the export panel's button copies the matching CLI command instead. The same export from the terminal:

```bash
npm run export -- --config configs/datenorm.yaml --exp best --to-dir ../datenorm-solution                  # plain files
npm run export -- --config configs/datenorm.yaml --exp <exp_id> --to-dir ../datenorm-repo --with-history # git repo with the kept lineage
npm run export -- --config configs/datenorm.yaml --exp best --to-remote git@github.com:you/repo.git [--branch main]
```

- `--exp best` is the kept commit of the most recently finished night.
- A folder export refuses a non-empty folder unless `--force` is passed. `--with-history` needs an empty or new folder.
- A remote export pushes the experiment's lineage (starter → each kept parent → the experiment) to `codeclimb/<exp_id>`, or to `--branch`. It never force-pushes, so git rejects a push onto a branch that has diverged.
- Remotes are limited to `https`, `ssh`, `git` and local paths. Option-like arguments and `ext::`/`fd::` transports are refused, and git never prompts for credentials.
- `--serve` binds to 127.0.0.1 only. It answers only requests addressed to that host and port. Exports need a per-run token that is embedded in the served page.

### Layout

| Path | Purpose |
|---|---|
| `inngest/codeclimb/functions.ts` | `run-night` (thin parent), `run-experiment` and `run-eval` (invoked children), and the cleanup handlers |
| `scripts/worker.ts` | `connect()` worker with its own app id `codeclimb-worker`, which keeps Pi out of the Next bundle |
| `scripts/run-night.ts` | `run-night --config <yaml>` CLI |
| `codeclimb/api.ts` | The worker API (and `/v1` metering proxy mount) the app reads |
| `app/` | The Next.js app: Nights, the night page with its report (`app/nights/[id]/report/`), and the `/api/worker` proxy |
| `codeclimb/` | Config, keep rule and statistics, git, eval, coder, reviewer, results schema, tracing |
| `codeclimb/sandbox/` | `SandboxBackend` interface, Docker and Inngest backends, and git-bundle transfer |
| `codeclimb/report/` | Report data, the HTML renderer, the page's CSS and JS, and the two logo lockups |
| `codeclimb/export.ts` | Export an experiment to a folder or a git remote, with the argument checks |
| `scripts/report.ts`, `scripts/export.ts` | `report` (write or `--serve`) and `export` CLIs |
| `codeclimb/pi/` | Isolated Pi sessions and the read/write/edit/bash adapters that run inside the sandbox |
| `scenarios/<name>/` | One scenario ([contract](docs/scenario-contract.md)): `scenario.yaml`, `starter/` (the round-0 repo), `spec/agent/` (the coder's spec), `gold/` (`items.jsonl`, `splits.json`), `evaluators/` (host CLI, runner, scorer) and `scripts/` (dataset builder, bundle export) |
| `docker/python.Dockerfile` | The `codeclimb-python` image every scenario uses on Docker |
| `scenarios/graphrag/` | Three-stage GraphRAG scenario: `corpus/`, gold graph and retrieval queries, one evaluator CLI per stage, and a stub `python -m graphrag` starter |
| `docker/graphrag.Dockerfile` | `codeclimb-graphrag`: `codeclimb-python` plus graphrag's `requirements.txt` |
| `scenarios/datenorm-hard/` | A vaguer spec and 6 more families on top of `datenorm`. It reuses the `datenorm` generators. `HIDDEN_RULES.md` is the answer key and never reaches a sandbox |
| `configs/` | `capitals-smoke.yaml`, `datenorm-smoke.yaml` and `graphrag-smoke.yaml` (short, Haiku via Copilot for the coders and reviewer), `datenorm.yaml` (a full night) and `graphrag.yaml` (4 rounds on Inngest Cloud) |

### Deviations from the spec in this iteration

- **Models:** GitHub Copilot through Pi's `github-copilot` provider, not OpenCode Go.
  - Coders are `claude-haiku-5.5` ×2 and the reviewer is `claude-haiku-4.5`, so the reviewer is not one of the coders.
  - `coder_usd` is Pi's `message_end` cost at list prices. Copilot bills by subscription, so this is a comparable dollar figure, not an actual charge.
- **Local or Cloud:** the dev server or Inngest Cloud, a `connect()` worker on the laptop, and Docker or Inngest sandboxes (see [Run on Inngest Cloud](#run-on-inngest-cloud)).
- **No metering proxy:** `datenorm` is standard-library Python with no model calls.
  - Docker sandboxes run with `--network none`, which is stricter than the spec's egress allowlist. Inngest sandboxes have open egress, which is looser.
  - `program_usd` is 0 and `allowed_models` is unused.
- **Scenario directory:** a config names `scenario: scenarios/<name>`; its `scenario.yaml` holds the image, the bundle command and the stage commands ([docs/scenario-contract.md](docs/scenario-contract.md)).
- **Fixed splits:** every scenario has fixed train/dev/test in `gold/splits.json`. Dev is scored every round, test once at the end. Only train reaches a coder (the bundle's `train/examples.jsonl`).
- **Extra row fields:** `kind` (experiment | test), `eval_id` (a unique row key) and `night_id`.
  - Extra eval rows use `decision: keep` when the eval succeeded and `error` when it failed.
- **Pi's base prompt** includes a `<docs>` block pointing at Pi's own docs on the host. Nothing from AGENTS.md, skills, extensions or `~/.pi` is loaded.

### Known behaviour worth knowing

- **The starter is scored 0, as the spec says.** The `datenorm` stub answers `null` for everything, so it really scores 0.125 (the `invalid` family). A round-1 commit that changes nothing still clears `min_gain` and gets kept. This happens when every experiment hits its `$` cap early. The alternative is one real eval of the starter at night init.
- **Haiku 5.5 solves `datenorm` in round 1,** scoring 0.98–1.0 on dev. `configs/datenorm.yaml` (threshold 0.99) will usually stop after one round. For a longer climb, use the `datenorm-hard` scenario.
- **`datenorm-hard` climbs over many rounds.** These nights ran on the old k-fold protocol, before fixed splits. Calibration (1 branch × 1 round) scored 0.736. The full night `hard1` (3 branches, `max_rounds: 6`, threshold 0.95, about 8 min, $0.26) kept a commit in 5 of 6 rounds:

  | Round | Kept accuracy | What moved |
  |---|---|---|
  | 1 | 0.800 | |
  | 2 | none kept | all branches at 0.804, below `min_gain` |
  | 3 | 0.836 | `holiday` 0.37 → 0.67 |
  | 4 | 0.848 | `relative` 0.54 → 0.77 |
  | 5 | 0.872 | `week_date` 0.59 → 0.86 |
  | 6 | 0.896 | `yearless` 0.64 → 0.91 |

  - The yearless convention was found by A/B across branches. "Nearest past" lost in round 4, "current year" brought no gain in round 5, and "next occurrence" won in round 6.
  - Test scored 0.83. It has only 7 items per old family, and no validation ran because the thresholds were never met.
  - The night ended on `max_rounds` below its 0.95 threshold, so the config now uses 0.90 and allows up to 10 rounds.
  - With 0.90, night `hard2` (about 10 min, $0.31) stopped on `thresholds` after 6 rounds. It went 0.804 → 0.872 (r2, `holiday` and `multi_date`) → 0.884 (r4, `relative`) → 0.936 (r6, `week_date` and `yearless`). Rounds 3 and 5 kept nothing. Validation on the held-out fold scored 0.930, so the overfit gap was 0.006 and the commit was kept. Test scored 0.896.
- **A killed worker resumes after about 2 minutes,** once Inngest's lease expires and the step retries. The retried step reopens the Pi session JSONL on the still-running sandbox.

### Verified locally (dev server + Docker)

| Check | Config change | Result |
|---|---|---|
| Thresholds stop | `datenorm-smoke` with threshold 1.0 | Round 1 → test, `stop_reason: thresholds` |
| `max_rounds` + worker crash | `datenorm-smoke`, worker `kill -9` in round 2 | Steps resumed the Pi sessions on the same sandboxes; round 2 → test, `stop_reason: max_rounds` |
| `$` cap | `budget_usd {experiment: 0.003, night: 0.02}` | Pi aborted per experiment; `stop_reason: budget` after round 1 |
| Deadline | `deadline: 30s`, threshold 1.01 | `stop_reason: deadline` after round 1 |
| Night stop | `run-night stop` mid round 1 | Parent and children `CANCELLED`, Pi aborted, sandboxes destroyed |

Across all of these, `results.jsonl` validated against the schema and no `cc-*` containers were left behind.

## Project layout

| Path | Purpose |
|---|---|
| `inngest/client.ts` | Inngest client (`id: "codeclimb"`) |
| `inngest/functions.ts` | `hello-world` function, triggered by `test/hello.world` |
| `app/api/inngest/route.ts` | Serve endpoint the Dev Server syncs and calls |
| `app/api/hello/route.ts` | Sends a `test/hello.world` event |
| `inngest.json` | Dev Server config |
