# CodeClimb on LangGraph: build tickets

45 tickets that rebuild CodeClimb from `docs/codeclimb-spec-langchain.md` alone. Each ticket names the spec sections it implements by heading; the spec is the contract, the ticket only scopes it. One file per ticket: `<NN>-<slug>.md`.

## How to work them

- Work a ticket only when every ticket in its "Blocked by" is done. Numbers are in dependency order: a blocker always has a lower number.
- Given inputs are present and are consumed, not rebuilt: `scenarios/`, `configs/` and `docker/` (the two Dockerfiles). Ticket 01 creates the rest of the scaffold. A test that needs a different scenario or config uses a temporary copy inside the checkout but outside `scenarios/` and `configs/`, with its own name and a results directory directly under `runs-langchain/`.
- Preconditions for every ticket that runs a night or a Docker test: Docker is running; `.env` exists with `LANGSMITH_API_KEY` (the server container exits with code 3 without it); `LANGSMITH_TRACING=false` unless the ticket is about tracing.
- Nights run one at a time: one night per server, and the relay is shared. Tickets whose blockers allow parallel work must still take turns on the Agent Server.
- After a code change the Agent Server needs `npm run server` again before a night sees it.
- Every ticket ends with `npm run typecheck` and `npm test` passing, plus the checks it lists.
- "Not yet" in a ticket lists behaviour a later ticket adds. Leave it out; do not stub it with guesses.
- Tickets 01 to 44 are `ready-for-agent` and need no paid call: the real-model paths (tickets 24, 42 and 43) are verified with stubbed providers; whole nights run with `--mock`.
- Ticket 45, nights 8 to 11 of "Goal and done signal" (real models, paid), is `ready-for-human`: each night runs only with the operator's go-ahead for that run, after its ceiling was named. Ticket 44, the final acceptance, does not wait for it.
- The order follows the spec's "Suggested build order", cut so that a mock night runs at ticket 15 and nights 1 to 3 of the done signal pass at ticket 25. Tickets 26 to 43 are gated on ticket 25, directly or through a blocker (all but ticket 33, the pure lessons file), and those that touch the loop rerun its check.

## Phases

| # | phase | tickets |
|---|---|---|
| 1 | Scaffold | 01 |
| 2 | Contracts and pure functions | 02 to 06 |
| 3 | Experiment repository, sandbox, runtime primitives | 07 to 09 |
| 4 | Pi sessions and mock models | 10 |
| 5 | Coder | 11 to 12 |
| 6 | Evaluator | 13 |
| 7 | Tracer night: the first mock night | 14 to 15 |
| 8 | Review, notes, send-backs | 16 to 19 |
| 9 | Metering | 20 to 22 |
| 10 | Noise run | 23 |
| 11 | Model checks, soft stops, smoke test | 24 |
| 12 | Check table passes on the base mock nights | 25 |
| 13 | Hard stop and cleanup | 26 |
| 14 | Crash resume | 27 to 28 |
| 15 | Pause for credits | 29 to 30 |
| 16 | Repair | 31 |
| 17 | Continue | 32 |
| 18 | Lessons | 33 to 34 |
| 19 | Multi-stage mock night | 35 |
| 20 | Seed and rescore | 36 |
| 21 | Worker API | 37 to 38 |
| 22 | Export | 39 |
| 23 | App | 40 |
| 24 | Tracing | 41 |
| 25 | Real-model paths | 42 to 43 |
| 26 | Final acceptance | 44 |
| 27 | Operator-gated nights | 45 |

- phase 3: ticket 09, the step wrapper, is the one place where a step body meets LangGraph; it comes before the coder and the evaluator because their bodies take its abort signal
- phase 12 is the gate: nights 1 to 3 of "Goal and done signal" pass every row of their tables before any phase after it starts. Nights 4 to 7 pass in the tickets that build what they prove (26, 27, 28, 35), and all seven run together in ticket 44
- phase 14: ticket 28, `--mock-offline`, belongs here: a lost connection is a failure the coder's session survives
- phase 15: ticket 30 holds the pause timeout and the variation backstop, both timers
- phase 21: ticket 38, the watchdog, runs in the worker API's process

