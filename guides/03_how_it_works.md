# How CodeClimb works

After this guide you know what each step of a night does, how LangGraph makes it durable, what stops it, what stays off the sandbox, what it writes to disk, the worker API the dashboard reads, and which file to open for each part.

<!-- Placeholder: the Inngest twin's diagram, until the LangGraph + LangSmith version lands. -->
![How to build durable and secure long-running agents: the CodeClimb loop with its proxy, checkpoints and credit pauses](../assets/architecture-durable-secure.png)

## The night loop

A night is a linear loop: one experiment per round on `model`, each starting from the checkpoint (the last kept commit). Entry points: `src/graphs/night.ts` (the `night` entrypoint), `src/graphs/round.ts` (one round's steps), `src/night/loop.ts` (the stops and the loop's logic).

0. **Smoke test.** Before any money goes into a round, the server checks that every model answers its credentials and, for a metered program, that the path to the proxy is up. A failure is retried every 5 minutes, 6 times; then the night stops with `outage`.
1. **Experiment** (`src/coder/coder.ts`). Pi gets a fresh sandbox with the scenario's image plus the checkpoint, the bundle (spec and train examples) at `/spec`, and the reviewer's feedback and hypothesis from the last round. It researches, plans tasks in `/tmp/tasks.json`, implements, and reviews its diff. A coder that stops too soon is sent back (at most eight times): a task neither done nor dropped, no train measurement in `/tmp/train-score.json`, or time and budget left before its reserve (the last 20% of either). The coder's work becomes one commit, `r<round>-e0`, moved as a git bundle into `experiments.git`.
   - The coder's notes plus the decision and the reviewer's verdict become `/spec/history/notes/<exp>.md` for later rounds.
   - A scenario's `check` (a host command) can block evaluation; its `scan` blocks a keep when the commit adds held-out names.
2. **Evaluation on dev** (`src/eval/evaluator.ts`). The commit is cloned into its own sandbox. Per stage of `scenario.yaml`, the host writes the dev inputs, the sandbox runs the program, the host scores the outputs. "Host" here is the server container.
3. **Keep or revert** (`src/decision.ts`). Each metric in `thresholds` counts as `min(metric / threshold, 1)`; the weighted mean (`weights`, default 1) is the score. An experiment is kept when its score beats the checkpoint's by more than the noise margin and nothing blocks it. The starter scores 0.
4. **Review** (`src/review/reviewer.ts`). A reviewer model reads the spec, the metrics and their change, per-item dev errors, the diff, the decision and the coder's notes. It decides nothing: it writes feedback, the next hypothesis and a verdict. It never reads test data.
5. **After the decision.** A kept experiment becomes the checkpoint; a reverted one is dropped and the next round restarts from the same checkpoint. A commit that fails before scoring gets one repair (`e1`) per round. Within a night, repeated model calls replay their earlier answer for free, so unchanged code scores the same.
6. **Test.** After any soft stop, the final checkpoint is scored on test once, then `done.json` is written and the `lessons` graph distills the night.

### Durable on LangGraph

The loop is a LangGraph JS [functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api) `entrypoint`, and every unit of work is a `task()` (`src/runtime/step.ts`), named `<experiment or evaluation id>/<step>`, such as `n20261111-r2-e0/code`.

