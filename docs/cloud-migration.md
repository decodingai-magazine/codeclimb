# Plan: CodeClimb on local Inngest and on Inngest Cloud

Status: 2026-10-30. Done: the app login (`proxy.ts`), Phase 0 (laptop worker on Cloud), Phase 1 (Inngest Sandboxes backend), Phase 2 (decided: no hosting, see below), and Phase 3 (the app). Left: a Cloud night end to end from the app.

This plan follows the production design in the vault spec `8 - Projects/CodeClimb/codeclimb-spec-inngest.md`. One codebase runs in two modes, and both stay supported for good. Both run CodeClimb on your machine:

- **Local:** the Inngest dev server, the worker, Docker sandboxes, and the app on `localhost`.
- **Cloud:** Inngest Cloud for durability, the same worker on your machine, Inngest Sandboxes, and the same app on `localhost`.

CodeClimb is headless: the worker's API is the interface, and the app is one client of it. Something else can integrate later through that API or by sending `codeclimb/night.start` and `codeclimb/night.stop`.

## 1. The two modes

| Piece | Local | Cloud |
|---|---|---|
| Orchestration | Inngest dev server (`npm run dev:inngest`, port 8288) | Inngest Cloud (Pro), `production` environment |
| Function code | Worker on your machine: `connect()` to the dev server | Worker on your machine: `connect()` to Cloud (`npm run worker:cloud`), holding `caffeinate` on macOS |
| Sandboxes | Docker (`sandbox: docker`) | Inngest Sandboxes (`sandbox: inngest`) |
| Metering proxy | Worker on `127.0.0.1`, reached through the `cc-meter` Docker network and relay | Worker on port 7422, published by `npm run tunnel` (ngrok) or `CODECLIMB_METER_URL` |
| App | `next dev` on `localhost:3000` | Same |
| App → worker API | `http://127.0.0.1:7421` | Same |
| State (`runs/`) | Your disk | Same |
| Models | Any Pi provider, including Copilot through `~/.pi/agent/auth.json` | Same |
| Login | Basic Auth (`proxy.ts`), credentials from `.env.local` | Same |
| Agent tooling | `inngest-dev` MCP (`.mcp.json`) | Inngest Cloud MCP plugin |

The worker runs Pi, `score_cmd` and the proxy in both modes. Inngest, whether the dev server or Cloud, never runs CodeClimb's code: it calls the worker. A coder step holds a Pi session for `timeouts.experiment_min`, so the worker is a long-running process, and your machine must stay on and online until a night ends. If the worker drops off, Inngest Cloud keeps the run and retries the step when it reconnects.

### How each piece picks its mode

Every switch already exists or is one environment variable. There's no mode flag in the code.

- **Inngest endpoint.** The SDK decides: `INNGEST_DEV=1` means the dev server, while `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` without `INNGEST_DEV` means Cloud. This is true for the worker, the CLI and the app.
- **Sandbox backend.** The night config's `sandbox` field. The configs keep `sandbox: docker`. The cloud override is a CLI flag (`--sandbox inngest`) or a field in the app's New run form, so each scenario keeps one YAML file.
- **Proxy path.** If `CODECLIMB_METER_URL` is set, sandboxes call that URL. If not, the Docker relay is used as today.
- **Worker API URL.** `CODECLIMB_WORKER_URL` and `CODECLIMB_WORKER_TOKEN` on the app side. They default to `http://127.0.0.1:7421`, with no token needed on loopback.
- **Env files.**
  - Local values stay in `.env.local`.
  - Cloud values for running from the laptop go in `.env.cloud.local`, which git also ignores (`.env*.local`). `codeclimb/env.ts` loads it when `CODECLIMB_ENV=cloud`.
- **npm scripts.** `worker`, `run-night` and `dev` stay local. New `worker:cloud` and `run-night:cloud` use `CODECLIMB_ENV=cloud` and drop `INNGEST_DEV=1`.

A useful in-between mode: the laptop worker connected to Cloud, with Docker or Inngest sandboxes. Phases 0 and 1 use it, and it remains a handy way to debug Cloud runs.

### Inngest Sandboxes in local mode (verified)

