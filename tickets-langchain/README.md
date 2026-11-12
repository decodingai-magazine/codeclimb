# CodeClimb on LangGraph: build tickets

43 tickets that rebuild CodeClimb from `docs/codeclimb-spec-langchain.md` alone. Each ticket names the spec sections it implements by heading; the spec is the contract, the ticket only scopes it. One file per ticket: `<NN>-<slug>.md`.

## How to work them

- Work a ticket only when every ticket in its "Blocked by" is done. Numbers are in dependency order: a blocker always has a lower number.
- Given inputs are present and are consumed, not rebuilt: `scenarios/`, `configs/` and `docker/` (the two Dockerfiles). Ticket 01 creates the rest of the scaffold.
- Preconditions for every ticket that runs a night or a Docker test: Docker is running; `.env` exists with `LANGSMITH_API_KEY` (the server container exits with code 3 without it); `LANGSMITH_TRACING=false` unless the ticket is about tracing.
- Nights run one at a time: one night per server, and the relay is shared. Tickets whose blockers allow parallel work must still take turns on the Agent Server.
- After a code change the Agent Server needs `npm run server` again before a night sees it.
- Every ticket ends with `npm run typecheck` and `npm test` passing, plus the checks it lists.
- "Not yet" in a ticket lists behaviour a later ticket adds. Leave it out; do not stub it with guesses.
- Nights 8 to 11 of "Goal and done signal" (real models, paid) have no ticket: they need the operator's go-ahead per run. The real-model paths are built in tickets 29, 30 and 31 and verified with stubbed providers.

## Breakdown

