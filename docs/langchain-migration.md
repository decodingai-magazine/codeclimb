# Plan: CodeClimb on the LangChain ecosystem

Status: 2026-11-10. Plan only; nothing built.

A second stack next to the Inngest one, not a replacement: `results.jsonl` already allows `stack: "inngest" | "langchain"`, and comparing the two stacks on the same scenarios is the point. Everything under `codeclimb/` stays shared; each stack gets its own thin orchestration layer.

## 1. Target setup

Two modes, as with Inngest today. The graph code is the same in both; the mode is the server URL plus the `sandbox` field.

| Piece | Local (free, Developer plan) | Cloud (Plus plan) |
|---|---|---|
| Orchestration + durability | `langgraph dev` (in-memory, persisted to a local folder), or `langgraph up` (Postgres + Redis in Docker) | LangSmith Deployment (managed Agent Server) |
| Function code (Pi, proxy, `runs/`) | In the local Agent Server process | In the deployment (see Phase 6) |
| Sandboxes | Docker (`sandbox: docker`) | LangSmith Sandboxes (`sandbox: langsmith`) |
| CLI + app | Local, SDK to `http://127.0.0.1:2024` | Local, SDK to the deployment URL |
| Tracing | LangSmith, 5k traces/month, or off | LangSmith, 10k traces/month |
| Agent tooling | `langchain-plugins` skills + docs MCP, local server REST API | Same, plus the `langsmith` MCP |

LangChain pieces adopted: LangGraph JS (`@langchain/langgraph`), the Agent Server (`@langchain/langgraph-cli`, `@langchain/langgraph-sdk`), LangSmith tracing and feedback (`langsmith`), LangSmith Sandboxes (`langsmith/sandbox`). Not needed: Fleet, Engine, Deep Agents, LLM Gateway.

Env: `LANGSMITH_*` in `.env.example`. A license key is only needed to self-host the Agent Server in production, which this plan does not do.

## 2. Component mapping

| Inngest (today) | LangChain | Where |
|---|---|---|
| `ccInngest` app, `connect()` worker (`scripts/worker.ts`) | Agent Server loading graphs from `langgraph.json` | `langgraph/` |
| `run-night` function | `entrypoint` "night", `thread_id = night_id` | `langgraph/night.ts` |
| `step.run` (36 calls) | `task()`: finished tasks come back from the checkpoint on replay | same |
| `step.invoke` `run-experiment`, `run-evaluator` | Child entrypoints called as subgraphs | `langgraph/experiment.ts`, `langgraph/evaluator.ts` |
| `retries: 2`, `NonRetriableError` | Retry policy with `retryOn` | per task or node |
| `step.invoke` `timeout` | The coder and evaluator's own deadlines (`experiment_min`, `eval_min`), plus node `timeout` as a backstop | already in `coder.ts` / `evaluate.ts` |
| `step.waitForEvent(night.resume, 3d)` | `interrupt()` + `Command({ resume })` | `pauseForCredits` |
| `step.sleep` (smoke-test wait) | `setTimeout` inside a task | `r<n>-smoke` |
| `night.start` event with a stable id | `threads.create` + `runs.create(..., { multitaskStrategy: "reject" })` | `NightControl` |
| `night.resume` | `runs.create` with `Command({ resume: true })` | `NightControl` |
| `night.stop` + `cancelOn` + `night-stop-cleanup` | `runs.cancel` + cleanup in the entrypoint's `finally` | `NightControl`, `night.ts` |
| `onFailure`, `inngest/function.cancelled` | `try/catch/finally` in the entrypoint; run webhook as a fallback | `night.ts` |
| `timeouts.finish: 4d` | `BG_JOB_TIMEOUT_SECS` above 4 days | `langgraph.json` env |
| `night.finished` → `distill-lessons`, `concurrency` per scenario | A lessons run on thread `lessons-<scenario>` with `multitaskStrategy: "enqueue"` | `langgraph/lessons.ts` |
| Inngest Sandboxes | LangSmith Sandboxes | `codeclimb/sandbox/langsmith.ts` |
| `extendedTracesMiddleware`, `@inngest/otel` | LangSmith tracing; `tracing.ts` spans exported to LangSmith | `codeclimb/tracing.ts` |
| `step.score` | `client.createFeedback(runId, key, { score })` | evaluator |
| Inngest dev server MCP, `inngest-cli api` | Local server REST API (`/threads/{id}/state`, `/history`, `/runs`), LangGraph Studio, `langsmith` MCP | AGENTS.md |

Unchanged: Pi, the metering proxy, `runs/`, git bundles, `SandboxBackend`, the worker API's routes, the app.

## 3. Open questions (Phase 0 spike)

Each one changes the design if the answer is no. Answer them in a throwaway graph before Phase 2.

