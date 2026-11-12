# CodeClimb on Inngest: build tickets

41 tickets for building CodeClimb from scratch from `docs/codeclimb-spec-inngest.md`, with no existing code.

- one file per ticket, `<NN>-<slug>.md`, numbered in dependency order: a ticket is blocked only by lower numbers
- every ticket names the spec sections it implements by heading; the spec is the contract, the ticket only scopes it. Constants are in the spec's "Every number in one place"
- the given inputs (`scenarios/`, `configs/`, `docker/` with the two image definitions, `.env`) are present in the build environment; tickets consume them and never change them. The end-to-end test is the spec's "Goal and done signal": nothing outside the spec defines it. A test that needs a different scenario or config uses a test-only copy inside the checkout but outside `scenarios/` and `configs/`, with its own name and a `results_path` folder of its own, which lands directly under `runs-inngest/`, so test nights never mix into the given configs' results
- tickets 01 to 40 are `ready-for-agent` and need no paid call: provider and OpenRouter paths are tested against fakes; whole nights run with `--mock`
- ticket 41, night 8 of "Goal and done signal" (`capitals-smoke` on real models, paid), is `ready-for-human`: it runs only with the operator's go-ahead for that run, after its ceiling was named. Ticket 40, the final acceptance, does not wait for it
- end-to-end checks need Docker, `npm run dev:inngest` and `npm run worker` running; the worker has no hot reload, so restart it after a code change. Nights run one at a time, each under a fresh night id
- after any code change: `npm run typecheck`, then `npm test`
- the order follows the spec's "Suggested build order", cut so that a one-round mock night runs at ticket 11 and nights 1 to 3 of the done signal pass at ticket 20. Tickets 21 to 39 are gated on ticket 20, directly or through a blocker (all but ticket 27, the pure lessons file), and those that touch the loop rerun its check

## Phases

| # | phase | tickets |
|---|---|---|
| 1 | Scaffold | 01 |
| 2 | Contracts and pure functions | 02 to 05 |
| 3 | Experiment repository, sandbox, runtime primitives | 06 to 07 |
| 4 | Pi sessions and mock models | 08 |
| 5 | Coder | 09 |
| 6 | Evaluator | 10 |
| 7 | Tracer night: the first mock night | 11 |
| 8 | Review, notes, send-backs | 12 to 14 |
| 9 | Metering | 15 to 17 |
| 10 | Noise run | 18 |
| 11 | Model checks, soft stops, smoke test | 19 |
| 12 | Check table passes on the base mock nights | 20 |
| 13 | Hard stop and cleanup | 21 |
| 14 | Crash resume | 22 to 23 |
| 15 | Pause for credits | 24 |
| 16 | Repair | 25 |
| 17 | Continue | 26 |
| 18 | Lessons | 27 to 28 |
| 19 | Multi-stage mock night | 29 |
| 20 | Seed and rescore | 30 to 31 |
| 21 | Worker API | 32 |
| 22 | Export | 33 |
| 23 | App | 34 to 36 |
| 24 | Tracing | 37 |
| 25 | Real-model paths | 38 to 39 |
| 26 | Final acceptance | 40 |
| 27 | Operator-gated nights | 41 |

- phase 9: ticket 17 also wires the `plateau` stop, so that nights 1 and 3 of "Goal and done signal", both on capitals, pass their own checks there; night 2 passes its own in ticket 18 (phase 10)
- phase 12 is the gate: nights 1 to 3 of "Goal and done signal" pass every row of their tables before any phase after it starts. Nights 4 to 7 pass in the tickets that build what they prove (21, 22, 23, 29), and all seven run together in ticket 40
- phase 14: ticket 23, `--mock-offline`, belongs here: a lost connection is a failure the coder's session survives
- phase 19: night 7, `graphrag-smoke`, is the only multi-stage one. It passes in ticket 29, after repair and lessons, which it exercises. Outside it, multi-stage scenarios are covered by unit tests on report fixtures (tickets 02, 35, 36)
- phase 25: the OpenRouter and Pi backends and the web research guard. The model check and the credit test are built with the Pi sessions (ticket 08) and wired in tickets 19 and 24
- phase 27: the one paid night, night 8. It runs only with the operator's go-ahead
- pause, repair, continue, lessons, seed, rescore, the worker API, export and the app have no named end-to-end night. They get the checks their tickets define, on mock nights on the dev server: a continued mock night runs mock end to end (ticket 26), and the pause timeout and the night backstop fire in seconds through the spec's two timer test hooks (tickets 24 and 21)
- `deadline`, `budget`, `tokens`, `thresholds` and `outage` have no named end-to-end night (`max_rounds` and `plateau` have nights 2 and 3). Ticket 19 checks `deadline` and `thresholds` on mock nights with test-only config copies, and the others in unit tests

## Tickets

