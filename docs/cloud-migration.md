# Plan: CodeClimb on local Inngest and on Inngest Cloud

Status: final draft, 2026-10-29. Done so far: the app login (`proxy.ts`). Nothing else is built yet.

This plan follows the production design in the vault spec `8 - Projects/CodeClimb/codeclimb-spec-inngest.md` and adds a Vercel app. One codebase runs in two modes, and both stay supported for good:

- **Local:** the Inngest dev server, a worker on your laptop, Docker sandboxes, and the app on `localhost`. This is how it runs today.
- **Cloud:** Inngest Cloud, a worker on an always-on host, Inngest Sandboxes, and the app on Vercel.

## 1. The two modes

| Piece | Local | Cloud |
|---|---|---|
| Orchestration | Inngest dev server (`npm run dev:inngest`, port 8288) | Inngest Cloud (Pro), `production` environment |
| Function code | Worker on the laptop: `connect()` to the dev server | Worker on an always-on host (Fly.io, Railway or Render, with a volume): `connect()` to Cloud |
| Sandboxes | Docker (`sandbox: docker`) | Inngest Sandboxes (`sandbox: inngest`) |
| Metering proxy | Worker on `127.0.0.1`, reached through the `cc-meter` Docker network and relay | Worker on a public HTTPS URL (`CODECLIMB_METER_URL`) |
| App | `next dev` on `localhost:3000` | Vercel |
| App → worker API | `http://127.0.0.1:7421` | The worker's public HTTPS URL |
| State (`runs/`) | Laptop disk | The worker host's volume |
| Models | Any Pi provider, including Copilot through `~/.pi/agent/auth.json` | API-key providers: `opencode-go` / `opencode` (the spec's choice), `anthropic`, `openrouter` |
| Login | Basic Auth (`proxy.ts`), credentials from `.env.local` | Basic Auth, credentials from Vercel environment variables |
| Agent tooling | `inngest-dev` MCP (`.mcp.json`) | Inngest Cloud MCP plugin |

The worker runs Pi, `score_cmd` and the proxy in both modes. Inngest, whether the dev server or Cloud, never runs CodeClimb's code: it calls the worker. A coder step holds a Pi session for `timeouts.experiment_min` (15 minutes), so the worker has to be a long-running process. Vercel can't host that, and Vercel can't run `connect()`.

### How each piece picks its mode

Every switch already exists or is one environment variable. There's no mode flag in the code.

- **Inngest endpoint.** The SDK decides: `INNGEST_DEV=1` means the dev server, while `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` without `INNGEST_DEV` means Cloud. This is true for the worker, the CLI and the app.
- **Sandbox backend.** The night config's `sandbox` field. The configs keep `sandbox: docker`. The cloud override is a CLI flag (`--sandbox inngest`) or a field in the app's New run form, so each scenario keeps one YAML file.
- **Proxy path.** If `CODECLIMB_METER_URL` is set, sandboxes call that URL. If not, the Docker relay is used as today.
- **Worker API URL.** `CODECLIMB_WORKER_URL` and `CODECLIMB_WORKER_TOKEN` on the app side. They default to `http://127.0.0.1:7421`, with no token needed on loopback.
- **Env files.**
  - Local values stay in `.env.local`.
  - Cloud values for running from the laptop go in `.env.cloud.local`, which git also ignores (`.env*.local`). `codeclimb/env.ts` loads it when `CODECLIMB_ENV=cloud`.
  - On the hosted worker and on Vercel, the values are the platform's own secrets.
- **npm scripts.** `worker`, `run-night` and `dev` stay local. New `worker:cloud` and `run-night:cloud` use `CODECLIMB_ENV=cloud` and drop `INNGEST_DEV=1`.

A useful in-between mode: the laptop worker connected to Cloud, with Docker or Inngest sandboxes. Phases 0 and 1 use it, and it remains a handy way to debug Cloud runs.

### Inngest Sandboxes in local mode (to verify)

In dev mode the SDK sends `inngest.sandboxes` calls to the dev server without a key, and the dev server's MCP lists sandbox tools. So the dev server may support sandboxes, either by running them locally or by forwarding them to Cloud. If it does, the Inngest backend can be tested fully locally. If not, `sandbox: inngest` requires Cloud, and the worker rejects it at night start with a clear message.

## 2. What already fits

- `SandboxBackend` (`codeclimb/sandbox/types.ts`) is the spec's interface. `sandbox: "inngest"` is already in the config type, and `sandboxBackend("inngest")` currently throws "not implemented".
- Code moves through git bundles (`codeclimb/sandbox/repo.ts`), so a backend only needs `exec`, `readFile` and `writeFile`.
- `cancelOn` on every child, plus `run-cancelled-cleanup`, cover the spec's cancel caveats.
- `codeclimb-worker` (connect) and `codeclimb` (the Next.js app) are separate Inngest apps already.
- `buildReportData`, `client.js` and `exportExperiment` already produce everything the app shows and exports.
- The app login is done: `proxy.ts`, see section 6.

## 3. Findings that shape the work

1. **No custom image is needed.** The scenario images are `python:3.14-slim` + git + `/spec`. The fixed Inngest image already has Python 3.14 and git, so the backend uploads a `/spec` tarball when it creates a sandbox. `image.custom()` (SDK 4.25, MCP `create_build`) and snapshots are fallbacks. The beta docs say there are no custom images yet.
2. **Egress is open on Inngest Sandboxes.** Docker's `--network none` doesn't carry over, and the beta has no allowlist. The spec accepts this gap. Gold still never enters a sandbox, and provider keys stay on the worker. The coder prompt's "no other network access" line must change for `inngest`.
3. **Limits the backend must handle:**
   - `commands.run` stops watching after 5 minutes, so long commands use `processes.start` + `wait` loops.
   - A process keeps about 512 KiB of output.
   - Files transfer through the direct client (up to 100 MiB), not `step.sandbox`.
   - One hour of active runtime per sandbox, then an automatic pause.
4. **The evaluator reset kills every process but PID 1.** That's fine in Docker. In an Inngest VM it could kill the guest agent.
5. **Copilot's login file is a laptop setup.** Cloud configs use API-key models.
6. **The Cloud account is empty.** Sandbox access on Pro is unconfirmed.

## 4. Phases

Each phase must pass its own check, and also a local smoke night (`npm run run-night -- --config configs/datenorm-smoke.yaml`), so local mode never breaks.

| Phase | Change | Done when |
|---|---|---|
| 0 | Laptop worker on Inngest Cloud, Docker sandboxes | `datenorm-smoke` finishes on Cloud, and a stop cancels the children. Local smoke still passes. |
| 1 | Inngest Sandboxes backend | `datenorm-smoke` and `capitals-smoke` pass with `--sandbox inngest`. Local smoke on Docker still passes. |
| 2 | Worker on an always-on host | A Cloud night runs with the laptop closed |
| 3 | The app: prepare, start, live metrics, stop, export | A night runs end to end from the browser in **both** modes, and its solution downloads |

Phase 3 depends only on Phase 0, so it can be built locally in parallel with Phases 1 and 2.

### Phase 0: laptop worker on Inngest Cloud

- **Keys.** In the Inngest dashboard (`production`), create an event key and copy the signing key into `.env.cloud.local`.
- **Scripts.** Add `CODECLIMB_ENV` handling to `codeclimb/env.ts`, plus the `worker:cloud` and `run-night:cloud` scripts.
- **Run.** Start `npm run worker:cloud`. `codeclimb-worker` should appear in Cloud.
- **Smoke.** Run a smoke night, then a night you stop by hand.
- **Verify on Cloud:**
  - Stopping cancels the `step.invoke` children.
  - `inngest/function.cancelled` reaches `run-cancelled-cleanup`.
  - `scoreMiddleware` and `extendedTracesMiddleware` work.

### Phase 1: `InngestBackend` (`codeclimb/sandbox/inngest.ts`)

Use the direct `ccInngest.sandboxes` client inside the existing `step.run`s, because `step.sandbox` has no file transfer in the beta.

| Method | Docker | Inngest |
|---|---|---|
| `create` | `docker run`, 2 CPUs, 2 GB, a network | `sandboxes.create({ name, vcpu: 2, memoryMb: 2048, environment: { PYTHONDONTWRITEBYTECODE: "1" } })`, then upload the `/spec` tarball, then `cloneInto` |
| `find` | `docker inspect` | `list()` and match the name. Skip TERMINATED, and `resume()` if PAUSED. |
| `exec` | `docker exec` + `setsid` | `processes.start` with `["/bin/bash", "-c", cmd]`, then `wait` in a loop up to `timeoutMs`, then `getOutput`. Timeout or abort: `signal(9, includeChildren)`. `onData`: `streamOutput`. Stdin: a temp file plus a redirect. |
| `readFile` / `writeFile` | `cat` through `docker exec` | `files.download` / `files.upload` |
| `isAlive` / `instanceId` / `destroy` | inspect, container id, `rm -f` | status, sandbox `id`, `destroy()` |
| `sweep` by prefix | label + name filter | `list()` with paging, filtered by name prefix |
| `sweep` by run | `cc.run` label | No labels exist. Record each run's sandbox names in the night folder and destroy those. |

Other work in Phase 1:

- **Spec tarball.** Build it once per night in `initNight`.
- **Evaluator reset.** List the processes in a real sandbox first. Then skip the guest agent's processes, or kill only processes the backend started. If neither is safe, use a fresh sandbox per eval on `inngest`. Latency is then only compared within one candidate.
- **One-hour limit.** Split evaluator requests to stay under about 45 minutes, or add the attempt number to the sandbox name.
- **Proxy.** Read `CODECLIMB_METER_URL` in `codeclimb/meter/index.ts`. When it's set, skip `ensureMeterPath` and the relay. While the worker is still on the laptop, expose the proxy through a tunnel (`cloudflared` or `ngrok`).
- **Prompt.** The coder prompt's network line depends on the backend.

### Phase 2: always-on worker

- **Host.** One machine with a volume mounted at `runs/`. Use a single instance, because crash recovery reads local files.
- **Image.** Node 24, `git`, `python3`, and `scenarios/` + `configs/` copied in.
- **Paths.** Resolve config paths on the worker, relative to `CODECLIMB_ROOT`, instead of the CLI sending absolute laptop paths. `parseConfig` gains a mode that validates without resolving paths. This also lets the app start nights.
- **Public endpoints.** The worker serves the proxy (`CODECLIMB_METER_URL`) and the worker API, both over HTTPS.
- **Secrets.** The model keys (`OPENCODE_API_KEY`, ...), the Inngest keys, and `CODECLIMB_WORKER_TOKEN`.
- **Deploys.** Only redeploy between nights. A restarted worker can't replay a night started by older code.

### Phase 3: the app

Build it with `next dev` and a local worker, then deploy it to Vercel. Install the Inngest Vercel integration (it sets the keys and syncs the app), and set `CODECLIMB_USER`, `CODECLIMB_PASSWORD`, `CODECLIMB_WORKER_URL` and `CODECLIMB_WORKER_TOKEN` in Vercel. The design is in section 5.

## 5. The app

The app does four jobs: prepare a run, watch it live, stop it, export the result. It never runs Pi, sandboxes or scoring. It sends Inngest events and reads from the worker. The app behaves the same in both modes; only `CODECLIMB_WORKER_URL` and the Inngest endpoint differ.

### Data path

The worker is the only source of truth. Its `runs/` folder holds `results.jsonl`, `night.json` / `done.json`, reviews, `experiments.git` and each running experiment's `code-state.json`. The last one is rewritten after every Pi message with spend, tokens and elapsed time.

Vercel's server calls a small worker API with `CODECLIMB_WORKER_TOKEN`. The browser only ever calls Vercel. There's no database and nothing is stored twice. If the worker is down, history can't be shown, but no night can run either.

"Live" means polling every 5 seconds: rows arrive per round, coder spend per Pi turn. Inngest Realtime is a later upgrade. A Postgres mirror is the fallback if several workers ever share one app.

### Worker API (`codeclimb/api.ts`, served by `scripts/worker.ts`)

| Endpoint | Purpose |
|---|---|
| `GET /scenarios` | Scenario name, spec documents, metric names, dataset stats (counts per split, fold and family; never gold values), and default config. Also which sandbox backends this worker can use. |
| `POST /models/check` | `checkModels` with the worker's keys |
| `GET /nights` | Every night: scenario, status, round, best kept score, spend, start time |
| `GET /nights/:id` | `buildReportData` for one night |
| `GET /nights/:id/live` | Per branch: model, phase, elapsed, `coder_usd`, `dev_usd`, tokens. Plus spend so far. |
| `GET /nights/:id/diff/:exp` | The diff against the parent |
| `GET /nights/:id/export/:exp?format=tar.gz\|bundle` | The solution's files, or a git bundle with its lineage |
| `POST /nights/:id/export/:exp/push` | Optional push to a git remote (`exportExperiment`, off unless configured) |

Night status combines `done.json` with the Inngest run status, read from the dev server's API or Cloud's REST API depending on the mode. A crashed night never writes `done.json`, so the file alone isn't enough.

### Pages

- **`/` Nights.** A table: scenario, mode and backend, status, round, best score against threshold, spend against budget. A New run button.
- **`/new` Prepare a run.**
  1. Pick a scenario.
  2. Read its `SPEC.md` and `METRICS.md` and see the dataset's shape.
  3. Edit the run settings: sandbox backend (only those the worker supports), models, rounds, deadline, timeouts, budgets, thresholds, gates, latency and cost objectives, and `allowed_models`.
  4. Validate with `parseConfig` and check the models.
  5. Start. This sends `codeclimb/night.start`.
- **`/nights/[id]` Live night.**
  - Header: status, round, elapsed time against the deadline, spend against the budget, and **Stop**.
  - Per-branch live cards.
  - Scenario metrics: the convergence chart with threshold, validation and test, the family heatmap, and gates.
  - Latency: `latency_total_s`, plus p50 and p95 per operation.
  - Cost: `cost_per_item_usd`, `model_calls`, and spend split into coder, dev, program and reviewer.
  - The experiments table with feedback and diffs.
  - **Export.**

  Every number comes from `results.jsonl` and `code-state.json`, so the app and `report.html` always agree. Build it first by reusing `codeclimb/report/client.js` with a new `refresh(data)` hook. Port to React only if the page outgrows it.

### Stop and export

- **Stop.** Ask for confirmation, then send `codeclimb/night.stop`. The worker aborts Pi and destroys the sandboxes, and `cancelOn` cancels the runs. A stopped night has no test score. A later "finish now" could stop at the next round and still run the test eval.
- **Export.** The best kept commit is selected by default. The options:
  - Download a `.tar.gz` (`git archive`).
  - Download a git bundle with the lineage.
  - Push to a git remote (optional).

  Local "export to a directory" stays in `npm run export`.

### Code changes for the app

- `parseConfig` without path resolution, and `night.start` carries relative paths (shared with Phase 2).
- `phase` in `code-state.json`, an `eval-state.json` for the evaluator, and the current round in `night.json`.
- The worker API next to `connect()`.
- `refresh(data)` in `client.js`, and the export panel calls Vercel routes.
- Vercel routes, each a thin proxy to the worker or an `inngest.send`:
  - `POST /api/nights` and `POST /api/nights/:id/stop`
  - `GET /api/nights`, `GET /api/nights/:id`, `GET /api/nights/:id/live`
  - `GET /api/scenarios` and `POST /api/models/check`
  - `GET /api/nights/:id/export/:exp`

## 6. Access

- **App: done.** HTTP Basic Auth in `proxy.ts`, with one user (`CODECLIMB_USER`) and a 64-character random password (`CODECLIMB_PASSWORD`). It compares in constant time, fails closed when either is unset, and leaves `/api/inngest` open for Inngest's signed calls. Locally the credentials are in `.env.local`. On Vercel, set them as environment variables before the first deploy.
- **Worker API.** Requires `CODECLIMB_WORKER_TOKEN` on every request. In local mode it binds to loopback.
- **Proxy.** Per-eval tokens, revoked when the eval ends, as today.

## 7. Config changes

| Field | Local | Cloud |
|---|---|---|
| `sandbox` | `docker` (in the YAML) | `inngest` (CLI flag or form override) |
| `baseline` | Docker image name | Ignored; the spec comes from `spec_dir`. Later, a custom image. |
| Paths (`spec_dir`, `dataset_dir`, `run_files`, `score_cmd`, `results_path`) | Relative, resolved by the worker against its checkout | Same, against `CODECLIMB_ROOT` on the host |
| `models`, `reviewer_model` | Any Pi provider | API-key providers (overridden in the form, or a cloud config per scenario) |
| Proxy | Relay to `127.0.0.1`, random port | `CODECLIMB_METER_URL`, fixed port |

## 8. Questions for Inngest

1. Is the workspace on Pro with Sandboxes beta access? Can we run 5 concurrent sandboxes?
2. Is the active runtime 1 hour (docs) or 24 hours (pricing)? What happens to a running process at auto-pause?
3. Can egress be restricted to an allowlist?
4. Is image-build access (`create_build` → `image.custom()`) available?
5. Which processes in the sandbox VM belong to the guest agent?
6. Does the dev server run `inngest.sandboxes` calls locally, or forward them to Cloud?

## 9. Checklist

- [x] App login (`proxy.ts`, `.env.local`)
- [x] Pro account confirmed
- [ ] Confirm Sandboxes access: create one test sandbox, list its processes (this answers question 5), destroy it
- [ ] Send the questions to Inngest
- [x] Phase 0: `.env.cloud.local`, `CODECLIMB_ENV`, `:cloud` scripts, cloud smoke and stop test, local smoke. Verified 2026-10-29:
  - `cloud-smoke1` stopped on thresholds, with test accuracy 0.986 and $0.08 spent.
  - `cloud-stop1`: the night and its 3 children were cancelled, both cleanup functions ran, and the containers were gone within 4 s.
  - `step.score` writes reach Cloud.
  - `local-smoke1` passed on the dev server: 2 rounds, stopped on `max_rounds`, test accuracy 0.972.
  - Unit tests: 22 passed.
- [ ] Phase 1: `codeclimb/sandbox/inngest.ts`, safe reset, `CODECLIMB_METER_URL`, both smoke configs on `inngest`, local smoke on Docker
- [ ] Phase 2: host + volume, worker image, relative config paths, API-key models, public proxy and worker API
- [ ] Phase 3: worker API, New run / Live night / Nights pages, Stop, export, Vercel deploy and environment variables, a run in both modes