## Breakdown

1. **Scaffold and Agent Server boot** (`01-scaffold-and-agent-server-boot.md`) — blocked by: none. Pinned dependencies, the fixed npm scripts, `langgraph.json` with placeholder `night`, `stop` and `lessons` graphs, the compose override, `.dockerignore`, `server` / `server:logs` / `server:stop`, the env loader, the `codeclimb-python` image; `/ok` answers on `127.0.0.1:8123`.
2. **Scenario and night config loading** (`02-scenario-and-night-config-loading.md`) — blocked by: 01. `scenario.yaml` and night config parsed and validated, night-id rules, deadline parsing, the mock results path, the scoring hashes.
3. **Host commands, placeholders and masking** (`03-host-commands-placeholders-and-masking.md`) — blocked by: 02. The host command runner, placeholder substitution, the `bundle`, `check` and `scan` commands, masking, the bundle rebuild that keeps `history/`.
4. **Stage reports and standard metrics** (`04-stage-reports-and-standard-metrics.md`) — blocked by: 01. Report flattening, stage prefixes, `output_bytes`, latency metrics from `timings.jsonl`, cost metrics from ledger rows.
5. **Weighted score, keep rule, noise margin and stop checks** (`05-weighted-score-keep-rule-noise-margin-and-stop-checks.md`) — blocked by: 01. The pure decision functions and the soft-stop check.
6. **Result rows and `validate-results`** (`06-result-rows-and-validate-results.md`) — blocked by: 01. The row schema, the validated and deduplicated append, the `validate-results` command.
7. **Experiment repository** (`07-experiment-repository.md`) — blocked by: 01. `experiments.git`: the starter commit with a fixed SHA, experiment refs, aliases, tree comparison, git bundles in and out, diffs.
8. **Sandbox interface and Docker backend** (`08-sandbox-interface-and-docker-backend.md`) — blocked by: 07. One sandbox interface and its Docker backend: create, exec with process-tree kill, file transfer, find by name, sweep.
9. **Step wrapper, abort signal and live registry** (`09-step-wrapper-abort-signal-and-live-registry.md`) — blocked by: 01. Steps as saved units with retry, failure as data, backstop timers, one abort signal, the live registry.
10. **Pi sessions: mock models and sandbox tools** (`10-pi-sessions-mock-models-and-sandbox-tools.md`) — blocked by: 08. Isolated Pi sessions whose four tools act in a sandbox; the scripted `mock` provider for coder, reviewer and lessons.
11. **Coder prompt** (`11-coder-prompt.md`) — blocked by: 02, 05. The coder's prompt as a pure function: sections, rules, targets / met / fragile, repair variant.
12. **Coder experiment: code step and commit** (`12-coder-experiment-code-step-and-commit.md`) — blocked by: 03, 07, 09, 10, 11. One experiment's coder on a sandbox: stops, state files, the one squashed commit in `experiments.git`.
13. **Evaluator, unmetered** (`13-evaluator-unmetered.md`) — blocked by: 03, 04, 07, 08, 09. One evaluation of a commit on its own sandbox: reset, environment, stages, score, metrics, files.
14. **Threads and the start operation** (`14-threads-and-the-start-operation.md`) — blocked by: 02. Thread ids, the newest-thread search, start with one night per night id.
15. **Tracer night: `datenorm-smoke` on mock models** (`15-tracer-night-datenorm-smoke-on-mock-models.md`) — blocked by: 05, 06, 12, 13, 14. The `night` graph and `run-night`: init, rounds (code, evaluate, decide, record, keep), stops, test evaluation, `done.json`.
16. **Notes, history, rejected diffs and trajectory** (`16-notes-history-rejected-diffs-and-trajectory.md`) — blocked by: 03, 15. The memory within a night, written to the bundle's `history/` and read by the next coder.
17. **Reviewer** (`17-reviewer.md`) — blocked by: 16. The review of every round: evidence with caps, the JSON reply, the leak loop, review files, the hypothesis handed to the next round.
18. **Send-backs, reserve and wrap-up** (`18-send-backs-reserve-and-wrap-up.md`) — blocked by: 15. The coder is sent back until its reserve, then wrapped up once.
19. **Check, leak scan and guardrails** (`19-check-leak-scan-and-guardrails.md`) — blocked by: 17. `check` and `scan` on each commit, `check.json`, the held-out-name guardrail.
20. **Metering proxy: ledgers, routes, refusals, replay** (`20-metering-proxy-ledgers-routes-refusals-replay.md`) — blocked by: 04. The `/v1` server with per-token ledgers, the refusal order, ledger rows, canned mock answers, the replay cache.
21. **Relay and path to the proxy** (`21-relay-and-path-to-the-proxy.md`) — blocked by: 08, 20. `cc-meter`, the `cc-meter-relay` forwarder, the "path is up" check.
22. **Metered nights: mock nights 1 and 3 pass** (`22-metered-nights-mock-nights-1-and-3-pass.md`) — blocked by: 17, 18, 21. Meter tokens in the coder and the evaluator, the two ledgers, cost metrics; capitals-smoke and the plateau night.
23. **Noise run; mock night 2 passes in full** (`23-noise-run-mock-night-2-passes.md`) — blocked by: 17, 18, 22. The A/A run, `noise.json`, noise rows; every unmetered row of the done signal's table holds for night 2.
24. **Model checks, every soft stop, smoke test and outage** (`24-model-checks-soft-stops-smoke-test-and-outage.md`) — blocked by: 22, 23. The model check on the CLI and in the night's first step, the round-start smoke test, the `outage` stop; every soft stop proven on the loop.
25. **Check table: mock nights 1 to 3 as one repeatable check** (`25-check-table-mock-nights-1-to-3.md`) — blocked by: 19, 22, 23, 24. Nights 1 to 3 of the done signal as one repeatable check that asserts every row of the table; later tickets rerun it.
26. **Stop operation and cleanup; mock night 4 passes** (`26-stop-operation-and-cleanup-mock-night-4-passes.md`) — blocked by: 15, 25. The `stop` graph, `run-night stop`, the night's failure and cancel paths, the create refusal.
27. **Crash resume; mock night 5 passes** (`27-crash-resume-mock-night-5-passes.md`) — blocked by: 23, 25. A killed server reruns only the running step; the coder's state file drives session resume and the fresh restart.
28. **Lost connection mid-turn; mock night 6 passes** (`28-lost-connection-mid-turn-mock-night-6-passes.md`) — blocked by: 23, 25. `--mock-offline N` and the rule that a turn ended by a failed model call is sent back.
29. **Pause for credits and resume** (`29-pause-for-credits-and-resume.md`) — blocked by: 22, 25, 26, 27. Credit stops, the night's interrupt, `pause.json`, `run-night resume`, `mock_credit`.
30. **Pause timeout and variation backstop** (`30-pause-timeout-and-variation-backstop.md`) — blocked by: 29. The timer operation: delayed `stop` runs that end a pause after 3 days and a variation after 4, each behind its guard.
31. **Repair** (`31-repair.md`) — blocked by: 17, 19, 25. One repair attempt `e1` for a commit that failed before it was scored.
32. **Continue** (`32-continue.md`) — blocked by: 23, 25, 26. More rounds on an ended night: reopening, the rebuilt state, a new thread, `run-night continue`.
33. **Lessons file, operations and gates** (`33-lessons-file-operations-and-gates.md`) — blocked by: 01. The `lessons.md` format, `add` / `edit` / `drop`, every gate, the rewrite and prune rounds, the proposal files.
34. **Lessons distillation: graph, trigger and CLI** (`34-lessons-distillation-graph-trigger-and-cli.md`) — blocked by: 17, 25, 26, 33. The `lessons` graph, its queue per scenario, the start at a night's end and at a stop, the `lessons` command.
35. **Graphrag mock night; mock night 7 passes** (`35-graphrag-mock-night-mock-night-7-passes.md`) — blocked by: 22, 31, 34. The `codeclimb-graphrag` image and a three-stage, metered scenario with `check`, `scan` and lessons, end to end.
36. **Seed and rescore** (`36-seed-and-rescore.md`) — blocked by: 25, 32, 34. A night that starts from an ended night's kept commit; the rescore round when the scoring hashes changed.
37. **Worker API** (`37-worker-api.md`) — blocked by: 29, 32. The `api` process: night summaries, live view, report, stop, resume, continue.
38. **Watchdog** (`38-watchdog.md`) — blocked by: 27, 37. Crash recovery past the server's own: resume an errored thread twice, then stop; stop a night whose thread is lost.
39. **Export** (`39-export.md`) — blocked by: 37. A kept commit as plain files, as a git repository with its lineage, or pushed to a remote; the `export` command and the API's export endpoints.
40. **App** (`40-app.md`) — blocked by: 35, 39. The Next.js client of the worker API: the nights list and the night page.
41. **Tracing and feedback** (`41-tracing-and-feedback.md`) — blocked by: 22, 25. CodeClimb's tracer on LangSmith, one trace per experiment, dev metrics mirrored as feedback.
42. **Proxy backends: OpenRouter and Pi** (`42-proxy-backends-openrouter-and-pi.md`) — blocked by: 10, 20, 25, 29. Real upstream calls for chat, embeddings, decisions and rerank, with their pricing and failure rules.
43. **Real-model coder sessions and the web research guard** (`43-real-model-coder-sessions-and-the-web-research-guard.md`) — blocked by: 12, 25. Provider models and credentials for Pi sessions; `pi-web-access` behind the guard extension.
44. **Final acceptance: the free end-to-end suite and the fixed contracts** (`44-final-acceptance-free-end-to-end-suite.md`) — blocked by: every ticket from 01 to 43. The seven mock nights of the done signal, one after the other, on a fresh server; then the audit of the fixed contracts, the constants and the known gaps.
45. **Paid nights 8 to 11: real models, with the operator's go-ahead** (`45-paid-nights-8-to-11.md`) — blocked by: 44. The four paid nights of the done signal on real models, each run only with the operator's go-ahead and under its ceiling.