1. **Project scaffold, npm scripts, env file and sandbox images** (`01-scaffold-scripts-env-images.md`). Blocked by: none. Delivers: An installable TypeScript project with every fixed npm script named, the env file loader, and the two sandbox images buildable.
2. **Scenario contract: load, host commands, masking, scoring hashes, report flattening** (`02-scenario-contract.md`). Blocked by: 01. Delivers: A scenario can be loaded and validated, its commands run on the host, text masked, its scoring files hashed, and a stage report turned into metrics.
3. **Night config: parse, defaults, validation, night ids, results paths** (`03-night-config.md`). Blocked by: 02. Delivers: A night config yaml becomes a validated, resolved config with the scenario embedded, plus night-id and results-directory rules.
4. **Decision functions: weighted score, keep rule, noise margin, soft stops** (`04-decision-functions.md`). Blocked by: 03. Delivers: The pure functions that decide every keep and every soft stop, fully unit-tested.
5. **Result rows: schema, deduplicated append, validate-results** (`05-result-rows.md`). Blocked by: 01. Delivers: `results.jsonl` can be appended to safely and checked from the command line.
6. **Experiment repository: experiments.git, starter commit, refs, git bundles** (`06-experiment-repository.md`). Blocked by: 01. Delivers: The bare repository that pins one commit per experiment, with everything the loop asks of it.
7. **Sandbox interface and the Docker backend** (`07-sandbox-docker-backend.md`). Blocked by: 01, 06. Delivers: One sandbox interface, implemented on Docker, proven against real containers.
8. **Pi sessions with sandbox tools, mock models, the model check and credit detection** (`08-pi-sessions-mock-models.md`). Blocked by: 03, 07. Delivers: A Pi session on the worker whose tools act in a sandbox, runnable on scripted models, plus the model check and the credit-error test.
9. **Coder experiment: from the prompt to one commit** (`09-coder-experiment.md`). Blocked by: 02, 06, 08. Delivers: One coder experiment runs end to end on a sandbox and ends as one commit in `experiments.git` with its files on disk.
10. **Evaluator: an unmetered evaluation with latency metrics** (`10-evaluator.md`). Blocked by: 02, 03, 06, 07. Delivers: One commit is evaluated on dev or test in its own sandbox and comes back as metrics or as a failed outcome.
11. **Tracer night: one mock round on the Inngest dev server** (`11-tracer-night.md`). Blocked by: 04, 05, 09, 10. Delivers: `run-night --mock --rounds 1` runs a whole one-round night on the dev server and prints `done`.
12. **Reviewer: feedback, hypothesis and verdict every round** (`12-reviewer.md`). Blocked by: 11. Delivers: Every round ends with a review whose hypothesis the next round's coder tests.
13. **Notes, trajectory and rejected diffs: memory within a night** (`13-notes-trajectory-rejected-diffs.md`). Blocked by: 12. Delivers: Later coders and reviewers read what earlier rounds tried: notes, history lines, feedback and rejected diffs.
14. **Send-backs, reserve and wrap-up** (`14-send-backs-reserve-wrap-up.md`). Blocked by: 09. Delivers: A coder that stops early is sent back to work, and is told once to wrap up when its reserve starts.
15. **Metering proxy: ledgers, routes, refusals and mock answers** (`15-metering-proxy.md`). Blocked by: 08. Delivers: The HTTP proxy that is a program's only path to a model: it meters every call into a per-token ledger, refuses what is not allowed, and answers mock nights with canned replies.
16. **Replay cache: repeated program calls get the same answer** (`16-replay-cache.md`). Blocked by: 15. Delivers: Unchanged code scores the same on the next evaluation, because a repeated model call is answered from the night's cache.
17. **Metered nights on Docker: relay, ledgers, cost metrics; mock nights 1 and 3 pass** (`17-metered-path-docker.md`). Blocked by: 09, 10, 11, 15. Delivers: A program in a Docker sandbox reaches models only through the proxy, in a coder's shell and in an evaluation; the `plateau` stop; mock nights 1 (`capitals-smoke`) and 3 (the plateau night) pass their own checks.
18. **Noise run: the A/A evaluation and the measured margin; mock night 2 passes** (`18-noise-run.md`). Blocked by: 11, 12, 16, 17. Delivers: The night measures how much the same commit moves between two evaluations, and every keep must beat that margin; mock night 2 (`datenorm-smoke`) passes its own checks.
19. **Model checks, every soft stop and the round-start smoke test** (`19-model-checks-soft-stops-smoke-test.md`). Blocked by: 11, 17, 18. Delivers: A night stops softly for every reason the spec names, and no round starts when models or the proxy path are down.
20. **Check table: mock nights 1 to 3 as one repeatable check** (`20-check-table-mock-nights-1-to-3.md`). Blocked by: 13, 14, 17, 18, 19. Delivers: Nights 1 to 3 of the done signal as one repeatable check that asserts every row the spec lists for them; later tickets rerun it.
21. **Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes** (`21-hard-stop-cleanup.md`). Blocked by: 11, 20. Delivers: `run-night stop`, a failed night and a cancelled run all end the same way: work aborted, sandboxes swept, `stop.json` written, the follower released. Mock night 4, the hard stop mid-round, passes.
22. **Crash and resume: a retried coder or evaluator step picks up its work; mock night 5 passes** (`22-crash-resume.md`). Blocked by: 14, 20, 21. Delivers: A worker crash in the middle of an experiment or an evaluation costs a retry, not the night. Mock night 5, the killed and restarted worker, passes.
23. **Lost connection mid-turn; mock night 6 passes** (`23-lost-connection-mid-turn.md`). Blocked by: 18, 20. Delivers: `--mock-offline N` and the rule that a turn ended by a failed model call is sent back; mock night 6 passes.
24. **Pause for credits and resume** (`24-pause-for-credits.md`). Blocked by: 20, 22. Delivers: Running out of credits pauses the night at no cost instead of scoring an outage; `run-night resume` continues where it stopped.
25. **Repair: one fix attempt for a commit that failed before scoring** (`25-repair.md`). Blocked by: 20. Delivers: A commit that broke the repository check or crashed in evaluation gets one repair attempt, and the round is decided on the repair.
26. **Continue: more rounds on an ended night, with an operator's direction** (`26-continue-and-direction.md`). Blocked by: 20, 21. Delivers: `run-night continue` reopens an ended night under the same id and runs more rounds from its kept commit.
27. **Lessons file: format, operations and gates** (`27-lessons-file-ops.md`). Blocked by: 02, 03. Delivers: The pure half of the memory across nights: parse and write `lessons.md`, apply operations, enforce every gate.
28. **Lessons distillation: what a night learned reaches the next night** (`28-lessons-distillation.md`). Blocked by: 20, 21, 27. Delivers: When a night ends, its notes and reviews are distilled into a lessons proposal, applied to the scenario's `lessons.md` when the mode says so.
29. **Multi-stage mock night: graphrag-smoke, mock night 7, passes its checks** (`29-multi-stage-mock-night.md`). Blocked by: 20, 25, 28. Delivers: The graphrag scenario, with three stages and a metered program, runs a whole mock night: mock night 7 passes its checks.
30. **Seed: a new night that starts from an ended night's kept commit** (`30-seed.md`). Blocked by: 26, 28. Delivers: `run-night --seed ID|latest|best` starts a night from the code and dev metrics an earlier night was kept on.
31. **Rescore: a kept commit is scored again when the scoring changed** (`31-rescore.md`). Blocked by: 18, 24, 26, 30. Delivers: When a scenario's evaluators or gold changed since a kept commit was scored, a continued or seeded night first scores that commit again.
32. **Worker API: read nights, stop, resume, continue** (`32-worker-api.md`). Blocked by: 24, 26. Delivers: The worker serves an HTTP API from which any client can read nights and control them.
33. **Export: a kept commit as files, as a git repository, or pushed to a remote** (`33-export.md`). Blocked by: 32. Delivers: An operator can take a night's result out of `experiments.git` from the command line or through the worker API.
34. **App: scaffold, worker-API route, Nights list, Inngest scaffold** (`34-app-scaffold-nights-list.md`). Blocked by: 32. Delivers: A Next.js app on loopback that lists every night through the worker API.
35. **App: the Night page with status, controls, tiles and the live experiment** (`35-app-night-page-controls.md`). Blocked by: 34. Delivers: An operator can watch one night and stop, resume or continue it from the browser.
36. **App: metric tables, convergence chart, heatmap, experiment detail and export** (`36-app-night-page-analysis.md`). Blocked by: 33, 35. Delivers: The Night page explains a night: how metrics moved, what each experiment changed, and a download of the result.
37. **Tracing and the scores mirror** (`37-tracing-scores.md`). Blocked by: 20. Delivers: A night's model calls, tool calls, sandbox operations and metered calls show up as spans, and dev metrics as scores on the experiment's run.
38. **Proxy backends: OpenRouter and Pi** (`38-proxy-backends.md`). Blocked by: 15, 20. Delivers: On a real-model night the proxy forwards a program's calls to OpenRouter or through Pi, charges what each cost, and turns a credit signal into a credit stop.
39. **Web research for the coder, behind the guard** (`39-web-research-guard.md`). Blocked by: 20. Delivers: On a real night the coder can search and read the web through three guarded tools, and can never reach the project's own repository.
40. **Final acceptance: the free end-to-end suite and the fixed contracts** (`40-final-acceptance.md`). Blocked by: every ticket from 21 to 39. Delivers: The seven mock nights of the done signal, one after the other, on a freshly started dev server and worker; then the audit of the fixed contracts, the constants and the known gaps. No paid call.
41. **Paid night 8: capitals-smoke on real models, with the operator's go-ahead** (`41-paid-night-8-capitals-smoke.md`). Blocked by: 40. Delivers: The one paid night of the done signal, `capitals-smoke` on real models, run only with the operator's go-ahead and under its ceiling.

## Critical path

01 → 02 → 03 → 08 → 09 → 11 → 12 → 13 → 20 → 21 → 22 → 24 → 32 → 34 → 35 → 36 → 40 → 41.
