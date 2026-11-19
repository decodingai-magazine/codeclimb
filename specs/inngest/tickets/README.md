# CodeClimb on Inngest: build tickets

39 tickets for building CodeClimb from scratch from `specs/inngest/spec.md`, with no existing code.

- one file per ticket, `<NN>-<slug>.md`, numbered in dependency order: a ticket is blocked only by lower numbers
- every ticket names the spec sections it implements, by heading, or by the bold name of an item under "Features"; the spec is the contract, a ticket only scopes it. Numbers are in the spec's "Numbers"; where a ticket and the spec differ, the spec wins
- the given inputs (`scenarios/`, `configs/`, `docker/`, `.env.example`) are present in the checkout; tickets consume them and never change them. A test that needs another scenario or config uses a test-only copy inside the checkout but outside `scenarios/` and `configs/`, with its own name and a `results_path` folder of its own, so test nights never mix into the given configs' results
- the end-to-end test is the spec's "Goal and done signal", as a procedure in `E2E.md`; C1 to C14 are its common checks
- every ticket is `ready-for-agent` and needs no paid call and no human: provider and OpenRouter paths are tested against fakes; whole nights run with `--mock`
- end-to-end checks need Docker, `npm run dev:inngest` and `npm run worker` running; start the worker again after a code change, so it runs the code under test. Nights run one at a time, each under a fresh night id
- after any code change: `npm run typecheck`, then `npm test`
- the order follows the spec's "Architecture" and "Goal and done signal": contracts and parts first, a one-round mock night at ticket 11, nights 1 to 3 at ticket 20, then nights 4 to 7 in the tickets that build what they prove. Tickets 21 to 38 are gated on ticket 20, directly or through a blocker (all but ticket 27, the pure lessons file), and those that touch the loop rerun its check

## Phases

| # | phase | tickets |
|---|---|---|
| 1 | Scaffold | 01 |
| 2 | Contracts and pure functions | 02 to 05 |
| 3 | Experiment repository and sandboxes | 06 to 07 |
| 4 | Agent sessions, coder and evaluator | 08 to 10 |
| 5 | Tracer night: the first mock night | 11 |
| 6 | Review, notes and send-backs | 12 to 14 |
| 7 | Metering | 15 to 17 |
| 8 | Noise run, soft stops and the gate | 18 to 20 |
| 9 | Hard stop, crash, lost connection, pause, repair | 21 to 25 |
| 10 | Across nights: continue, lessons, multi-stage, seed, rescore | 26 to 31 |
| 11 | Worker API, export and app | 32 to 35 |
| 12 | Tracing and real-model paths | 36 to 38 |
| 13 | Final acceptance | 39 |

- phase 5: ticket 11 also starts the worker API's listener, since "Services" wants it up before the dev server; ticket 32 fills in the rest of the API
- phase 7: night 1 (`capitals-smoke`) passes its metering checks in ticket 17; phase 8: night 2 in ticket 18, night 3 (the plateau night) in ticket 19
- phase 8 is the gate: nights 1 to 3 pass every check of "Goal and done signal" in ticket 20 before any phase after it starts. Nights 4, 5 and 6 pass in tickets 21, 22 and 23, night 7 in ticket 29, and all seven run together in ticket 39
- the pause, repair, continue, lessons, seed, rescore, the worker API, export and the app have no night of their own in the done signal. They get the checks their tickets define, on mock nights on the dev server; the pause timeout and the night backstop fire in seconds through the spec's two timer test hooks, and the credit pause through `CODECLIMB_MOCK_CREDIT`
- `deadline` and `thresholds` are checked on mock nights with test-only config copies (ticket 19), `budget`, `tokens` and `outage` in unit tests; `max_rounds` and `plateau` have nights 2 and 3
- phase 12: real-model paths (the OpenRouter and Pi backends, web research) are built and tested against fakes; the model check and the smoke test are built in ticket 19

## Tickets