1. **Scaffold and Agent Server boot** — blocked by: none. Pinned dependencies, the fixed npm scripts, `langgraph.json` with placeholder `night`, `stop` and `lessons` graphs, the compose override, `.dockerignore`, `server` / `server:logs` / `server:stop`, the env loader, the `codeclimb-python` image; `/ok` answers on `127.0.0.1:8123`.
2. **Scenario and night config loading** — blocked by: 01. `scenario.yaml` and night config parsed and validated, night-id rules, deadline parsing, the mock results path, the scoring hashes.
3. **Host commands, placeholders and masking** — blocked by: 02. The host command runner, placeholder substitution, the `bundle`, `check` and `scan` commands, masking, the bundle rebuild that keeps `history/`.
4. **Stage reports and standard metrics** — blocked by: 01. Report flattening, stage prefixes, `output_bytes`, latency metrics from `timings.jsonl`, cost metrics from ledger rows.
5. **Weighted score, keep rule, noise margin and stop checks** — blocked by: 01. The pure decision functions and the soft-stop check.
6. **Result rows and `validate-results`** — blocked by: 01. The row schema, the validated and deduplicated append, the `validate-results` command.
7. **Experiment repository** — blocked by: 01. `experiments.git`: the starter commit with a fixed SHA, experiment refs, aliases, tree comparison, git bundles in and out, diffs.
8. **Sandbox interface and Docker backend** — blocked by: 07. One sandbox interface and its Docker backend: create, exec with process-tree kill, file transfer, find by name, sweep.
9. **Step wrapper, abort signal and live registry** — blocked by: 01. Steps as saved units with retry, failure as data, backstop timers, one abort signal, the live registry.
10. **Pi sessions: mock models and sandbox tools** — blocked by: 08. Isolated Pi sessions whose four tools act in a sandbox; the scripted `mock` provider for coder, reviewer and lessons.
11. **Coder prompt** — blocked by: 02, 05. The coder's prompt as a pure function: sections, rules, targets / met / fragile, repair variant.
12. **Coder experiment: code step and commit** — blocked by: 03, 07, 09, 10, 11. One experiment's coder on a sandbox: stops, state files, the one squashed commit in `experiments.git`.
13. **Evaluator, unmetered** — blocked by: 03, 04, 07, 08, 09. One evaluation of a commit on its own sandbox: reset, environment, stages, score, metrics, files.
14. **Threads and the start operation** — blocked by: 02. Thread ids, the newest-thread search, start with one night per night id.
15. **Tracer night: `datenorm-smoke` on mock models** — blocked by: 05, 06, 12, 13, 14. The `night` graph and `run-night`: init, rounds (code, evaluate, decide, record, keep), stops, test evaluation, `done.json`.
16. **Notes, history, rejected diffs and trajectory** — blocked by: 03, 15. The memory within a night, written to the bundle's `history/` and read by the next coder.
17. **Reviewer** — blocked by: 16. The review of every round: evidence with caps, the JSON reply, the leak loop, review files, the hypothesis handed to the next round.
18. **Send-backs, reserve and wrap-up** — blocked by: 15. The coder is sent back until its reserve, then wrapped up once.
19. **Check, leak scan and guardrails** — blocked by: 17. `check` and `scan` on each commit, `check.json`, the held-out-name guardrail.
20. **Noise run; mock night 2 passes in full** — blocked by: 17, 18. The A/A run, `noise.json`, noise rows; every unmetered row of the done signal's table holds for night 2.
21. **Metering proxy: ledgers, routes, refusals, replay** — blocked by: 04. The `/v1` server with per-token ledgers, the refusal order, ledger rows, canned mock answers, the replay cache.
22. **Relay and path to the proxy** — blocked by: 08, 21. `cc-meter`, the `cc-meter-relay` forwarder, the "path is up" check.
23. **Metered nights: mock nights 1 and 3 pass** — blocked by: 20, 22. Meter tokens in the coder and the evaluator, the two ledgers, cost metrics; capitals-smoke and the plateau night.
24. **Stop operation and cleanup; mock night 4 passes** — blocked by: 15. The `stop` graph, `run-night stop`, the night's failure and cancel paths, the create refusal.
25. **Crash resume; mock night 5 passes** — blocked by: 20. A killed server reruns only the running step; the coder's state file drives session resume and the fresh restart.
26. **Lost connection mid-turn; mock night 6 passes** — blocked by: 20. `--mock-offline N` and the rule that a turn ended by a failed model call is sent back.
27. **Repair** — blocked by: 17, 19. One repair attempt `e1` for a commit that failed before it was scored.
28. **Pause for credits and resume** — blocked by: 23, 24, 25. Credit stops, the night's interrupt, `pause.json`, `run-night resume`, `mock_credit`.
29. **Model checks, smoke test and outage** — blocked by: 23. The model check on the CLI and in the night's first step, the round-start smoke test, the `outage` stop.
30. **Proxy backends: OpenRouter and Pi** — blocked by: 10, 28. Real upstream calls for chat, embeddings, decisions and rerank, with their pricing and failure rules.
31. **Real-model coder sessions and the web research guard** — blocked by: 12. Provider models and credentials for Pi sessions; `pi-web-access` behind the guard extension.
32. **Lessons file, operations and gates** — blocked by: 01. The `lessons.md` format, `add` / `edit` / `drop`, every gate, the rewrite and prune rounds, the proposal files.
33. **Lessons distillation: graph, trigger and CLI** — blocked by: 17, 24, 32. The `lessons` graph, its queue per scenario, the start at a night's end and at a stop, the `lessons` command.
34. **Graphrag mock night; mock night 7 passes** — blocked by: 23, 27, 33. The `codeclimb-graphrag` image and a three-stage, metered scenario with `check`, `scan` and lessons, end to end.
35. **Continue** — blocked by: 20, 24. More rounds on an ended night: reopening, the rebuilt state, a new thread, `run-night continue`.
36. **Seed and rescore** — blocked by: 33, 35. A night that starts from an ended night's kept commit; the rescore round when the scoring hashes changed.
37. **Worker API** — blocked by: 28, 35. The `api` process: night summaries, live view, report, stop, resume, continue.
38. **Watchdog** — blocked by: 25, 37. Crash recovery past the server's own: resume an errored thread twice, then stop; stop a night whose thread is lost.
39. **Export** — blocked by: 37. A kept commit as plain files, as a git repository with its lineage, or pushed to a remote; the `export` command and the API's export endpoints.
40. **App** — blocked by: 34, 39. The Next.js client of the worker API: the nights list and the night page.
41. **Tracing and feedback** — blocked by: 23. CodeClimb's tracer on LangSmith, one trace per experiment, dev metrics mirrored as feedback.
42. **Pause timeout and variation backstop** — blocked by: 28. The timer operation: delayed `stop` runs that end a pause after 3 days and a variation after 4, each behind its guard.
43. **Free end-to-end suite** — blocked by: every other ticket. The seven mock nights of the done signal, one after the other, on a fresh server.

## Critical path

01 → 07 → 08 → 10 → 12 → 15 → 16 → 17 → 20 → 23 → 28 → 37 → 39 → 40 → 43.

## Spec gaps met while cutting

- "Suggested build order" puts mock nights 1 and 2 at its step 5 and the noise run and send-backs at step 7, yet the done signal's table for those nights requires both. Tickets 15 to 23 use the order the table forces.
- The spec calls `package.json`, `langgraph.json` and the compose override given and gates a change to them on the operator's go-ahead. A from-scratch rebuild has to create or rewrite them; ticket 01 says so.
- `build:dataset`, `build:dataset:hard` and `build:scenario:overfit` are fixed script names whose behaviour the spec never states. Ticket 01 wires them to whatever the scenarios' own `scripts/` provide.
- Pause and resume, continue, seed, rescore, applied lessons, the watchdog, the worker API, export and the app have no named end-to-end check. Their tickets define checks on mock nights or with a faked Agent Server client.
- Night 4 is started with `--no-wait`, yet its check says `run-night` prints `stopped`; the spec does not say which command prints it. Ticket 24 reads it as: following the night prints `stopped`.
- The spec points at `GLOSSARY.md`, `docs/adr/` and the end-to-end skill as given; no ticket depends on them.