- **Checkpoints.** Every server run passes `durability: "sync"`, so a finished step's result is in Postgres within about a second. After a crash the entrypoint replays from the top and every stored step returns its saved result without running.
- **Crash resume.** Kill the server container and run `npm run server` again: about 2 minutes after `up`, the server's runs sweeper reruns the killed run, and only the step that was running at the kill runs again. The watchdog in `npm run api` covers what the server can't (a thread in `error` twice, a lost thread).
- **Retries.** Each step gets 3 attempts ([fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)); a step that fails out of them returns its failure as data, so one bad experiment doesn't kill the night.
- **Timeouts.** CodeClimb's own timers, never `task()`'s `timeout` option (a step with it never sees a cancel): code `experiment_min × 3 + 30` min, an evaluation `eval_min × stages × 3 + 15` min, host commands 35 min, any other step 30 min.
- **Pauses.** A credit pause is an [`interrupt()`](https://docs.langchain.com/oss/javascript/langgraph/interrupts) between steps; resume is a run with the command `{ resume: { pause: n } }`. The 3-day pause timeout and the 4-day variation backstop are delayed runs of `stop` on the night's timer thread.
- **Threads.** One per night variation (UUID v5 of the night id, so a double start starts one night), one stop thread, one timer thread, one lessons thread per scenario.

### Noise margin

At the start of the first round whose checkpoint has scores, the checkpoint is evaluated once more with no replayed calls (an A/A run, a `noise` row). How far its threshold metrics moved, summed per weighted share, is the margin later experiments must beat, kept in `noise.json`. An experiment's margin is that move times the square root of its fresh-call share. The margin is at least `min` (0.002) and at most `max` (0.005): one pair is one sample. `noise_margin` in the config sets `min`, `max`, `fixed` and `scale_by_replay`.

### Stops

The first five are checked at the start of a round, `outage` by the smoke test right after them, `thresholds` after each round. The reason lands in `done.json` as `stop_reason`.

| Stop | Config | When |
|---|---|---|
| `max_rounds` | `max_rounds` | The next round would pass it |
| `deadline` | `deadline` | The deadline passed (moved forward by pauses) |
| `budget` | `budget_usd.night` | Spend plus the costliest round so far and the costliest evaluation would cross it |
| `tokens` | `max_tokens` (optional) | Tokens plus the costliest round's tokens would cross it |
| `plateau` | `plateau_rounds` | That many rounds in a row kept nothing |
| `outage` | | The round-start smoke test failed 7 times, 5 minutes apart |
| `thresholds` | `thresholds` | The checkpoint's dev scores pass them |

Hard stops (`run-night stop`, the app, a night that fails out of retries, a cancel from outside, the timers) all go through the `stop` graph and write `stop.json` instead.

## Standard metrics: latency and cost

Every scenario gets two metrics measured outside the coders' code (`src/eval/metrics.ts`):

- **Latency**: the hidden runner times each operation it sends the program. Gives `latency_<op>_p50_ms`, `_p95_ms`, `_total_s` and `latency_total_s`.
- **Cost**: the program's model calls only, metered by the proxy: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`. Coder and reviewer spend stays in `coder_usd` and `reviewer_usd`, the program's calls during coding in `dev_usd`; all count toward `budget_usd.night`.

The config chooses whether they are optimized:

```yaml
standard_metrics:
  latency: true                      # default true
  cost: true                         # default true
  latency_metric: latency_total_s    # default
  cost_metric: cost_per_item_usd     # default
  min_efficiency_gain: 0.10          # relative cut a change needs
```

## Metering proxy

A program may call models only when `allowed_models` lists some, and only through the proxy (`src/meter/`), an HTTP server in the Agent Server process on port 8090 of the server container. Provider keys never enter a sandbox: each evaluation and each coder attempt gets a token for its own ledger, valid for `allowed_models` only, revoked when its run ends.

- **Program side.** The runner's environment has `OPENAI_BASE_URL` and `OPENAI_API_KEY` (also `CODECLIMB_LLM_BASE_URL` / `CODECLIMB_LLM_API_KEY`). Routes: `/v1/chat/completions`, `/v1/embeddings`, `/v1/decisions`, `/v1/rerank`, and `/v1/_op` to attribute calls to an operation.
- **Network.** Metered sandboxes join the Docker network `cc-meter` and see the proxy at `http://cc-meter-relay:8080/v1`; the relay container forwards to the server container's alias `codeclimb-server` on the same network. The port is never published to your machine.
- **Limits.** `budget_usd.experiment` caps `coder_usd + dev_usd`; `budget_usd.night` caps the whole night. Errors: `401` bad or revoked token, `413` body over 16 MiB, `403` model not allowed, `402` budget spent or credit stop, `400` unsupported request, `502` upstream failure.
- **OpenRouter.** `openrouter/<id>` models skip Pi: the proxy calls OpenRouter with `OPENROUTER_API_KEY` and charges the reported `usage.cost`. Other chat goes through Pi at catalog prices.
- **Not supported.** Streaming, tools and non-text chat content.

## Security

What runs where, and what leaves your machine:

- **Sandboxes.** Coder agents run shell commands in Docker sandboxes (2 CPUs, 2 GiB) with open egress. Pi itself runs in the Agent Server process; only its shell and file tools reach the sandbox.
- **Credentials and gold.** Provider keys (`.env`, `~/.pi/agent/auth.json`) and gold data never enter a sandbox. The program reaches models only through the metering proxy, with a one-off token that is capped and revoked when its run ends.
- **The server container.** It gets the `.env` keys, the host's Docker socket (it creates sandboxes on your daemon), the checkout read-write, its git directory read-only, and Pi's `auth.json` read-write. `.dockerignore` keeps `.env`, `.git`, `node_modules` and night output out of the image.
- **Local services.** The Agent Server (`127.0.0.1:8123`), the worker API and the app bind loopback only; the API needs `CODECLIMB_WORKER_TOKEN` off loopback.
- **Traces.** With `LANGSMITH_TRACING=true`, prompts, model replies, tool calls and metrics go to LangSmith. `false` sends none; the boot check and the server's metadata loop still reach LangSmith.

## Outputs on disk

A config's `results_path` is relative to `runs-langchain/` (gitignored); mock nights write under `runs-langchain/mock/`. The configs are shared unchanged with the [Inngest](https://inngest.link/dai-gh) stack on `main`, which writes to `runs-inngest/`. The Agent Server's Postgres holds only threads, server runs and graph checkpoints; everything else lands under `dirname(results_path)`:

| Path | Content |
|---|---|
| `results.jsonl` | One row per experiment and per extra eval (`noise`, `rescore`, `test`) |
| `experiments.git` | Bare repo, one commit per experiment, pinned by `refs/exp/<exp_id>` |
| `lessons/<night>-r<N>/` | Lesson proposals |
| `nights/<id>/night.json` | Resolved config, start time, deadline, metric-script hashes |
| `nights/<id>/done.json` | Stop reason, rounds, kept commit, test metrics, spend |
| `nights/<id>/stop.json` | Hard-stop reason (`manual`, `app`, `failed`, `cancelled`); the first stop wins |
| `nights/<id>/pause.json`, `pauses.jsonl` | The current pause, and every pause |
| `nights/<id>/reviews/r<N>.json` | The reviewer's feedback and hypotheses for round N |
| `nights/<id>/exps/<exp_id>/` | Pi session transcripts, `code-state.json`, `tasks.json`, `train-score.json`, `check.json`, `meter-dev.jsonl` |
| `nights/<id>/evals/<eval_id>/` | Per stage inputs, run log, outputs and report; `meter.jsonl`, `metrics.json` |

## Worker API

`npm run api` serves it on `CODECLIMB_API_HOST:CODECLIMB_API_PORT` (default `127.0.0.1:7421`), in its own process with the watchdog (`src/api/server.ts`). It reads nights from files, so night status comes from `done.json`, `stop.json` and `pause.json`, not from the Agent Server. Unlike the Inngest twin, it serves no `/v1`.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/nights`, `GET /api/nights/:id` | Night summaries from `runs-langchain/*/nights/*` and `runs-langchain/mock/*/nights/*` |
| `GET /api/nights/:id/live` | Summary plus the current experiment and the exportable experiments |
| `GET /api/nights/:id/report` | The night's rows, reviews, config extract and diffs |
| `POST /api/nights/:id/stop`, `/resume` | The stop or resume operation |
| `POST /api/nights/:id/continue` | `{direction?, rounds}`; 409 when the night can't continue |
| `GET /api/nights/:id/export/:exp?format=repo\|source\|bundle` | Download an experiment |
| `POST /api/nights/:id/export/:exp` | `{kind: "dir", path}` or `{kind: "remote", url, branch?}` |

No token on loopback. Off loopback, set `CODECLIMB_API_HOST` and `CODECLIMB_WORKER_TOKEN` on the API and `CODECLIMB_WORKER_URL` and `CODECLIMB_WORKER_TOKEN` on the app; every route then needs the bearer token.

```bash
curl -s http://127.0.0.1:7421/api/nights
```

Prints `{"nights":[{"id":"<id>","scenario":"scenarios/datenorm","mock":true,"status":"finished","stop_reason":"max_rounds",…}]}` after the mock night.

## Debugging a night

A night's own state is in its files under `runs-langchain/`: read `nights/<id>/` first. With `npm run server` running, the Agent Server's REST API answers JSON:

```bash
curl -s http://127.0.0.1:8123/threads/<thread_id>/state
```

```bash
curl -s http://127.0.0.1:8123/threads/<thread_id>/runs
```

Traces are in the LangSmith project `$LANGSMITH_PROJECT`, one per experiment, evaluation and review, filtered by `night_id`.

## Project structure

| Path | Purpose |
|---|---|
| `langgraph.json` | The graphs `night`, `stop`, `lessons`; the server image's base, extra lines and compose override |
| `src/graphs/` | The LangGraph entrypoints: the night, a round, pauses, stop, lessons |
| `src/runtime/` | The step wrapper (`task()`, retries, timers, abort signals) and the live registry |
| `src/control.ts` | Start, stop, resume, continue and timers as Agent Server calls (`@langchain/langgraph-sdk`) |
| `src/night/` | Step bodies with no LangGraph: init, the loop's stops, sandboxes, memory, pauses, variations, files |
| `src/cli/` | `server`, `run-night`, `api`, `export`, `lessons`, `validate-results` |
| `src/api/` | The worker API and the watchdog |
| `src/coder/`, `src/review/`, `src/eval/` | The coder (prompt, send-backs), the reviewer, the evaluator and metrics |
| `src/pi/` | Pi sessions, models (including mock mode), the model check, web research |
| `src/meter/` | The metering proxy, its ledgers, the relay and provider backends |
| `src/sandbox/` | The Docker backend and git-bundle transfer |
| `src/tracing.ts`, `src/spans.ts` | CodeClimb's LangSmith tracer and spans |
| `web/` | The Next.js app: Nights, the night page, the `/api/worker` proxy |
| `scenarios/<name>/` | One scenario: `scenario.yaml`, `starter/`, `spec/`, `gold/`, `evaluators/`, `scripts/`. Shipped: `capitals`, `datenorm`, `datenorm-hard`, `graphrag` |
| `configs/` | `capitals-smoke`, `datenorm-smoke`, `graphrag-smoke` (short, Haiku via Copilot), `datenorm`, `graphrag`, and `e2e/` (budget, plateau, overfit) |
| `docker/` | `python.Dockerfile`, `graphrag.Dockerfile`, `langgraph-up.compose.yaml` |
| `docs/` | The build spec (`codeclimb-spec-langchain.md`) and ADRs `0001` to `0005` |

## Differences from the Inngest twin

The two builds behave the same on the stack-neutral parts, so their nights compare. What differs, forced by this stack or decided for it:

- **One mode.** The self-hosted Agent Server on your machine, with Docker sandboxes. No cloud mode, no remote sandboxes, no tunnels (ADRs 0004, 0005).
- **Worker API.** Its own process; it serves no `/v1`, a busy port is a startup error, and its token covers every route.
- **Timeouts.** CodeClimb's own timers, not the runtime's.
- **Traces.** One trace per experiment in LangSmith, not one per night (ADR 0003).
- **Boot.** The server needs a LangSmith key, so mock nights and CI need one.

Next: [../README.md#guides](../README.md#guides)
