# CodeClimb on the LangChain ecosystem: build tickets

42 tickets that build CodeClimb from `specs/langchain/spec.md` alone. Each ticket names the spec sections it implements by heading (the bold paragraph names under "Features" count as sections); the spec is the contract, the ticket only scopes it. Where a ticket and the spec differ, the spec wins. One file per ticket: `<NN>-<slug>.md`.

## How to work them

- Work a ticket only when every ticket in its "Blocked by" is done. Numbers are in dependency order: a blocker always has a lower number.
- Given inputs are present and are consumed, not rebuilt: `scenarios/`, `configs/`, `docker/` and `E2E.md`. Ticket 01 brings the starting point (`package.json`, `langgraph.json`, `src/hello.ts`, `tsconfig.json`, `.env.example`) to the spec. A test that needs a different scenario or config uses a temporary copy inside the checkout but outside `scenarios/` and `configs/`, with its own name and a `results_path` folder of its own.
- Preconditions for every ticket that runs a night or a Docker test: Docker is running; `codeclimb-python` is built; `.env` holds `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT` and `LANGSMITH_TRACING=false`, and nothing else. A test hook (`CODECLIMB_PAUSE_TIMEOUT_S`, `CODECLIMB_BACKSTOP_S`, `CODECLIMB_MOCK_CREDIT`) is set in `.env` for the one check that needs it, then `npm run server` runs again.
- Nights run one at a time on one Agent Server. Tickets whose blockers allow parallel work still take turns on it.
- After a code change, run `npm run server` again before a night sees it.
- Every ticket ends with `npm run typecheck` and `npm test` passing, plus the checks it lists. `npm test` runs with no Agent Server up and no `codeclimb-graphrag` image, so whole-night checks are separate commands, never part of `npm test`.
- "Not yet" in a ticket lists behaviour a later ticket adds. Leave it out; do not stub it with guesses.
- Where the spec gives no number (an idle limit, the watchdog's limit, the trajectory's budget, the lessons size bound), the build picks one and the ticket tests the behaviour, not a value.
- Every ticket is `ready-for-agent` and needs no paid call and no human: whole nights run with `--mock`; the real-model paths (tickets 20, 40 and 41) are verified against stubbed providers.
- The order follows "Goal and done signal": a mock night runs at ticket 12, nights 1 to 3 pass every check at ticket 21, and nights 4 to 7 pass in the tickets that build what they prove (22, 24, 25, 31). Every ticket after 21 is gated on it, directly or through a blocker, except ticket 29 (the pure lessons file), and those that touch the loop rerun its check.

## Phases

| # | phase | tickets |
|---|---|---|
| 1 | Scaffold | 01 |
| 2 | Contracts and pure rules | 02 to 06 |
| 3 | Experiment repository and sandboxes | 07 to 08 |
| 4 | Pi sessions on mock models | 09 |
| 5 | Coder and evaluator | 10 to 11 |
| 6 | Tracer night | 12 |
| 7 | Notes, review, send-backs, check | 13 to 16 |
| 8 | Metering | 17 to 18 |
| 9 | Noise run | 19 |
| 10 | Model checks, smoke test, soft stops | 20 |
| 11 | Gate: nights 1 to 3 | 21 |
| 12 | Hard stops | 22 to 23 |
| 13 | Crash resume and lost connection | 24 to 25 |
| 14 | Pause for credits | 26 |
| 15 | Repair | 27 |
| 16 | Continue | 28 |
| 17 | Lessons | 29 to 30 |
| 18 | Multi-stage night | 31 |
| 19 | Seed and rescore | 32 to 33 |
| 20 | Worker API and watchdog | 34 to 35 |
| 21 | Export | 36 |
| 22 | App | 37 to 38 |
| 23 | Tracing | 39 |
| 24 | Real-model paths | 40 to 41 |
| 25 | Final acceptance | 42 |

- phase 7: nights 1, 2, 3 and 6 need every check C1 to C14, so the review (C7), the notes (C9) and the send-backs (C8) land before the first night that must pass in full. Only `graphrag` declares `check` and `scan`, so ticket 16 proves them on a temporary scenario copy
- phase 11 is the gate: nothing after it starts until nights 1 to 3 pass every check. All seven nights run together in ticket 42
- phase 12: ticket 23 holds the timed hard stops that need no pause (the hard deadline, the variation backstop) and the per-step backstops; the pause timeout is in ticket 26
- phase 13: night 5 passes with no watchdog; the watchdog (ticket 35) is recovery past the server's own
- phase 22: the app is cut in two: ticket 37 is usable alone; ticket 38 adds the views that read the report and the export

