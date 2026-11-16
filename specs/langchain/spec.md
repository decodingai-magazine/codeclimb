# CodeClimb on the LangChain ecosystem — Build Spec (System 1)

CodeClimb is an optimization loop: a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. Nothing is fine-tuned or trained.

This file says what to build and why: the goal, the architecture, the features, the interfaces the build must honour, and the numbers. It holds no code and no design below the level of a component. It is handed to a coding agent that builds the whole application alone, with zero human input, from this file and the given inputs ([[#Given inputs]]).

## Goal and done signal

Build the application so that a **night** (one run of the loop) works end to end: durable execution, sandboxes, coding-agent sessions, commits, evaluations, the review, the test evaluation and the result files.

You are done when the seven nights below pass, run one after the other on `npm run server` with Docker sandboxes and mock models ([[#Mock mode]]). They cost nothing. `E2E.md` holds the same nights as a procedure; where the two differ, this file wins.

Before the first night: Docker is running; `docker images` lists `codeclimb-python` and, for night 7, `codeclimb-graphrag`; `.env` holds `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT` and `LANGSMITH_TRACING=false`, and nothing else: the nights must pass with that file; `npm run server` has run on the code under test and `http://127.0.0.1:8123/ok` answers; no `cc-` container exists, running or stopped (`docker ps -a`). One night at a time, each with a fresh `--night-id`; a night may start as soon as the previous `run-night` exits.

| # | night | what it must show |
|---|---|---|
| 1 | `npm run run-night -- --config configs/capitals-smoke.yaml --mock` | The program under evaluation reaches a model only through the metering proxy, and its calls are metered |
| 2 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` | Two rounds: round 1 is kept, a noise run follows, the review hands its hypothesis to round 2. Ends on `max_rounds` after exactly 2 rounds |
| 3 | `npm run run-night -- --config configs/e2e/plateau.yaml --mock` | The plateau stop: nothing is kept, so the night ends on `plateau` after round 1 |
| 4 | Night 2 with `--no-wait`, then `npm run run-night -- stop --night <id>` once `exps/<id>-r1-e0/` exists | A hard stop mid-round leaves nothing running |
| 5 | Night 2 with `--no-wait`; once `exps/<id>-r2-e0/` exists, `docker kill` the server container (the compose service `langgraph-api`; Postgres and Redis keep running), then `npm run server` again and nothing else | Crash resume: the night carries on by itself from where it was |
| 6 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` | A lost connection mid-turn: the coder's session carries on once model calls succeed again |
| 7 | `npm run build:image:graphrag`, then `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` | A multi-stage, metered scenario with a repository check, host commands through `uv`, a repair, and lessons at the end |

Nights 1, 2, 3 and 6 write to `runs-langchain/mock/<name>/` (`capitals-smoke`, `datenorm-smoke`, `e2e-plateau`, `datenorm-smoke`). Paths below are under `nights/<id>/` unless they name `results.jsonl`, `experiments.git` or `lessons/`. For each of these nights:

- C1. `run-night` prints `done`; `stop_reason` is `max_rounds` or `thresholds` (`plateau` for night 3)
- C2. `done.json` exists; `stop.json` and `pause.json` don't
- C3. `npm run validate-results -- runs-langchain/mock/<name>/results.jsonl` passes, with the path relative or absolute
- C4. `results.jsonl` has a row per experiment of every round, plus a `test` row
- C5. `git -C …/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit; its diff adds `MOCK.md`
- C6. `exps/*/code-state.json` has `stop: done`; `exps/*/session/` holds a session file
- C7. `reviews/r<n>.json` exists for every round, with `feedback: mock feedback`
- C8. `exps/*/train-score.json` and `exps/*/tasks.json` exist; the session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code")
- C9. `bundle/history/notes/r<round>-e<n>.md` per experiment, with a `mock note` coder part and, where reviewed, a `mock verdict` reviewer part
- C10. every experiment row has `decision_reason`
- C11. `datenorm-smoke`: round 1's commit holds the starter's code, which scores above 0 on dev (accuracy 0.125), so it is kept; a `noise` row follows in round 2 and `noise.json` exists. `capitals-smoke` scores 0 and keeps nothing
- C12. `done.json` has `spend_usd: 0`
- C13. `capitals-smoke`: `evals/*/meter.jsonl` lists the program's calls, none with `error`
- C14. no `cc-<id>` container exists, running or stopped (`docker ps -a`)

Added per night:

- night 3: `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; a `test` row exists; no `cc-<id>` container exists, running or stopped
- night 4: the stop command prints `stopped` and exits 0. Within 30 s of it: `stop.json` has `reason: manual`; no `done.json`, no `test` row, no `cc-<id>` container, running or stopped. A `run-night` that was following the night prints `stopped` too
- night 5: if the night finishes before round 2 starts, nothing is killed: run it again under a new id. After the restart the night finishes within 8 minutes, with no watchdog, no manual resume and no other command: `done.json` exists; every `eval_id` is in `results.jsonl` once; round 1's `code-state.json` is unchanged (sha256 and mtime); no `cc-<id>-r1-` sandbox is created after the kill. Only the step running at the kill reruns
- night 6: C1 to C14, and `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one

Night 7 writes to `runs-langchain/mock/graphrag-smoke/`. On mock models a dev evaluation may fail (the canned chat answer gives the extraction stage no rows): then the round's `e0` gets a repair `e1`, both are recorded as `error`, nothing is kept, and the test evaluation scores the starter on all three stages. The checks hold with or without the failure and the repair. C1, C2, C3, C5, C6, C7, C10, C12 and C14 hold, and:

- `results.jsonl` has an `e0` experiment row for every round and exactly one `test` row. A round has an `e1` row only after an `e0` row with decision `error`; no round has an `e2`
- every `e0` session holds eight send-backs, then one wrap-up; an `e1` session holds neither. `train-score.json` and `tasks.json` exist for both
- a note per experiment with a `mock note` coder part; the `mock verdict` reviewer part is on the note of the round's last experiment
- every experiment has `exps/<exp>/check.json` with an empty `errors` list
- every evaluation, dev and test, has `evals/<eval>/extraction/inputs.jsonl` with 8 lines and `extraction/run.log`
- the test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`, and a `metrics.json`. A dev row that was not scored holds the primary metric at 0 and nothing else
- the `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `extraction.…`, `graph.…` and `retrieval.…`, with `<stage>.output_bytes` for each. Every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
- every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
- `noise.json` and a `noise` row exist only if a round was kept
- within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged

Mock metrics mean nothing. The checks prove that everything ran, so the files are the evidence, not `stop_reason` alone.

Also required, though these nights don't reach them: real-model nights, pause and resume, continue, seed, applied lessons, export, the worker API and the app.

## Architecture

| component | responsible for | runs on |
|---|---|---|
| CLI (`run-night`) | Loads and validates the config, checks models, starts, stops, resumes and continues nights, follows a night's rows | the operator's machine |
| Agent Server | The durable runtime and the worker. It runs each night as a graph and, inside it, the Pi sessions, the scenario's host commands and the metering proxy. Its own state lives in its Postgres and Redis | containers on the operator's machine, started by `npm run server` |
| worker API + watchdog | Reads nights from disk; stop, resume, continue, export; recovers nights a crash left behind. A client of the Agent Server, like the CLI | its own process on the operator's machine |
| sandboxes | The coder's shell and files; the program under evaluation | Docker, beside the server container |
| metering proxy | The only path from a program to a model: holds the keys, meters every call, replays repeated calls | inside the Agent Server |
| app | Shows nights and controls them through the worker API. It never runs Pi or sandboxes | Next.js on `127.0.0.1` |
| experiment store | `experiments.git` + `results.jsonl` + `nights/<id>/`: the source of truth. CodeClimb has no database of its own | the checkout on the operator's disk |

Data flow:

- **a night**: the CLI resolves the config and starts the `night` graph. Init builds the coder's bundle from the scenario, imports the starter as the round-0 commit and writes `night.json`. Rounds follow until a stop. After a soft stop the checkpoint is scored on test, `done.json` is written, and the lessons distillation starts
- **a round**: stop check → smoke test → noise run when due → one experiment → dev evaluation → keep or revert → at most one repair → review → the row, the note, the history line and a rejected diff are written → a kept experiment becomes the checkpoint → threshold check
- **an experiment**: a fresh sandbox holds the checkpoint in `/repo` and the bundle in `/spec`. Pi, in the Agent Server, drives it through sandbox tools. Whatever it leaves becomes exactly one commit on the commit its sandbox started from, stored in `experiments.git`. The scenario's check and leak scan then run on the host
- **an evaluation**: its own sandbox, never the coder's. Per stage: inputs on the host → run in the sandbox → score on the host → metrics

Terms:

- the **checkpoint** is the night's last kept commit, with the dev metrics it was kept on. The runtime's saved state is a graph checkpoint
- a **variation** is one start or one continue of a night, with its own deadline, counters and test evaluation
- a **step** is a unit of the night's work whose result is saved once. An **attempt** is one try of a step. A **task** is one item of the coder's plan
- **resume** ends a pause; **crash resume** is a night carrying on after the server was killed; **session resume** is the coder carrying on its Pi session
- a **soft stop** ends a night by its own rules and scores test. A **hard stop** ends it from outside and does not. A **credit stop** pauses it
- "host" means the Agent Server's side of a sandbox
- "bundle" means the coder's `/spec` folder

Isolation invariants, which every feature protects:

- gold, evaluators and provider keys never enter a sandbox. One accepted exception: graphrag's retrieval stage uploads its gold graph into the evaluation sandbox
- only train reaches a coder; the coder never sees evaluation inputs, outputs or reports
- the reviewer reads dev; nothing from test reaches a coder, the reviewer or a lesson
- everything a coder reads that came from the evaluation side is scanned for held-out names first
- every decision reads metrics from evaluations; the agents' own claims decide nothing

## Features

**The loop.** A night is linear: one experiment per round, from the checkpoint. A reverted experiment is dropped and the next round starts from the same checkpoint, carrying what was learned. Why linear: parallel branches cost too many tokens. The starter is never evaluated on dev: it has no dev metrics and a weighted score of 0. Round 1's coder picks its own hypothesis; later rounds test the reviewer's.

**Keep rule.** Each threshold metric contributes its share of its target, capped at 1; the weighted score is the weighted mean of the shares. An experiment is kept only when it has a scored commit that differs from the checkpoint, no guardrail fired (a gate whose metric is missing or above its cap, two or more held-out names in the diff's added lines), and its weighted score beats the checkpoint's by more than the noise margin. The reviewer never decides; cost and latency are reported, never scored. Every experiment row says why it was decided ([[#Decisions]]).

**Noise margin.** A program that calls models scores differently on every run, so a small gain may be luck. At the start of the first round whose checkpoint has metrics, the night evaluates that checkpoint a second time with no replayed calls (the A/A run, a `noise` row of that round) and takes the weighted move between the two as the noise. The margin an experiment must beat is that move, made smaller when part of its model calls were replayed (replayed calls add no noise), and held between a floor and a cap, because one pair is one sample. A failed or implausibly large A/A run is measured again, with at most two A/A runs per night.

**Stops.** Soft stops are checked between rounds: `max_rounds`, `deadline`, `budget`, `tokens`, `plateau`, then `outage` from the smoke test; `thresholds` is checked after each round. The budget and token checks reserve room for one more round and for the test evaluation. Hard stops (the stop command, a failed night, a cancel from outside, the pause timeout, the variation backstop) each cancel the night and its running work, remove its sandboxes and leave a `stop.json`. A night always ends with `done.json` or `stop.json`, also when it fails before `night.json` exists, because the CLI waits for one of them.

**Smoke test.** Before money goes into a round, the night checks again that its models are available and, on a metered night, that the path to the proxy is up. A failure is retried; a lasting one ends the night with `outage`, so an outage never spends a coder's budget on a round that can't be scored.

**Repair.** A commit that failed before it was scored (check errors, or a failed evaluation) says nothing about its idea, so it gets one repair attempt `e1`, from the failed commit, with the masked errors and the same hypothesis, told to fix the failure and nothing else. The failed attempt keeps its `error` row and its note. `e1` is decided against the same checkpoint and stands for the round. No send-backs, no second repair, and none when a stop check would fail.

**Pause for credits.** A program that gets 402 on every call would score as a bad program, so running out of credits pauses the night instead. A credit error from a program call, the coder or the reviewer becomes a credit stop; the coder commits its partial work, the evaluation reports no score, and only the night waits, with no sandbox running. A resume reruns only what stopped: the coder in the same session from its commit, the evaluation from scratch, the review again. Paused time counts against nothing. A pause nobody ends times out and stops the night. Ending a pause is safe to repeat.

**Continue, seed, rescore.** Continue adds rounds to an ended night (one with a `done.json` or a `stop.json`) under the same id: rounds number on from the last recorded round, from the kept commit (the round-0 commit when it kept nothing), with the last review, the history, the notes and the rejected diffs, an optional operator direction, a fresh deadline and a budget that does not compound. A mock night continues as a mock. Seed starts a new night from an ended night's kept commit (`latest`, `best` by weighted dev score, or an id); only the code, its dev metrics and its noise carry over. Rescore: when the scenario's scoring files changed since the kept commit was scored, one extra round first scores it again and measures the noise again, because old scores can't be compared.

**Crash recovery.** After the Agent Server is killed and started again, the night carries on by itself: only the step that was running reruns, and a rerun never redoes finished work or writes a row twice. The watchdog, in the worker API's process, resumes a night the server left behind, a limited number of times, then stops it.

**Coder.** Pi runs in the Agent Server, never in a sandbox, so credentials stay out. Its session is isolated from the host's own Pi and agent setup, and its only tools are `read`, `write`, `edit` and `bash`, acting in the sandbox, plus guarded web research. Its prompt gives it the scenario's spec, the night so far, the targets still short of their thresholds, the hypothesis, how the keep works, and its time and budget. It plans in `/tmp/tasks.json`, leaves notes for the next coder, measures on train before and after, and ends with an `APPROACH` line. An experiment ends when the coder is done, on its time or budget cap, when idle, on an infrastructure error (a failed model call is not one), on a credit stop or when cancelled; every end but a cancel commits, because partial work is still a result. A turn that ends on a failed model call is a stop like any other, so the session carries on once calls succeed again.

**Send-backs and wrap-up.** A coder may stop long before its time is up, with open tasks or no measurement. So a coder that stops before its reserve (the last part of its time or budget), or with open tasks or a missing train measurement, is sent back for one more change, up to a cap. Once the reserve starts, or after the send-backs end, it gets one wrap-up telling it to change no more code and to close its work. A repair gets neither.

**Web research guard.** The coder may search and fetch the web, on the host, but only through three tools with narrowed inputs: no other plugin tool, no call that would use the host's credentials or another model, and never the project's own repository, which holds the gold. Off in mock mode.

**Evaluator.** One sandbox per evaluation, created after the coder's is destroyed. It sets up the commit's Python environment: a `uv.lock` in the commit, if present, is synced into the sandbox's environment; without one the program runs on the image's Python. It then runs each stage in order under `eval_min`, saves the run log, downloads the outputs and scores them on the host. A program crash, a timeout, a scorer failure or, on dev, an empty stage makes the evaluation an outcome with `ok: false` that the reviewer and the next coder read; an infrastructure failure is retried. Test always runs every stage. The standard metrics (latency from the runner's timings, cost and call counts from the proxy's ledger) are measured outside the code under optimization and always recorded.

**Reviewer.** One Pi session per round, with no tools, on a model or a thinking level that differs from the coder's. It reads the spec, the checkpoint, the experiment's diff, metrics, per-item dev errors and run logs, the coder's notes and the night so far, and writes `feedback`, the next round's `hypothesis` and a short `verdict`. It runs every round, also after a revert and in the last round. It may describe categories of error but never name a dev item; its output is scanned and what the scan finds is rewritten or masked. A failed review keeps the last feedback and never kills the night.

**Notes, history, rejected diffs.** What a night learns stays with it: one note per experiment (the coder's notes, then the reviewer's verdict), one history line per round, and the whole diff of every round that kept nothing. They are masked, and later coders find them under `/spec/history/`. The coder and the reviewer of a round read the trajectory of all earlier rounds, cut from the oldest end when it outgrows its budget.

**Lessons across nights.** A night's notes die with its bundle; the scenario's `lessons.md` is the only memory between nights. When a night ends or is stopped, a distillation reads the new notes and reviews (never test) and proposes add, edit and drop operations on the file, which code applies, so untouched lessons stay byte for byte. Proposals pass gates: no held-out name, no metric value, bounded size, no near-duplicate. A proposal is written to disk; in `apply` mode it also updates the scenario's file, never for a mock night and never as a commit. One distillation at a time per scenario.

**Metering.** Sandboxes hold no provider key: a program reaches a model only through the proxy, with a token that carries the allowed models and a dollar cap. Every call is a ledger row. Within a night a repeated call is replayed from a cache for free, so unchanged code scores the same and a metric moves only where a change reached. A coder has its own dev ledger, capped by the experiment's budget; an evaluation's ledger is the source of the cost metrics. The path from sandbox to proxy is checked before it is used, so a broken path is an outage and never a score.

**Sandboxes.** Git holds the state and the image holds the environment; no sandbox holds git or provider credentials, and a stop kills a sandbox's whole process tree. Names are deterministic, so a rerun step finds its sandbox and a sweep cleans a night. A stopped night creates no new sandbox.

**Worker API and app.** The API serves night summaries, the live experiment, a report, stop, resume, continue and export. Status comes from the files on disk, not from the runtime. The app lists nights and shows one night: status and controls, the kept and test scores, spend, the live experiment, per-stage metric tables, a convergence chart, a heatmap of per-family accuracy, the selected experiment with its diff, and export.

**Export.** A kept commit leaves CodeClimb as plain files, as a git repository with the kept lineage as history, or as a push to a remote branch. It never force-pushes and refuses unsafe remotes.

**Tracing.** LangSmith traces each experiment, evaluation and review, findable by night id, and holds each successful dev evaluation's headline scores as feedback on its experiment; nothing reads it back, and with tracing off none of it runs.

## Interfaces the build must honour

Contract only. Source layout and everything not listed here is yours.

### Given inputs

- unchanged by you: `scenarios/` (`datenorm`, `datenorm-hard`, `capitals`, `graphrag`), `configs/` (`capitals-smoke.yaml`, `datenorm-smoke.yaml`, `datenorm.yaml`, `graphrag-smoke.yaml`, `graphrag.yaml`, `e2e/plateau.yaml`, `e2e/budget.yaml`, `e2e/overfit.yaml`), `docker/` (the two sandbox Dockerfiles), `E2E.md`, Pi's docs at `/docs/pi/`
- a starting point, yours to change: `package.json`, `langgraph.json`, `src/hello.ts`, `tsconfig.json`, `.env.example`. The given `server` script and graph are placeholders
- `budget.yaml` must load; `overfit.yaml` loads once `npm run build:scenario:overfit` has written `generated/datenorm-overfit` with `scenarios/datenorm/scripts/build_overfit.py --out`
- credentials: one gitignored `.env`; Pi's `auth.json`

### Commands and services

- npm scripts: `server`, `server:logs`, `server:stop`, `api`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:dataset:hard`, `build:scenario:overfit`, `export`, `lessons`, `dev`, `build:app`, `typecheck`, `test`
- install: `npm ci --ignore-scripts` must be enough
- graphs the Agent Server serves: declared in `langgraph.json`; their names and their number are yours
- `npm run server`: starts or updates the Agent Server from the checkout and returns once `http://127.0.0.1:8123/ok` answers; fails when it cannot. The server container is the Docker Compose service `langgraph-api`; Postgres and Redis are services of their own and survive its kill. Running `server` again after a kill or a code change brings the server back with its state. `server:stop` stops the stack and keeps its state
- everything a night writes lands in the checkout, under `<root>/runs-langchain/`
- images: `codeclimb-python` (`build:image`) and `codeclimb-graphrag` (`build:image:graphrag`), built from the given Dockerfiles. Gold, evaluators and keys never enter an image
- host commands run with `bash`, `git`, `tar`, `python3` and `uv`; graphrag's need Python 3.14
- worker API: `127.0.0.1:7421`; app: `127.0.0.1`

### CLI

| command | does |
|---|---|
| `run-night --config <yaml> [--night-id ID] [--sandbox docker] [--seed ID\|latest\|best] [--rounds N] [--no-wait] [--mock [--mock-offline N]]` | Starts a night and follows it |
| `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N] [--no-wait]` | More rounds on an ended night; default: the newest ended one |
| `run-night stop --night ID` | Hard stop, reason `manual` |
| `run-night resume --night ID [--no-wait]` | Ends a pause, then follows |
| `validate-results <file>`, `validate-results --schema` | Checks a rows file; prints the row schema |
| `export` (from a config or a rows file; an experiment or `best`; to a directory or a remote branch) | A kept commit out of CodeClimb |
| `lessons distill`, `lessons apply`, `lessons format` | Lessons by hand |

- night id: `--night-id`, else `n<YYYYMMDD>-<HHMMSS>`; 1 to 48 letters, digits or hyphens, not starting with a hyphen. An id used before is refused; an id that is running is followed, not started twice
- following: new rows every 5 s; `done` when `done.json` appears, `stopped` when `stop.json` does, each as the first word of a line of its own; then exit 0. `--no-wait` starts the night and exits 0. Ctrl-C detaches
- `stop` prints `stopped` and exits 0 once `stop.json` exists; `done` for a night that finished first
- `--rounds` sets `max_rounds` on a new night and adds rounds on a continue; a continue keeps a mock night a mock; `resume` only ends a pause, once
- a usage or validation error exits 2

### Mock mode

`--mock` runs the same night on scripted models; everything else is real. No provider is called and no provider credential is needed. Results go to `runs-langchain/mock/<results_path>`.

| who | scripted answer |
|---|---|
| coder (provider `mock`, model `coder`) | After a tool result: the text `APPROACH: mock change, no real work`. Otherwise one `bash` tool call that appends a timestamped line to `MOCK.md` and writes `/tmp/tasks.json` (one task, status `done`), `/tmp/notes.md` (`mock note`) and `/tmp/train-score.json` (`before`, `after`, `command`). Every prompt is answered this way |
| reviewer (`reviewer`) | JSON: `feedback` = `mock feedback`, `hypothesis` = `mock hypothesis`, `verdict` = `mock verdict` |
| lessons (`lessons`) | JSON with an empty `ops` list |
| program calls | chat `mock`; embeddings `[1, 0, 0, 0]` per input; decisions `{}`; rerank every score 0; all at cost 0 |

- skipped: the model checks, the smoke test, web research; lessons are never applied
- `--mock-offline N`: the coder's model calls 2 to N+1 of the night's first experiment fail: an assistant message with stop reason `error` and the text `fetch failed`
- `CODECLIMB_MOCK_CREDIT=<who>:<n>`: a test hook with no CLI flag; on a mock night, call number `n` of the night's calls by `who` (`coder`, `reviewer` or `program`) fails once with a 402, to exercise the credit pause

### Night config

| field | default | meaning |
|---|---|---|
| `scenario` | required | Scenario directory, relative to where `run-night` starts |
| `sandbox` | required | `docker` only |
| `max_rounds` | required | ≥ 1 |
| `max_tokens` | none | Cap on coder + reviewer tokens |
| `plateau_rounds` | 3 | Rounds in a row that kept nothing; 0 = never |
| `deadline` | required | ISO time, or a duration from the start: `90m`, `8h`, `30s` |
| `timeouts.experiment_min`, `.eval_min` | required | `eval_min` is per stage run |
| `model`, `reviewer_model` | required | `<provider>/<id>` through Pi; the reviewer must differ from the coder in model or thinking |
| `coder_thinking`, `reviewer_thinking` | `medium`, `low` | `off`, `minimal`, `low`, `medium`, `high` |
| `allowed_models` | `[]` | Models the program may call; empty = unmetered |
| `primary_metric` | required | The score shown; an evaluation counts only if it reports it. Decides nothing |
| `thresholds` | required | Metric → target > 0, higher is better |
| `weights` | 1 each | Metric → weight > 0, threshold metrics only |
| `gates` | `{}` | Metric → cap; a gate fails when its metric is missing or above its cap |
| `standard_metrics` | `latency`, `cost`: true; `latency_metric`: `latency_total_s`; `cost_metric`: `cost_per_item_usd`; `min_efficiency_gain`: 0.10 | Which standard metrics the agents are told to watch |
| `budget_usd.experiment`, `.night` | required | Caps of one experiment (`coder_usd + dev_usd`) and of the night |
| `noise_margin` | `min` 0.002, `max` 0.005, `fixed` none, `scale_by_replay` true | |
| `lessons` | `apply` if the scenario declares lessons, else `off` | `off`, `propose`, `apply` |
| `seed` | none | A night id, `latest` or `best` |
| `results_path` | required | `<folder>/results.jsonl`, relative to `<root>/runs-langchain/`. Absolute paths, `..` and deeper paths are refused |

- `<root>` is `CODECLIMB_ROOT`, by default the start directory. The CLI resolves `results_path` once; `night.json` holds the resolved form

### Scenario contract

CodeClimb never reads a scenario's data: it runs the commands in `scenario.yaml`. A scenario directory holds `scenario.yaml`, `starter/`, `spec/agent/`, optional `spec/evaluator/`, `gold/`, `evaluators/`, `scripts/`, optional `corpus/`.

| field | meaning |
|---|---|
| `name`, `image` | Scenario name; sandbox image |
| `bundle` | Host: writes the coder's bundle to `{out}`; it must contain `spec/`. A `train/` in it switches on the train measurement |
| `stages[]` | At least one, unique names `^[a-z][a-z0-9_-]*$`, run in order |
| `headline`, `diagnostics`, `protocol` (opt) | Metric names each round reports; regexes of metrics the reviewer reads; files the reviewer reads (`path#Heading` = one section) |
| `check` (opt) | Host: reads the commit in `{repo}`, writes `{report}` with `errors` and `notes`. Errors block the evaluation |
| `scan` (opt) | Host: reads `{text}`, writes `{report}` with `found`, the held-out names in it |
| `lessons` (opt) | Path of `lessons.md` inside the agent spec |

| stage field | where | job |
|---|---|---|
| `inputs` | host | Writes the `{split}` input to `{inputs}` |
| `files` | host → sandbox | Sandbox path → scenario-relative path, uploaded before `run` |
| `run` | sandbox, cwd `/repo` | Runs the program on `{inputs}`, writes under `{out}`, optionally `timings.jsonl` |
| `score`, `details` (opt) | host | Scores `{out}` on `{split}` into `{report}`; `details` adds per-item errors and is used on dev only |

- host commands run through `bash -c` in the scenario directory with shell-quoted, absolute placeholder values; an unknown placeholder is an error
- `{split}` is `dev` every round and `test` once per variation; never `train`
- sandbox paths of a stage: `/eval/<stage>/inputs.jsonl`, `/eval/<stage>/out`, log `/eval/<stage>/run.log`; `/repo/.venv/bin` is first on the path
- masking: every found name becomes `[hidden]`, any letter case, longest first
- metrics from a report: numbers flattened with `.`; lists, `per_item` and `details` skipped; `ci95: [lo, hi]` becomes `ci95_half`. With more than one stage every key gets `<stage>.` in front. Each stage adds `output_bytes`
- standard metrics: `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s`, `latency_total_s` from `timings.jsonl` lines `{op, id?, ms, warmup?}`; `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed` from the ledger
- scoring hashes: `night.json` records a sha256 of the scenario's scoring files, so a changed scorer is detected for a rescore

### Ids

| thing | id |
|---|---|
| starter / seed commit | `<night>-r0-starter` / `<night>-r0-seed` |
| experiment; its repair | `<night>-r<N>-e0`; `<night>-r<N>-e1` |
| dev evaluation | `<exp>-eval` |
| noise run | `<exp>-noise-r<N>`, N = the round it ran in |
| test evaluation | `<night>-test-r<N>`, N = the last round |
| sandbox | `cc-<exp id>` for a coder; `cc-<night>-r<N>-<kind>` for an evaluation of round N (the round it runs in), `cc-<night>-test-r<N>` for the test evaluation |

Every sandbox name starts with `cc-<night>`, and labels name its night, so a sweep finds it.

### Stops

| `stop_reason` in `done.json` | when |
|---|---|
| `max_rounds` | the next round would pass `max_rounds` |
| `deadline`, `budget`, `tokens` | the deadline passed, or one more round would pass the night's dollar or token cap |
| `plateau` | `plateau_rounds` rounds in a row kept nothing |
| `outage` | the smoke test kept failing |
| `thresholds` | every threshold metric of the checkpoint ≥ its target |

- the first five are checked in this order at the start of a round
- `stop.json` `reason`: `manual` for the CLI's stop; other reasons name the API, a failure or a cancel. The first stop wins; none is written once `done.json` exists
- an experiment's `stop` in `code-state.json`: `done` when the coder finished; other values name the cap, idle, error, credit stop or cancel that ended it

### Decisions

- share = `min(max(value, 0) / threshold, 1)`, 0 when missing; weighted score = Σ `weight × share` / Σ weights; the margin is the noise margin of [[#Features]]

| case | `decision` | row metrics | `decision_reason` |
|---|---|---|---|
| the coder failed outright | `error` | primary = 0 | `the experiment failed` |
| unchanged files | `revert`, `unchanged: true` | the checkpoint's | `no code change` |
| check errors or failed evaluation | `error` | primary = 0 | `not scored` |
| guardrail | `revert` | its own | `blocked: <guardrails>` |
| scored | `keep` or `revert` | its own | never empty: says how the weighted score compares with the checkpoint's plus the noise margin |

### Files a night writes

Under the results directory, the folder of the resolved `results_path`:

| path | content |
|---|---|
| `results.jsonl` | Every night's rows |
| `experiments.git` | Bare repo; one commit per experiment at `refs/exp/<exp id>`; commit message `<exp id>: <hypothesis>`. The starter commit is deterministic: the same tree has the same SHA |
| `lessons/<night>-r<N>/` | `lessons.md`, `changes.md`, `proposal.json` (`ops`, base sha256, cost, `applied`) |
| `nights/<id>/night.json` | The night's identity, start, deadline, round-0 commit, resolved config and scoring hashes, written at init |
| `nights/<id>/done.json` | `night_id`, `stop_reason`, `rounds` (the last recorded round), `kept` (`exp_id`, `commit`, `dev_score`), `test_metrics`, `spend_usd`, `finished_at` |
| `nights/<id>/stop.json` | `at`, `reason` |
| `nights/<id>/pause.json`, `pauses.jsonl` | The current pause and who stopped it; the log of pauses and how long each lasted |
| `nights/<id>/noise.json` | The noise margin and the two A/A runs it came from |
| `nights/<id>/bundle/` | The coder's `/spec`: `spec/`, optional `train/`, `history/notes/r<N>-e<n>.md`, `history/r<N>.diff` |
| `nights/<id>/reviews/r<N>.json`, `r<N>.prompt.md` | `round`, `model`, `feedback`, `hypothesis`, `verdict`, `reviewer_usd`, `t_review`, `tokens`; what the review read |
| `nights/<id>/exps/<exp>/` | `session/*.jsonl` (Pi's session file), `code-state.json`, `tasks.json`, `train-score.json`, `check.json` (`errors`, `notes`, `held_out_names`, `failed`), `meter-dev.jsonl` |
| `nights/<id>/evals/<eval>/` | `<stage>/{inputs.jsonl, run.log, outputs/, report.json}`, `meter.jsonl`, `metrics.json` |

- `code-state.json`: the coder's progress, spend and timings, with `stop` at the end. Rewritten as the coder works; not touched again once the coder finished
- a note: heading `## r<N>-e<n> · <decision>: <reason>`, then `### Coder, before the evaluation`, then `### Reviewer, after the evaluation`. A failed attempt that gets a repair has the coder part only
- coder files in the sandbox: `/tmp/tasks.json` (a list of `{task, check, status}`, status `todo`, `done` or `dropped` with a `note`), `/tmp/notes.md`, `/tmp/train-score.json` (`before`, `after`, `command`, optional `why`)
- literal phrases, each in no other prompt: "You stopped with N of N minutes and $X of $Y left" in every send-back; "change no more code" in the wrap-up. Send-backs and the wrap-up are user messages in Pi's own session file, where they are counted
- `lessons.md`: a `# ` title, preamble, `## ` sections holding only `- ` bullets

### Result row

One JSON line per experiment, noise run and test evaluation, validated against a JSON Schema on append and unique by `eval_id`.

| fields | meaning |
|---|---|
| `night_id`, `exp_id`, `parent_id`, `eval_id`, `round` | Identity. `parent_id` is null on noise, rescore and test rows |
| `stack`, `backend` | `langchain`; `docker` |
| `kind`, `split` | `experiment`, `noise`, `test`; `dev`, `test` |
| `model`, `reviewer_model`, `hypothesis`, `commit` | `model` and `hypothesis` may be null |
| `metrics` | Flat name → number. A row that was not scored holds the primary metric at 0 and nothing else |
| `decision`, `score`, `decision_reason` | `keep`, `revert`, `error`; the weighted score; why |
| `coder_usd`, `dev_usd`, `program_usd`, `reviewer_usd`, `tokens` | `reviewer_usd` repeats on a round's rows: count it once |
| `wall_s`, `t_provision`, `t_code`, `t_eval`, `t_review`, `t_teardown`, `infra_errors` | Seconds; a count |
| `evaluator_instance`, `unchanged` | The sandbox incarnation that evaluated; no code change |

- optional in the schema, written where they apply: `kind`, `eval_id`, `night_id`, `score`, `decision_reason`, `dev_usd`, `evaluator_instance`, `unchanged`. `night_id`, `kind` and `eval_id` are written on every row. `round`, `tokens`, `infra_errors` are integers ≥ 0
- noise and test rows carry the checkpoint's `exp_id` and `commit` and the evaluation's id as `eval_id`; `decision` is `keep` if the evaluation succeeded, else `error`. An experiment never evaluated still has `eval_id` `<exp>-eval`
- with nothing kept, test runs on the round-0 commit and `done.json`'s `kept` names it

### Metering proxy

| route | body |
|---|---|
| `POST /v1/chat/completions` | OpenAI's shape; text messages only, no tools, no streaming |
| `POST /v1/embeddings` | `input`: a string or a list |
| `POST /v1/decisions` | `model`, `state`, `questions`, optional `assets` → `answers` |
| `POST /v1/rerank` | `model`, `query`, `documents`, optional `top_n` → `results` with `index` and `relevance_score` |
| `POST /v1/_op` | `op` (`^[a-z][a-z0-9_]*$`): names the operation later calls belong to; default `program`; answers 200 and writes no ledger row. Scenario runners call it first and fail on any other status |

- program side: `OPENAI_BASE_URL` and `OPENAI_API_KEY`, also as `CODECLIMB_LLM_BASE_URL` and `CODECLIMB_LLM_API_KEY`, point a metered sandbox at the proxy. The base URL ends in `/v1`: programs and runners append `/chat/completions`, `/_op` and the other routes to it
- refusals: a bad token, an oversized body, a model not allowed, a credit stop or a spent cap, an unsupported request, each answered with an OpenAI-shaped `error`; an upstream failure is 502
- a ledger row, one line of `meter.jsonl` or `meter-dev.jsonl`: `kind` (`chat`, `embeddings`, `decisions`, `rerank`), `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd`, `ms`; when they apply `error` (never on a successful call), `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected`. The file is written only when the ledger has rows
- backends: `openrouter/<id>` models go to OpenRouter; other chat goes through Pi

### Worker API

- under `/api/`: health, night summaries (mock nights included), a night's live experiment and its report, for the app to read; stop, resume, continue and export (download, or to a directory or remote), for the app to control. No token on loopback; off loopback `CODECLIMB_WORKER_TOKEN` as a bearer
- a night's status comes from its files: `finished`, `stopped`, `paused`, `stale` (no file written for an hour), else `running`. App pages: `/` and `/nights/<id>`

### Environment

| variable | meaning |
|---|---|
| `LANGSMITH_API_KEY` | Required for the server to boot, mock nights included |
| `LANGSMITH_TRACING`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID` | Tracing on or off (`false`: nothing is traced); the project; the key's region endpoint; the workspace |
| `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY` | Provider keys |
| `CODECLIMB_ROOT` | The checkout that config paths and `runs-langchain/` resolve against |
| `CODECLIMB_SERVER_URL` | Where the CLI and the API reach the Agent Server; default `http://127.0.0.1:8123` |
| `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT`, `CODECLIMB_WORKER_TOKEN`, `CODECLIMB_WORKER_URL` | The worker API's address and bearer; where the app reaches it |
| `CODECLIMB_PI_AUTH_PATH` | Another `auth.json` than Pi's default |
| `CODECLIMB_PAUSE_TIMEOUT_S`, `CODECLIMB_BACKSTOP_S` | Test hooks that shorten the pause timeout and the variation backstop |
| `CODECLIMB_MOCK_CREDIT` | Test hook: a mock night's scripted credit error ([[#Mock mode]]) |

- `.env` is loaded by the CLI and the API and reaches the Agent Server; values already in the shell win. The build needs no value in it beyond the three LangSmith ones of the done signal

## Runtime and tools

- **LangGraph JS** runs a night as durable, checkpointed execution: the night's work is cut into steps whose results are saved, so a finished step is never run twice
- the **Agent Server**, LangGraph's self-hosted server with its own Postgres and Redis, hosts the build's graphs, queues and cancels their runs, brings a night back after a crash, and suspends a night for a pause until a human resumes it
- **LangSmith** holds the traces of a night and, as feedback, a mirror of each experiment's scores
- **Docker** gives every coder and every evaluation its own sandbox, and runs the Agent Server
- **Pi** (`@earendil-works/pi-coding-agent`) is the coding agent behind the coder, the reviewer and the lessons distillation; its scripted provider supplies the mock models, and `pi-web-access` its web research
- **OpenRouter** is the provider behind the metering proxy for models named `openrouter/<id>`, and the only one for decisions and rerank; other chat models go through Pi's providers
- **Next.js** serves the app; TypeScript on Node 24, run from source, is the language of everything but the scenarios

What the build needs from the runtime, as outcomes:

- a night survives a kill of the server and carries on without a human
- a step that fails is retried, and one that keeps failing becomes the outcome of its experiment or evaluation, not the end of the night
- no step runs for ever: each has a backstop timeout longer than its own time limit, and a stop reaches work that is already running
- one night id is one night; a continue starts clean; lessons runs for one scenario never overlap
- one server serves one checkout. Nights are run one at a time: that is the operator's rule, not a check of the build, and a night may start as soon as the previous `run-night` exits

## Numbers

| area | constant | value |
|---|---|---|
| loop | smoke test | 7 tries, 5 min apart |
| loop | A/A runs per night; repairs per round | at most 2; 1 |
| loop | held-out names in a diff that block a keep | ≥ 2 |
| loop | pause timeout; variation backstop | 3 days; 4 days |
| runtime | crash resume: a mock night finishes after the restart | within 480 s (8 min) |
| runtime | hard stop: `stop.json` and no sandbox left | within 30 s |
| done signal | each mock night, from `run-night` to its exit | within 300 s |
| done signal | round 1 (night 4) or round 2 (night 5) reached, from the start | within 120 s |
| done signal | `run-night --no-wait` and `run-night stop` return, exit 0 | within 120 s |
| done signal | a `run-night` that follows a stopped night prints `stopped` | within 60 s of the stop |
| done signal | `validate-results` on a night's rows file | within 300 s |
| done signal | `npm run server` returns, with `/ok` answering, cold or after a kill | within 600 s |
| build | `npm ci --ignore-scripts`; `typecheck`; `test`; `build:image`, `build:image:graphrag` each | 900 s; 600 s; 1200 s; 1200 s |
| build | `npm test` runs after `build:image`, with `.env` present, no Agent Server up and no `codeclimb-graphrag` image | |
| coder | reserve | the last 20% of time or budget |
| coder | send-backs | at most 8; none with < 3 min left; none for a repair |
| coder | wrap-ups per experiment | 1 |
| lessons | proposal on disk after `done` | within 1 min |
| proxy | request body | 16 MiB |
| ports | Agent Server; worker API | 8123; 7421 |
| sandbox | size | 2 vCPU and 2 GiB |

The mock coder stops at once on every turn, so a mock session holds the full 8 send-backs and one wrap-up: a coder that was sent back at least once gets the wrap-up as one more turn after the last send-back. Scenario numbers (thresholds, budgets, timeouts, models) live in `configs/*.yaml`.

## Dependencies

Pinned to exact versions.

| package | version |
|---|---|
| `@earendil-works/pi-coding-agent` | 1.3.0 |
| `@earendil-works/pi-ai` | 1.3.0 |
| `pi-web-access` | 0.47.0 |
| `@langchain/langgraph` | 1.7.3 |
| `@langchain/core` | 1.3.7 |
| `@langchain/langgraph-cli` | 1.7.1 |
| `@langchain/langgraph-sdk` | 1.15.0 |
| `langsmith` | 0.12.0 |
| `@opentelemetry/api` | 1.10.0 |
| `next`, `react`, `react-dom` | 16.4.2, 19.3.1, 19.3.1 |
| `yaml`, `tsx`, `typescript` | 2.9.1, 4.23.15, 6.0.3 |
| `@types/node`, `@types/react`, `@types/react-dom` | 24.19.2, 19.3.0, 19.3.0 |
| `zod` | 4.6.7 (from the scaffold; optional) |