1. **Cancel reaches a running task.** Does `runs.cancel` abort the run's `AbortSignal` while a task is inside a 20-minute Pi session? If not, `night.ts` must poll for the stop itself (the coder's watchdog already wakes every few seconds; it can also check `stop.json`).
2. **Retry on `task()`.** The docs show `retryPolicy` on StateGraph nodes only. If `task()` takes no retry policy, the coder and evaluator become nodes of small StateGraphs, called as subgraphs.
3. **Subgraph memoization.** A child entrypoint called from the night entrypoint: are its own tasks (`code`, `check`, `leaks`) restored on replay, as an invoked Inngest run's steps are?
4. **Determinism under replay.** The night loop is ~400 lines of plain code between steps. Confirm that replay with the same task results takes the same path (it should: all clock reads and I/O are already inside `step.run`).
5. **Restart of `langgraph dev`.** Does a run in flight survive a dev-server restart, or does the thread have to be resumed by hand with `invoke(null)`?
6. **Docker from the graph process.** `langgraph dev` runs graphs as a local Node process, so `DockerBackend` should work as is. `langgraph up` needs the Docker socket mounted, the `docker` CLI in the image and the proxy port published.
7. **Where the worker API lives.** Option A: a separate `npm run api` process, which reads `runs/` and drives nights through the SDK. Option B: mounted in the Agent Server through `langgraph.json` `http.app`, in the same process as the graphs, so `abortNight` keeps working in-process. B is simpler if cancel does not reach a running task (question 1).

## 4. Phases

### Phase 1: decouple the shared code from Inngest

Mechanical; the Inngest stack keeps working and its tests pass.

- **Run identity.** `runCoder(input, { attempt, runId })` and `openEvaluator(..., runId)` take Inngest's run id and retry count. Replace them with a stack-neutral `{ attempt, runKey }`. `runKey` is the experiment or evaluator id, which is deterministic; `attempt` comes from Inngest's `attempt` on that stack and from `code-state.json` on LangGraph (a state file already on disk means this is a retry).
- **Aborts and sweeps.** `registerLive(runId, ...)` and `sweepRun(runId)` (label `cc.run`) key on Inngest run ids. Key them on `runKey`; LangSmith Sandboxes has no labels in its JS SDK, so sweeps there go by name prefix, as `sweepNight` already does.
- **Night control.** `codeclimb/api.ts` (`resumeNight`, `stopNight`, `continueFrom`) and `scripts/run-night.ts` call `ccInngest.send` directly. Put a `NightControl` interface in front (`start`, `resume`, `stop`, `continue`) with the Inngest implementation behind it. Select it by a `stack` field in the night config, default `inngest`.
- **Results.** `ResultRow.stack` is the literal `"inngest"` (`results.ts`, `orchestrator.ts:370`); take it from the config. Add `"langsmith"` to the `backend` enum.
- **Limits.** `checkSandboxLimits` knows only Inngest's one-hour cap. Make it per backend (`maxActiveMs` on `SandboxBackend` already exists).

Done when `npm run typecheck` and `npm test` pass and a Docker smoke night still runs on Inngest.

### Phase 2: the night graph, local, Docker sandboxes

- **Dependencies.** Add `@langchain/langgraph`, `@langchain/langgraph-cli`, `@langchain/langgraph-sdk`, pinned to exact versions.
- **Port the functions.** `langgraph/night.ts`, `experiment.ts`, `evaluator.ts` and `lessons.ts` port `inngest/codeclimb/functions.ts` one to one: same calls into `codeclimb/`, same order. Each `step.run` becomes a `task`.
- **Pause.** `pauseForCredits` becomes `interrupt()`. Ending the pause stays `endPause` in a task.
- **Smoke-test retries.** The waits become `setTimeout` inside the smoke task.
- **Configuration.** `langgraph.json`: the four graphs, `node_version`, `env`, and `BG_JOB_TIMEOUT_SECS` above the night backstop.
- **Scripts.** Add `npm run dev:langgraph` (`langgraph dev`). For runs on the LangGraph stack, start the metering proxy lazily in the graph process: `meter()` already starts it on first use.

Done when a mock night (`configs/datenorm-smoke.yaml --mock`) runs to `done.json` under `langgraph dev`, started with `curl` or a scratch SDK script, and its `results.jsonl` rows validate with `npm run validate-results`.

### Phase 3: control, stop, pause, crash handling

- **`NightControl` for LangGraph**, through `@langchain/langgraph-sdk`:
  - start: `threads.create` with the night id, then `runs.create` with `multitaskStrategy: "reject"`; a second start of the same night is refused.
  - resume: a run with `Command({ resume: true })`.
  - stop: `markStopped`, then `runs.cancel`.
  - continue: a new run on the same thread.