In dev mode the SDK sends `inngest.sandboxes` calls to the dev server, which runs nothing locally: it forwards them to Cloud only after an interactive `inngest login --force`. So `sandbox: inngest` needs the cloud worker (`npm run worker:cloud`), and `sandboxBackend("inngest")` throws a clear message when `INNGEST_DEV` is set.

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
3. **Limits the backend handles** (measured 2026-10-29 with `scripts/smoke-inngest-sandbox.ts`):
   - `commands.run` stops watching after 5 minutes and can't be killed, so only short helpers use it (about 0.3 s a call). Pi's commands, timeouts and aborts use `processes.start` + `streamOutput` + `wait` in 60 s slices + `signal(9)`. A killed shell's orphaned children die about a second later.
   - A process keeps about 512 KiB of output.
   - Files transfer through the direct client (up to 100 MiB) at about 100 KB/s: 3 MiB takes about 35 s. Bundles and outputs are small, so this is fine. `files.upload` doesn't create parent directories.
   - The SDK's base64 check overflows the stack on multi-MiB command output, so `readFile` inlines files up to 64 KiB and downloads bigger ones.
   - One hour of active runtime per sandbox, then an automatic pause. The docs (2026-10) say it can't be raised, paused time doesn't count, and resume restores memory, processes and the *remaining* runtime, so resuming doesn't reset the clock. Measured 2026-10-30: a 1 vCPU sandbox running a loop stayed RUNNING for 78 minutes and never paused, so the limit wasn't enforced then. The docs also say the pause's timing isn't guaranteed. The guards below stay, since the limit is documented.
   - A snapshot takes about 16 s for a 2 GiB sandbox (30 MB stored, kept 24 h), and the source keeps running. A sandbox created from it starts in 1 to 3 s with files, environment and running processes intact, under any free name, including its source's after that one is destroyed.
   - A sandbox normally starts in 1.5 s. Once, three starts hung in STARTING with "sandbox launch result is unknown", so `create` replaces a sandbox that isn't running after 45 s.
   - `list()` returns terminated sandboxes too, so sweeps page through the whole history.
4. **The evaluator reset spares the guest agent.** The VM's agent runs as PIDs 1, 8, 9 and 10, all named `init`, and the reset skips processes named `init`.
5. **Copilot's login file is a laptop setup,** which is fine now that the worker stays on the laptop in both modes.
6. **Sandboxes work on Pro.** The base image has Python 3.14.6 and git 2.55; three parallel creates take 1.3 s.

## 4. Phases

Each phase must pass its own check, and also a local smoke night (`npm run run-night -- --config configs/datenorm-smoke.yaml`), so local mode never breaks.

| Phase | Change | Done when |
|---|---|---|
| 0 | Laptop worker on Inngest Cloud, Docker sandboxes | `datenorm-smoke` finishes on Cloud, and a stop cancels the children. Local smoke still passes. |
| 1 | Inngest Sandboxes backend | `datenorm-smoke` and `capitals-smoke` pass with `--sandbox inngest`. Local smoke on Docker still passes. |
| 2 | ~~Worker on an always-on host~~ Decided against: the worker stays on your machine | — |
| 3 | The app: prepare, start, live metrics, stop, export | A night runs end to end from the browser in **both** modes, and its solution downloads |
| 4 | Metering through a tunnel, keep-awake | A metered night on Inngest Sandboxes reaches the proxy through `npm run tunnel` |

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
| `readFile` / `writeFile` | `cat` through `docker exec` | Up to 64 KiB: `base64` through `commands.run`; bigger: `files.download`. `files.upload`, with `mkdir -p` and a retry on 404. |
| `isAlive` / `instanceId` / `destroy` | inspect, container id, `rm -f` | status, sandbox `id`, `destroy()` |
| `sweep` by prefix | label + name filter | `list()` with paging, filtered by name prefix |
| `sweep` by run | `cc.run` label | No labels exist, and `inngest/function.cancelled` carries only the run id. The worker keeps each run's sandbox names in memory; the night's prefix sweep covers a restarted worker. |

Other work in Phase 1 (done):

- **Spec tarball.** `create` tars `spec_dir` on the worker and unpacks it at `/spec` (`specDir` in `CreateSandboxOptions`), plus the git defaults the Docker image sets.
- **Evaluator reset.** Skips the guest agent's `init` processes; verified on a real sandbox.
- **Proxy.** `meterBaseUrl(cfg)`: `CODECLIMB_METER_URL` on `inngest`, the relay on Docker. Verified through an ngrok tunnel.
- **Prompt.** The coder prompt's network line depends on the backend.
- **Cleanup.** `night-stop-cleanup`, `run-cancelled-cleanup` and the end of a night sweep every backend the worker reaches; `night.stop` no longer carries `sandbox`.
- **CLI.** `run-night --sandbox docker|inngest` overrides the config.
- **The one-hour limit (done, 2026-10-30).** Every sandbox stays under its hour:
  - A coder sandbox lives for one experiment. Its time limit counts from the experiment's start across retries, and a fresh restart gets a new sandbox. On `inngest`, `checkSandboxLimits` caps `timeouts.experiment_min` and `timeouts.eval_min` at 50 minutes. `parseConfig` runs it, and so does `run-night` after `--sandbox`.
  - A round's evaluator still runs its candidates in turn on one sandbox, so their latencies stay comparable. Before each candidate, `openEvaluator` replaces it with a new sandbox if `eval_min` plus 5 minutes no longer fits in the hour (the backend's `maxActiveMs`, against `ageMs`, the wall time since start). Candidates after the swap run on another instance, so `decideRound` doesn't compare their latency with the earlier ones'. Verified on real sandboxes: with `eval_min` 3 the evaluator was reused; with 56 it was replaced.
  - Snapshots aren't used. With 20–36 KB specs, a base snapshot saves nothing: a fresh sandbox plus setup takes about 2.5 s, and one from a snapshot about 2 s after a 16 s snapshot. Nothing runs past its time limit, so no sandbox needs moving to a new one. They stay available as a fallback: snapshot plus create-from-snapshot under the same name moves a live sandbox in about 3 s.

