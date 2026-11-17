# Troubleshooting

After this guide you can match a failure's error text to its cause and fix. Each entry: error text → cause → fix.

## Known failures

### `CODECLIMB_ENV=cloud: set INNGEST_SIGNING_KEY and INNGEST_EVENT_KEY in .env`

- **Cause:** a `:cloud` script ran without the [Inngest](https://inngest.link/dai-gh) Cloud keys (`codeclimb/env.ts`).
- **Fix:** add both keys to `.env` ([01_setup.md#inngest-cloud](01_setup.md#inngest-cloud)).

### `CODECLIMB_ENV=cloud: unset INNGEST_DEV (it points the SDK at the dev server)`

- **Cause:** `INNGEST_DEV` is set in the shell or in `.env`.
- **Fix:** remove it from `.env` and `unset INNGEST_DEV`. The local scripts set it themselves.

### `sandbox "inngest" needs Inngest Cloud: run the cloud worker (npm run worker:cloud), or use sandbox: docker`

- **Cause:** a local worker was asked for Inngest Sandboxes (`codeclimb/sandbox/index.ts`).
- **Fix:** run `npm run worker:cloud` and `npm run run-night:cloud`, or drop `--sandbox inngest`. Local `run-night` already turns `sandbox: inngest` into Docker and prints `[run-night] local night: Docker sandboxes instead of inngest`.

### `[api] not serving on 127.0.0.1:7421: listen EADDRINUSE …`

- **Cause:** another worker (often a Cloud worker) holds the API port. The worker keeps running without its API, so the dashboard and `run-night` can't read it.
- **Fix:** start this worker with `CODECLIMB_API_PORT=7431`. Never stop a Cloud worker that has a night running.

### `the worker API on <host> needs CODECLIMB_WORKER_TOKEN`

- **Cause:** `CODECLIMB_API_HOST` is off loopback with no token (`codeclimb/api.ts`).
- **Fix:** set `CODECLIMB_WORKER_TOKEN` on the worker, and the same token plus `CODECLIMB_WORKER_URL` on the app.

### The night's `check-models` step fails, `run-night` keeps following

- **Cause:** the worker's environment lacks credentials for a model, or the model is not on the account's plan.
- **Fix:** read the error in the dev server UI (http://localhost:8288), press Ctrl-C, fix credentials ([01_setup.md#pi-model-providers](01_setup.md#pi-model-providers)), restart the worker.

### Every experiment fails with `agent_error` on the first model call

- **Cause:** a wrong key. The model check finds missing keys, not wrong ones.
- **Fix:** replace the key in `.env` or re-run `/login` in `npx pi`.

### `[run-night] paused, out of credits: …`

- **Cause:** a provider returned a credit or quota error (402, or OpenRouter's 403 `Key limit exceeded`).
- **Fix:** add credits, then `npm run run-night -- resume --night <id>` ([02_running.md#pause-and-resume](02_running.md#pause-and-resume)).

### The program's model calls return `401`, `402`, `403`, `400` or `502`

- **Cause:** the metering proxy refused or failed the call: `401` bad or revoked token, `403` model not in `allowed_models`, `402` budget spent, `400` unsupported request (streaming, tools), `502` upstream failure.
- **Fix:** check `allowed_models` and `budget_usd` in the config; `nights/<id>/evals/*/meter.jsonl` lists each call.

### Metered Docker sandboxes can't reach the proxy on Linux

- **Cause:** the proxy binds `127.0.0.1`, which only Docker Desktop reaches through `host.docker.internal`.
- **Fix:** set `CODECLIMB_PROXY_HOST` to the `docker0` address, such as `172.17.0.1`.

### Inngest Sandbox evaluations fail with a proxy URL error

- **Cause:** Inngest Sandboxes can't reach `localhost`; no tunnel publishes the proxy.
- **Fix:** run `npm run tunnel:cloudflare` (or `npm run tunnel`) before the worker, or set `CODECLIMB_METER_URL` to a public URL ending in `/v1`. The worker checks the URL before each coder and evaluation, so an outage never becomes a score.

### `npm run dev:inngest` fails to download the CLI binary

- **Cause:** npm 12 blocks the CLI's postinstall script.
- **Fix:** run it through the npm script, which passes `--ignore-scripts=false --allow-scripts=inngest-cli`.

### The dev server lists no `codeclimb` app or `hello-world` function

- **Cause:** the Next app isn't running in local mode, or the dev server can't reach it.
- **Fix:** run `npm run dev` (it sets `INNGEST_DEV=1`), then check the serve endpoint:

  ```bash
  curl -s http://localhost:3000/api/inngest
  ```

  In local mode it returns `"mode": "dev"` and `"function_count": 1`.

### A restarted worker cannot replay a running night

- **Cause:** a night started by an older worker can't be replayed by new code.
- **Fix:** let running nights finish or stop them before deploying new worker code.

## FAQ

**Why does the starter score 0 when the datenorm stub really scores 0.125?**
The starter is never run and scores 0 by definition. The `datenorm` stub answers `null` for everything, which is right for the `invalid` family only.

**Why does `datenorm.yaml` stop after one round?**
Haiku 5.5 solves `datenorm` in round 1 (0.98–1.0 on dev), and the threshold is 0.99. Use `datenorm-hard` for a longer climb ([02_running.md#datenorm-hard](02_running.md#datenorm-hard)).

**How does `datenorm-hard` climb?**
These nights ran on the old k-fold protocol, before fixed splits. Night `hard1` (3 branches, `max_rounds: 6`, threshold 0.95, about 8 min, $0.26) kept a commit in 5 of 6 rounds and ended on `max_rounds`, test 0.83:

| Round | Kept accuracy | What moved |
|---|---|---|
| 1 | 0.800 | |
| 2 | none kept | all branches at 0.804, below `min_gain` |
| 3 | 0.836 | `holiday` 0.37 → 0.67 |
| 4 | 0.848 | `relative` 0.54 → 0.77 |
| 5 | 0.872 | `week_date` 0.59 → 0.86 |
| 6 | 0.896 | `yearless` 0.64 → 0.91 |

The yearless convention was found by A/B across branches: "nearest past" lost in round 4, "current year" brought no gain in round 5, "next occurrence" won in round 6. Night `hard2` (threshold 0.90, about 10 min, $0.31, on the older k-fold protocol) stopped on `thresholds` after 6 rounds: 0.804 → 0.872 (r2) → 0.884 (r4) → 0.936 (r6), test 0.896.

**What happens when the worker is killed mid-night?**
It resumes after about 2 minutes, once Inngest's lease expires and the step [retries](https://www.inngest.com/docs/durable-execution/guides-and-advanced/error-handling/retries?utm_medium=repo&utm_source=github&utm_campaign=creator-growth-Q326&utm_content=dai). The retried step reopens the Pi session JSONL on the still-running sandbox.

**Can the local and the cloud worker run at the same time?**
Yes, each only sees its own Inngest. Give the second one another `CODECLIMB_API_PORT`.

**Is a mock night's score meaningful?**
No. A mock night checks that everything ran; a score of 0 is expected.

Next: [../README.md#guides](../README.md#guides)