- **Stop cleanup.** In the entrypoint's `finally`: `abortNight`, `sweepNight`, `markStopped`, then queue lessons. This replaces `night-stop-cleanup` and `run-cancelled-cleanup`.
- **Pause timeout.** Today `waitForEvent` times out after 3 days. Record the deadline with `markPaused`, which already writes it. A cron job, or a timer in the worker API process rearmed on boot, sends the resume with `{ timedOut: true }`, and the night stops.
- **Failure path.** `onFailure` becomes a catch in the entrypoint that runs the stop path. A run webhook to the worker API covers a run that dies outside the graph.
- **CLI.** `run-night --stack langchain`. Following a night already reads `runs/`, so it is unchanged.
- **App.** Unchanged: it calls the worker API, which calls `NightControl`.

Done when a real Docker night is stopped, paused for credits and resumed, and stopped again, from both the CLI and the app, with no sandbox left (`docker ps -a --filter label=cc.night=<night_id>` is empty).

### Phase 4: tracing and scores

- **Tracing.** Turn LangSmith tracing on through env. `tracing.ts` keeps its OTel spans (LLM, tool, sandbox, program) and exports them to LangSmith's OTLP endpoint, nested under the night run. That nesting keeps a night at a few root traces, so it stays well inside the 5k/month quota.
- **Scores.** `step.score` becomes `createFeedback` on the experiment's run. It mirrors the metrics only and is not used for decisions, as today.

Done when one night shows its rounds, Pi LLM spans and program spans as one trace in LangSmith, with metric feedback on each experiment.

### Phase 5: LangSmith Sandboxes backend

- **Backend.** `codeclimb/sandbox/langsmith.ts` implements `Sandbox` and `SandboxBackend`. The method mapping:

  | Codeclimb | LangSmith Sandboxes |
  |---|---|
  | create | `createSandbox` |
  | short exec | `run` |
  | long exec with streaming and kill | `run({ wait: false })` + `handle.kill()` |
  | readFile / writeFile | `read` / `write` |
  | destroy | `delete` |
  | find | by name |

- **Images.** Build a snapshot per scenario image from `docker/*.Dockerfile` with `createSnapshotFromDockerfile`, so `/spec` is baked in and nothing is uploaded at create.
- **Size.** 2 vCPU / 4 GiB. 2 GiB is below the minimum for 2 vCPU; the size can drop to 1 vCPU / 2 GiB if the scenarios fit.
- **Lifetime.** Set `idleTtlSeconds` above the longest quiet stretch of a Pi session, and a short `deleteAfterStopSeconds`, so a leaked sandbox is not billed for storage for 14 days.
- **Egress.** An allowlist through `proxyConfig.access_control`. This is parity with Docker's `network` option, which the Inngest backend lacks.
- **Metering.** `meterBaseUrl` treats `langsmith` like `inngest`: the proxy behind `npm run tunnel` or `CODECLIMB_METER_URL`.
- **Wiring.** `sandboxBackend("langsmith")`, `reachableBackends` when `LANGSMITH_API_KEY` is set, `--sandbox langsmith` in `run-night`, and the config enum.
- **Cost.** The free 8 LSU/month buys about 42 sandbox-hours at 2 vCPU / 4 GiB.

Done when a night runs with `sandbox: langsmith` from `langgraph dev`, metered, and a stop leaves no sandbox.

### Phase 6 (optional): cloud deployment

Only if nights should run with the laptop off. It needs Plus, a GitHub connection, and workspace secrets for the model keys (replacing `~/.pi/agent/auth.json`). Two things leave the laptop and need a new home:
- **`runs/`:** the app reads it from disk. Options are the LangGraph store, object storage, or a sync back to the laptop.
- **The metering proxy:** LangSmith Sandboxes must reach the deployment instead of a tunnel.

Decide after Phase 5.

### Phase 7: agent tooling and docs

- **AGENTS.md:** a "LangGraph debugging" section next to "Inngest debugging", covering the local server REST API with `curl` and `jq`, LangGraph Studio, and the `langsmith` MCP.
- **`codeclimb-e2e` skill:** extend it to run its checks on the LangChain stack.
- **README:** the two stacks and how to start each.

The `langchain-plugins` marketplace (skills, docs MCP, `langsmith` MCP) is already enabled in `.claude/settings.json`.

## 5. Gaps that remain by design

- **No remote orchestration in local mode.** Nothing outside the laptop drives a night. While the worker is down, the night waits; it resumes from its last checkpoint.
- **Run retries.** The Agent Server retries a run only for transient Postgres errors. Every other retry is the graph's own retry policy.
- **Cancel granularity.** This is open question 1. If cancel cannot interrupt a running task, the stop path keeps codeclimb's own abort registry, as it does today for the same reason on Inngest.