## Critical path

01 → 07 → 08 → 10 → 12 → 15 → 16 → 17 → 22 → 23 → 24 → 25 → 26 → 29 → 37 → 39 → 40 → 44 → 45.

## Spec gaps met while cutting

- "Suggested build order" puts mock nights 1 and 2 at its step 5 and the noise run and send-backs at step 7, yet the done signal's table for those nights requires both. Tickets 15 to 25 use the order the table forces: review, notes and send-backs, then metering (night 1), then the noise run (night 2).
- The spec calls `package.json`, `langgraph.json` and the compose override given and gates a change to them on the operator's go-ahead. A from-scratch rebuild has to create or rewrite them; ticket 01 says so.
- `build:dataset`, `build:dataset:hard` and `build:scenario:overfit` are fixed script names whose behaviour the spec never states. Ticket 01 wires them to whatever the scenarios' own `scripts/` provide.
- Pause and resume, continue, seed, rescore, applied lessons, the watchdog, the worker API, export and the app have no named end-to-end check. Their tickets define checks on mock nights or with a faked Agent Server client.
- `deadline` and `thresholds` have no named end-to-end night (`max_rounds` and `plateau` have nights 2 and 3; `budget` has the paid night 10). Ticket 24 checks them on mock nights with temporary config copies.
- Night 4 is started with `--no-wait`, yet its check says `run-night` prints `stopped`; the spec does not say which command prints it. Ticket 26 reads it as: following the night prints `stopped`.
- The spec points at `GLOSSARY.md`, `docs/adr/` and the end-to-end skill as given; no ticket depends on them.