1. **Project scaffold, npm scripts, env loading and sandbox images** (`01-scaffold-scripts-env-images.md`). Blocked by: none. Delivers: an installable TypeScript project with every fixed npm script named, `.env` loading, both sandbox images and the overfit scenario buildable.
2. **Scenario contract: load, host commands, masking, report metrics, scoring hash** (`02-scenario-contract.md`). Blocked by: 01. Delivers: a scenario loads, its host commands run, text is masked, a stage report becomes metrics, the scoring files hash.
3. **Night config, night ids and the runs folder** (`03-night-config.md`). Blocked by: 02. Delivers: a validated, resolved night config or a clear refusal; night ids; results paths for real and mock nights.
4. **Decision functions: weighted score, keep rule, noise margin, stop order** (`04-decision-functions.md`). Blocked by: 03. Delivers: the pure functions behind every keep and every soft stop, unit-tested.
5. **Result rows: schema, deduplicated append, validate-results** (`05-result-rows.md`). Blocked by: 01. Delivers: `results.jsonl` appended once per `eval_id` and checked from the command line.
6. **Experiment repository: experiments.git, starter commit, experiment refs** (`06-experiment-repository.md`). Blocked by: 01. Delivers: one squashed commit per experiment, a deterministic starter, diffs and tree comparisons.
7. **Sandbox interface and the Docker backend** (`07-sandbox-docker-backend.md`). Blocked by: 01, 06. Delivers: Docker sandboxes found by name, swept by prefix, with process-tree kills and no secrets inside.
8. **Pi sessions with sandbox tools, and the mock models** (`08-pi-sessions-mock-models.md`). Blocked by: 03, 07. Delivers: an isolated, persisted Pi session with four sandbox tools; scripted mock coder, reviewer and lessons models.
9. **Coder experiment: from the prompt to one commit** (`09-coder-experiment.md`). Blocked by: 02, 06, 08. Delivers: one coder experiment ends as one commit with its files, check and leak scan.
10. **Evaluator: one commit scored on dev or test in its own sandbox** (`10-evaluator.md`). Blocked by: 02, 03, 06, 07. Delivers: stage-by-stage evaluation into metrics with latency, or an `error` outcome with the log tail.
11. **Tracer night: one mock round on the Inngest dev server** (`11-tracer-night.md`). Blocked by: 04, 05, 09, 10. Delivers: `run-night --mock --rounds 1` runs a whole night on the dev server and prints `done`; the worker API listener is up first.
12. **Reviewer: feedback, hypothesis and verdict every round** (`12-reviewer.md`). Blocked by: 11. Delivers: a review every round whose hypothesis the next round's coder tests.
13. **Notes, trajectory and rejected diffs: memory within a night** (`13-notes-trajectory-rejected-diffs.md`). Blocked by: 12. Delivers: masked notes, history lines and rejected diffs in the bundle for later coders.
14. **Send-backs, reserve and wrap-up** (`14-send-backs-reserve-wrap-up.md`). Blocked by: 09. Delivers: eight send-backs then one wrap-up, by the exact rules.
15. **Metering proxy: routes, tokens, refusals, ledgers and mock answers** (`15-metering-proxy.md`). Blocked by: 01. Delivers: the proxy's routes, refusals, ledgers, mock answers and cost metrics.
16. **Replay cache: a repeated call is answered again for free** (`16-replay-cache.md`). Blocked by: 15. Delivers: repeated calls replayed within a night, coder retries and A/A runs excepted.
17. **Metered nights on Docker: mock night 1's metering passes** (`17-metered-path-docker.md`). Blocked by: 11, 15. Delivers: sandboxes reach models only through the proxy, on any Docker; night 1's metering checks pass.
18. **Noise run: the A/A evaluation and the measured margin; mock night 2 passes** (`18-noise-run.md`). Blocked by: 12, 16, 17. Delivers: the A/A run sets the margin every keep must beat; night 2 passes its own checks.
19. **Every soft stop, the model check and the smoke test; mock night 3 passes** (`19-soft-stops-model-check-smoke-test.md`). Blocked by: 17, 18. Delivers: all seven soft stops, the model check and the smoke test; night 3 passes.
20. **Check table: mock nights 1 to 3 as one repeatable check** (`20-check-table-mock-nights-1-to-3.md`). Blocked by: 13, 14, 18, 19. Delivers: nights 1 to 3 pass C1 to C14 and night 3's checks, repeatably.
21. **Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes** (`21-hard-stop-cleanup.md`). Blocked by: 20. Delivers: stop, outside cancel, failure, backstop and `hard_deadline` end alike; night 4 passes.
22. **Crash recovery: the night carries on after a worker kill; mock night 5 passes** (`22-crash-recovery.md`). Blocked by: 20. Delivers: a worker kill costs only work in flight; night 5 passes.
23. **Lost connection mid-turn; mock night 6 passes** (`23-lost-connection-mid-turn.md`). Blocked by: 20. Delivers: `--mock-offline`, and send-backs carry a session past failed calls; night 6 passes.
24. **Pause for credits and resume** (`24-pause-for-credits.md`). Blocked by: 21, 22. Delivers: a credit error pauses the night; `run-night resume` reruns only what stopped; the pause times out.
25. **Repair: one fix attempt for a commit that failed before scoring** (`25-repair.md`). Blocked by: 20. Delivers: one `e1` repair per round, decided against the same checkpoint.
26. **Continue: more rounds on an ended night, with an operator's direction** (`26-continue-and-direction.md`). Blocked by: 21. Delivers: `run-night continue` adds rounds to an ended night, rebuilt from its files.
27. **Lessons file: operations, gates and format** (`27-lessons-file-ops.md`). Blocked by: 02, 03. Delivers: add, edit and drop applied by code behind the gates; `lessons format`.
28. **Lessons distillation: what a night learned reaches the next night** (`28-lessons-distillation.md`). Blocked by: 21, 27. Delivers: a proposal after every night, applied by mode, one per scenario at a time.
29. **Multi-stage mock night: graphrag-smoke, mock night 7, passes its checks** (`29-multi-stage-mock-night.md`). Blocked by: 25, 28. Delivers: night 7 passes every check the spec lists for it.
30. **Seed: a new night that starts from an ended night's kept commit** (`30-seed.md`). Blocked by: 26. Delivers: `--seed ID|latest|best` starts from an earlier night's kept commit and dev metrics.
31. **Rescore: a kept commit is scored again when the scoring changed** (`31-rescore.md`). Blocked by: 18, 30. Delivers: changed scoring files make a continued or seeded night rescore, then remeasure noise.
32. **Worker API: read nights, stop, resume, continue** (`32-worker-api.md`). Blocked by: 24, 26. Delivers: night status and reports from files; stop, resume and continue over HTTP.
33. **Export: a kept commit as files, as a git repository, or pushed to a remote** (`33-export.md`). Blocked by: 32. Delivers: `npm run export` and the API's export endpoints, never force-pushing.
34. **App: the nights list and a live night with its controls** (`34-app-nights-list-night-controls.md`). Blocked by: 32. Delivers: a loopback Next.js app listing nights, with live status and controls.
35. **App: metrics per stage, convergence chart, experiment diffs and export** (`35-app-night-analysis-export.md`). Blocked by: 33, 34. Delivers: the night's page explains the night and downloads the result.
36. **Tracing and the scores mirror** (`36-tracing-scores.md`). Blocked by: 20. Delivers: spans for model, tool, sandbox and metered calls; dev metrics as dashboard scores.
37. **Proxy backends: OpenRouter and Pi's model layer** (`37-proxy-backends.md`). Blocked by: 17, 24. Delivers: real upstreams behind the proxy, charged per call, credit signals pausing the night; tested on fakes.
38. **Web research for the coder, behind the guard** (`38-web-research-guard.md`). Blocked by: 20. Delivers: guarded web search and fetch for real-model coders; off in mock mode.
39. **Final acceptance: the seven mock nights and the fixed contracts** (`39-final-acceptance.md`). Blocked by: every ticket from 21 to 38. Delivers: the seven nights pass in a row; contracts and numbers audited. No paid call.

## Critical path

01 → 02 → 03 → 08 → 09 → 11 → 12 → 18 → 19 → 20 → 22 → 24 → 32 → 34 → 35 → 39.