## Breakdown

1. **Scaffold and Agent Server boot** (`01-scaffold-and-agent-server-boot.md`) — blocked by: none. Pinned dependencies, every npm script, `server` / `server:logs` / `server:stop` with `langgraph-api` beside Postgres and Redis, `.env` loading, host tools in the server, both images.
2. **Night config and scenario loading** (`02-night-config-and-scenario-loading.md`) — blocked by: 01. The night config with its defaults and refusals, `scenario.yaml`, night ids, `<root>`, the mock results path, scoring hashes; exit 2.
3. **Host commands, the bundle and masking** (`03-host-commands-bundle-and-masking.md`) — blocked by: 02. `bash -c` with quoted placeholders, the bundle, `check` and `scan` reports, masking.
4. **Stage reports and standard metrics** (`04-stage-reports-and-standard-metrics.md`) — blocked by: 01. Report flattening, stage prefixes, `output_bytes`, latency from timings, cost and calls from ledger rows.
5. **Decisions: weighted score, keep rule, noise margin and stop checks** (`05-decisions-keep-rule-noise-margin-and-stop-checks.md`) — blocked by: 02. The decision table, guardrails, the margin, the soft-stop order.
6. **Result rows and `validate-results`** (`06-result-rows-and-validate-results.md`) — blocked by: 01. The row schema, the validated and unique append, the command.
7. **Experiment repository** (`07-experiment-repository.md`) — blocked by: 01. `experiments.git`: the deterministic starter, one commit per experiment, refs, trees and diffs.
8. **Sandboxes on Docker** (`08-sandboxes-on-docker.md`) — blocked by: 07. Create, exec with process-tree kill, files in and out, find by name, sweep by night.
9. **Pi sessions on mock models** (`09-pi-sessions-on-mock-models.md`) — blocked by: 08. Isolated Pi sessions with four sandbox tools; the scripted coder, reviewer and lessons models.
10. **Coder experiment** (`10-coder-experiment.md`) — blocked by: 03, 05, 07, 09. The prompt, the coder's ends, the one commit, `code-state.json` and the state files.
11. **Evaluator, unmetered** (`11-evaluator-unmetered.md`) — blocked by: 03, 04, 07, 08. One evaluation on its own sandbox: environment, stages, scores, files, outcomes.
12. **Tracer night: `datenorm-smoke` on mock models** (`12-tracer-night-datenorm-smoke-on-mock-models.md`) — blocked by: 05, 06, 10, 11. The night as durable steps on the Agent Server and `run-night`: init, rounds, test, `done.json`, following.
13. **Notes, history, rejected diffs and the trajectory** (`13-notes-history-rejected-diffs-and-trajectory.md`) — blocked by: 12. The memory within a night, masked, under `/spec/history/`.
14. **Reviewer** (`14-reviewer.md`) — blocked by: 13. The review of every round, its files, the scan, the hypothesis handed on.
15. **Send-backs, reserve and wrap-up** (`15-send-backs-reserve-and-wrap-up.md`) — blocked by: 12. Up to 8 send-backs, then one wrap-up, with the literal phrases.
16. **Check, leak scan and guardrails** (`16-check-leak-scan-and-guardrails.md`) — blocked by: 12. `check.json`, `not scored`, the held-out-name and gate guardrails.
17. **Metering proxy** (`17-metering-proxy.md`) — blocked by: 04. The `/v1` routes, tokens, refusals, ledger rows, replay, mock answers.
18. **Metered nights: nights 1 and 3 pass** (`18-metered-nights-1-and-3.md`) — blocked by: 14, 15, 17. Sandboxes on the proxy, the path check, the two ledgers; `capitals-smoke` and the plateau night.
19. **Noise run: night 2 passes** (`19-noise-run-night-2.md`) — blocked by: 18. The A/A run, `noise.json`, noise rows; `datenorm-smoke` in full.
20. **Model checks, smoke test, outage and every soft stop** (`20-model-checks-smoke-test-outage-and-every-soft-stop.md`) — blocked by: 19. The CLI's model check, the round-start smoke test, `outage`, every soft stop proven.
21. **Gate: nights 1 to 3 as one repeatable check** (`21-gate-nights-1-to-3-as-one-repeatable-check.md`) — blocked by: 16, 19, 20. One command that runs nights 1 to 3 and asserts every check.
22. **Stop command and cleanup: night 4 passes** (`22-stop-command-and-cleanup-night-4.md`) — blocked by: 21. `run-night stop`, the failure and cancel paths, no sandbox after a stop.
23. **Hard deadline, variation backstop and step backstops** (`23-hard-deadline-variation-backstop-and-step-backstops.md`) — blocked by: 22. `hard_deadline` mid-step, the 4-day backstop, no step running for ever.
24. **Crash resume: night 5 passes** (`24-crash-resume-night-5.md`) — blocked by: 21. A killed server reruns only the running step; session resume.
25. **Lost connection mid-turn: night 6 passes** (`25-lost-connection-mid-turn-night-6.md`) — blocked by: 21. `--mock-offline N`; the session carries on.
26. **Pause for credits, resume and the pause timeout** (`26-pause-for-credits-resume-and-pause-timeout.md`) — blocked by: 21, 22, 24. Credit stops, `pause.json`, `run-night resume`, `CODECLIMB_MOCK_CREDIT`, the 3-day timeout.
27. **Repair** (`27-repair.md`) — blocked by: 16, 21. One repair `e1` for a commit that failed before it was scored.
28. **Continue** (`28-continue.md`) — blocked by: 21, 22. More rounds on an ended night as a new variation.
29. **Lessons file, operations and gates** (`29-lessons-file-operations-and-gates.md`) — blocked by: 03. The `lessons.md` format, add / edit / drop, the gates, the proposal files.
30. **Lessons distillation** (`30-lessons-distillation.md`) — blocked by: 21, 22, 29. The distillation at a night's end or stop, one per scenario at a time, the `lessons` command.
31. **Multi-stage night: night 7 passes** (`31-multi-stage-night-7.md`) — blocked by: 18, 27, 30. `graphrag-smoke`: three stages, metered, check, `uv`, repair, lessons.
32. **Seed** (`32-seed.md`) — blocked by: 21. A new night from an ended night's kept commit: an id, `latest`, `best`.
33. **Rescore** (`33-rescore.md`) — blocked by: 28, 32. The extra round when the scoring files changed.
34. **Worker API** (`34-worker-api.md`) — blocked by: 26, 28. Summaries, live experiment, report, status from files, stop / resume / continue, the bearer off loopback.
35. **Watchdog** (`35-watchdog.md`) — blocked by: 24, 34. Resumes a night the server left behind a limited number of times, then stops it.
36. **Export** (`36-export.md`) — blocked by: 34. Plain files, a git repository with the kept lineage, or a push; from the CLI and the API.
37. **App: nights list, status and controls** (`37-app-nights-list-status-and-controls.md`) — blocked by: 34. `/` and `/nights/<id>`: status, controls, scores, spend, live experiment.
38. **App: metric tables, chart, heatmap, experiment and export** (`38-app-metric-tables-chart-heatmap-experiment-and-export.md`) — blocked by: 31, 36, 37. The rest of the night page.
39. **Tracing and feedback** (`39-tracing-and-feedback.md`) — blocked by: 21. Traces findable by night id, headline scores as feedback, nothing with tracing off.
40. **Proxy backends: OpenRouter and Pi** (`40-proxy-backends-openrouter-and-pi.md`) — blocked by: 17, 21, 26. Real upstreams, their cost, 502, credit stops; stubbed.
41. **Real-model sessions and the web research guard** (`41-real-model-sessions-and-the-web-research-guard.md`) — blocked by: 21. Provider models and credentials for Pi; three guarded web tools; stubbed.
42. **Final acceptance: the seven nights and the fixed contracts** (`42-final-acceptance.md`) — blocked by: every ticket from 01 to 41. The seven mock nights one after the other, then the audit of the contracts and the numbers.

## Critical path

01 → 07 → 08 → 09 → 10 → 12 → 13 → 14 → 18 → 19 → 20 → 21 → 22 → 26 → 34 → 36 → 38 → 42.

## Spec gaps met while cutting

- The spec has no build order. The order here is the one "Goal and done signal" forces: nights 1, 2, 3 and 6 need the review, the notes, the send-backs, metering and the noise run before any of them passes in full.
- Pause and resume, continue, seed, rescore, applied lessons, export, the worker API, the watchdog and the app have no named end-to-end check. Their tickets define checks on mock nights, temporary copies, or a faked Agent Server client.