### Phase 2: no hosting (decided 2026-10-30)

The worker stays on your machine in both modes; Inngest Cloud provides the durability and Inngest Sandboxes the isolated compute. The always-on host and the Vercel app were dropped as extra moving parts:

- **A worker host** (Fly.io, Railway, Render) means another platform, a volume, a public API and a deploy rule (only between nights). `Dockerfile.worker` and the hosting docs were removed.
- **Vercel instead of a worker** would need every piece of worker state moved off the disk (a store for `runs/`, git bundles instead of `experiments.git`, scoring and diffs in sandboxes), the proxy as a route, and coder steps cut under Vercel's function limit (300 s on Hobby, 800 s on Pro), or Pi moved into the sandboxes. Vercel Blob on Hobby allows 2,000 uploads and list calls a month and then locks for 30 days, so it would need Upstash or similar.

Kept from the Phase 2 code: config paths travel relative and resolve against `CODECLIMB_ROOT` (`relativeConfig` / `rootConfig`), the worker API and the proxy share a port, and the sandbox list offers Docker only when a daemon answers. A later move, if the machine must be free: run Pi inside the sandboxes, so the worker only orchestrates.

### Phase 3: the app

Built and run with `next dev` against the worker on the same machine, in both modes. The design is in section 5.

Code done and verified locally (2026-10-30): night `app-smoke1` was prepared and started from `/new` in the browser, watched live (three branches coding, spend per Pi turn), finished on thresholds (test accuracy 1.0, $0.05) and exported as `.tar.gz` and git bundle; night `app-stop1` was started through the app's API and stopped mid-round (containers gone within 1 s, status `stopped`).

Changes from the design below:

- **The worker starts and stops nights,** not the app: `POST /api/nights` and `/api/nights/:id/stop` send the events with the worker's keys, so the app needs no Inngest keys.
- **One proxy route** (`app/api/worker/[...path]`) instead of one route per endpoint.
- **The live page embeds the worker's report** (`GET /api/nights/:id/report`) in an iframe reloaded when a result row lands, instead of a `refresh(data)` hook in `client.js`.
- **Status** comes from `done.json`, `stop.json` (written by the stop handler) and file activity (no write for an hour without `done.json` means `stale`), not from Inngest's run status.
- **Not built:** `POST /models/check` (start checks the models), diffs per experiment (they are in the report), push-to-remote export, and `phase` for the evaluator.

## 5. The app

The app does four jobs: prepare a run, watch it live, stop it, export the result. It never runs Pi, sandboxes or scoring. It sends Inngest events and reads from the worker. The app behaves the same in both modes; only `CODECLIMB_WORKER_URL` and the Inngest endpoint differ.

### Data path

The worker is the only source of truth. Its `runs/` folder holds `results.jsonl`, `night.json` / `done.json`, reviews, `experiments.git` and each running experiment's `code-state.json`. The last one is rewritten after every Pi message with spend, tokens and elapsed time.

The app's server calls the worker API (with `CODECLIMB_WORKER_TOKEN` when it's off loopback). The browser only ever calls the app. There's no database and nothing is stored twice. If the worker is down, history can't be shown, but no night can run either.

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
- `refresh(data)` in `client.js`, and the export panel calls the app's routes.
- App routes, each a thin proxy to the worker or an `inngest.send`:
  - `POST /api/nights` and `POST /api/nights/:id/stop`
  - `GET /api/nights`, `GET /api/nights/:id`, `GET /api/nights/:id/live`
  - `GET /api/scenarios` and `POST /api/models/check`
  - `GET /api/nights/:id/export/:exp`

## 6. Access

- **App: done.** HTTP Basic Auth in `proxy.ts`, with one user (`CODECLIMB_USER`) and a 64-character random password (`CODECLIMB_PASSWORD`). It compares in constant time, fails closed when either is unset, and leaves `/api/inngest` open for Inngest's signed calls. The credentials are in `.env.local`.
- **Worker API.** Binds to loopback with no token. Off loopback (`CODECLIMB_API_HOST`), it requires `CODECLIMB_WORKER_TOKEN` on every request.
- **Proxy.** Per-eval tokens with a budget cap, revoked when the eval ends. In Cloud mode only the proxy's port is tunnelled, never the API's.

## 7. Config changes

| Field | Local | Cloud |
|---|---|---|
| `sandbox` | `docker` (in the YAML) | `inngest` (CLI flag or form override) |
| `baseline` | Docker image name | Ignored; the spec comes from `spec_dir`. Later, a custom image. |
| Paths (`spec_dir`, `dataset_dir`, `run_files`, `score_cmd`, `results_path`) | Relative, resolved by the worker against its checkout | Same |
| `models`, `reviewer_model` | Any Pi provider | Same |
| Proxy | Relay to `127.0.0.1`, random port | Port 7422 through the tunnel |

## 8. Questions for Inngest

1. ~~Is the workspace on Pro with Sandboxes beta access?~~ Yes. How many concurrent sandboxes can we run? (3 tested.)
2. ~~Is the active runtime 1 hour (docs) or 24 hours (pricing)?~~ One hour, per the docs; it can't be raised. But a sandbox ran 78 minutes without pausing (2026-10-30, 09:03–10:21 UTC). Is the limit enforced yet, and when will it be? Does a sandbox created from a snapshot start a fresh hour? (That test was inconclusive, since its source never paused.)
3. Can egress be restricted to an allowlist?
4. Is image-build access (`create_build` → `image.custom()`) available?
5. ~~Which processes in the sandbox VM belong to the guest agent?~~ PIDs 1, 8, 9, 10, named `init`.
6. ~~Does the dev server run `inngest.sandboxes` calls locally?~~ No: it forwards them to Cloud after `inngest login`.
7. Creates hung in STARTING with "sandbox launch result is unknown" twice in about 20 (2026-10-29, 20:42 UTC: three at once; 20:52 UTC: one, replaced after about 110 s). Is that a known beta issue?

## 9. Checklist

- [x] App login (`proxy.ts`, `.env.local`)
- [x] Pro account confirmed
- [x] Confirm Sandboxes access: create one test sandbox, list its processes (this answers question 5), destroy it
- [ ] Send the questions to Inngest
- [x] Phase 0: `.env.cloud.local`, `CODECLIMB_ENV`, `:cloud` scripts, cloud smoke and stop test, local smoke. Verified 2026-10-29:
  - `cloud-smoke1` stopped on thresholds, with test accuracy 0.986 and $0.08 spent.
  - `cloud-stop1`: the night and its 3 children were cancelled, both cleanup functions ran, and the containers were gone within 4 s.
  - `step.score` writes reach Cloud.
  - `local-smoke1` passed on the dev server: 2 rounds, stopped on `max_rounds`, test accuracy 0.972.
  - Unit tests: 22 passed.
- [x] Phase 1: `codeclimb/sandbox/inngest.ts`, safe reset, `CODECLIMB_METER_URL`, both smoke configs on `inngest`, local smoke on Docker. Verified 2026-10-29:
  - `scripts/smoke-inngest-sandbox.ts`: every backend method on a real sandbox.
  - `inngest-smoke1`: three coder sandboxes hung in STARTING ("launch result is unknown"); `run-night stop` destroyed all of them. That led to the replace-after-45-s fix.
  - `inngest-smoke2` (`datenorm-smoke --sandbox inngest`): stopped on thresholds after round 1, test accuracy 0.9861, $0.0685, no leftovers.
  - `inngest-capitals1` (`capitals-smoke --sandbox inngest`, proxy through ngrok): thresholds, test accuracy 1.0, 4 metered program calls in the test eval, 22 chat calls through the tunnel in total, $0.004. One coder sandbox hung at launch and was replaced.
  - `local-smoke2` (dev server + Docker): `max_rounds`, test accuracy 1.0.
  - Results validate (60 and 19 rows); 22 unit tests pass; typecheck OK.
- [x] Phase 2: relative config paths; hosting decided against, worker image removed
- [x] Phase 3 code: worker API, New run / Live night / Nights pages, Stop, export; a local night end to end from the browser
- [x] Phase 4 code: `npm run tunnel` and tunnel discovery, proxy pinned to 7422 in Cloud mode, `caffeinate` on macOS
- [ ] A Cloud night from the app (`worker:cloud`, `sandbox: inngest`), and a metered one through the tunnel
