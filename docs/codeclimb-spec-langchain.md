# CodeClimb on the LangChain ecosystem — Build Spec (System 1)

- what CodeClimb is: an optimization loop where a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. Nothing is fine-tuned or trained
- this file: everything needed to build CodeClimb from scratch on the LangChain stack: LangGraph JS, the Agent Server (the self-hosted server `langgraphjs up` starts, with its own Postgres and Redis), LangSmith tracing and feedback, Docker sandboxes. It states architecture, contracts, features and numbers; it holds no code
- status: built on the `langgraphjs up` server, moved from LangGraph's dev server on 2026-11-12 (decided in issue #26 after the go/no-go spike #27; the seven free end-to-end nights pass on it). Derived from the Inngest twin, which is built ([[codeclimb-spec-inngest|codeclimb-spec-inngest]], commit `e384bb5`). The platform facts below were measured on the pinned packages with a throwaway graph, and are stated as facts in [[#Platform facts]]. The build tickets, #20 to #32 included, are closed; what they left unmeasured or undecided is listed in [[#Open points for the build]]
- use: handed to a coding agent that builds the whole application alone, with zero human input (the layer-2 benchmark of [[codeclimb-eval-spec|codeclimb-eval-spec]])
- first build: on the `langchain` branch of the codeclimb repo, from this file alone (the repo holds a copy at `docs/codeclimb-spec-langchain.md`; change both together). The repo also gives `GLOSSARY.md`, `docs/adr/0001` to `0005` (0001, superseded: why the dev server; why steps own their abort signal; why one trace per experiment; why Docker only; 0005: why `langgraphjs up`) and the end-to-end skill `.claude/skills/codeclimb-e2e/SKILL.md`; all three repeat what this file says. Run the free end-to-end nights as the build reaches them ([[#Suggested build order]]), and the paid ones only when the operator says so. Nothing here needs `codeclimb-eval-spec`: that is for a later benchmark
- stack-specific parts: [[#Durable runtime on LangGraph]], [[#Tracing]], [[#Deployment and environment]], plus the stack's names in the npm scripts, the result row and the control operations. Everything else is stack-neutral and matches the Inngest twin (the Inngest dev server with Docker sandboxes), so the two builds behave the same and their nights compare. Declared differences, each forced by this stack or decided for it:
  - one mode: the self-hosted Agent Server in containers on the operator's machine (`langgraphjs up`), with Docker sandboxes ([[#Deployment and environment]])
  - the worker API runs in its own process: it serves no `/v1`, a busy port is a startup error, and its token covers every route. The proxy has its own listener
  - what fires the live registry's aborts, and the sandbox create refusing a stopped night
  - step timeouts are CodeClimb's own timers, not the runtime's. Steps other than code and evaluation are capped at 30 minutes and host commands at 35, because nothing else bounds a hung step here
  - a rerun step is recognized by its state file, not by its attempt number, which restarts at 1 after a server restart
  - lessons runs are queued, not deduplicated; the distillation's own skip makes a repeat harmless
  - one trace per experiment, not one per night ([[#Tracing]])
  - additions the twin gets later: [[#Follow-ups for both specs]]
- terms. Where the platform uses the same word for another thing, CodeClimb's word stays bare and the platform's gets a prefix:
  - a **variation** is one start or one continue of a night, with its own deadline, token and plateau counters and test evaluation
  - a **step** is a unit of the night's work whose result is saved once and reused on replay; LangGraph's `task()` implements it. A **task** is one item of the coder's plan (`/tmp/tasks.json`)
  - an **attempt** is one try of a step. The second experiment of a round is the **repair**. The server's own tries of a whole server run are server-run attempts
  - the **checkpoint** is the night's last kept commit. LangGraph's saved state is a **graph checkpoint**. A commit the coder makes in its sandbox while it works is a **savepoint**; the coder's prompts still call it a checkpoint ([[#Follow-ups for both specs]])
  - a **server run** is one run of a graph on the Agent Server, on a thread. A **trace run** is one node of a LangSmith trace
  - an experiment or an evaluation is a group of steps inside the night's server run, never a server run of its own
  - **resume** ends a pause. **Crash resume** is the Agent Server running again a server run that a crash cut off. **Session resume** is the coder carrying on its Pi session
  - a **soft stop** ends a night by its own rules and scores test. A **hard stop** ends it from outside and does not. A **credit stop** pauses it. Every hard stop goes through the **stop operation**
- scenario used for real nights: [[graphrag-spec|graphrag-spec]]. Background: [[autoresearch-coding-framework-fit|autoresearch-coding-framework-fit]], [[agent-observability-harness-support|agent-observability-harness-support]]

## Goal and done signal

Build the application so that a **night** works end to end: durable graphs, sandboxes, coding-agent sessions, commits, evaluations, the review, the test evaluation and the result files.

You are done when the end-to-end tests pass. They run on the Agent Server (`npm run server`, a fresh `langgraphjs up`) with Docker sandboxes and mock models, so they cost nothing beyond the LangSmith key the server needs to boot ([[#Mock mode]]). Seven nights, one after the other:

| # | night | what it proves |
|---|---|---|
| 1 | `npm run run-night -- --config configs/capitals-smoke.yaml --mock` | The program calls a model through the metering proxy |
| 2 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` | Two rounds: round 1 is kept, a noise run follows, the review hands its hypothesis to round 2; no metering. It ends on `max_rounds` after exactly 2 rounds: the iteration cap |
| 3 | `npm run run-night -- --config configs/e2e/plateau.yaml --mock` | The plateau cap: capitals keeps nothing, so with `plateau_rounds: 1` the night ends on `plateau` after round 1 |
| 4 | Night 2 again with `--no-wait`, then `npm run run-night -- stop --night <id>` while round 1 runs | A hard stop mid-round |
| 5 | Night 2 again with `--no-wait`; once round 2 has started, `docker kill` the server container (the stack's `langgraph-api` service; Postgres and Redis keep running), then `npm run server` again | Crash resume |
| 6 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` | A lost connection mid-turn: the coder's session carries on once model calls succeed again |
| 7 | `npm run build:image:graphrag`, then `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` | A scenario with three stages, a metered program, `check`, `scan` and lessons runs end to end |

Nights 1, 2 and 6 write to `runs-langchain/mock/<config-name>/`. For such a night `<id>`, all of these must hold:

| check | contract it depends on |
|---|---|
| `run-night` prints `done`, with `stop_reason` `max_rounds` or `thresholds` | [[#CLI]], [[#Stops]] |
| `nights/<id>/done.json` exists; `stop.json` and `pause.json` don't | [[#Files a night writes]] |
| `npm run validate-results -- runs-langchain/mock/<name>/results.jsonl` passes | [[#Result row]] |
| `results.jsonl` has a row per experiment of every round, plus a `test` row | [[#Round loop]] |
| `git -C runs-langchain/mock/<name>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit; its diff adds `MOCK.md` | [[#Mock mode]], [[#Experiment repository]] |
| `exps/*/code-state.json` has `stop: done`; `exps/*/session/` holds a session file | [[#Coder]] |
| `reviews/r<n>.json` exists for every round, with `feedback: mock feedback` | [[#Reviewer]] |
| `exps/*/train-score.json` and `exps/*/tasks.json` exist; the session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code") | [[#Send-backs, reserve and wrap-up]] |
| `bundle/history/notes/r<round>-e<n>.md` per experiment, with a `mock note` coder part and, where reviewed, a `mock verdict` reviewer part | [[#Notes, trajectory and rejected diffs]] |
| every experiment row has `decision_reason` | [[#Keep rule]] |
| `datenorm-smoke`: round 1's commit holds the starter's code, which scores above 0 on dev (accuracy 0.125), so it is kept; a `noise` row follows in round 2 and `noise.json` exists. `capitals-smoke` scores 0 and keeps nothing | [[#Noise margin]] |
| `done.json` has `spend_usd: 0` | [[#Mock mode]] |
| `capitals-smoke`: `evals/*/meter.jsonl` lists the program's calls, none with `error` | [[#Metering proxy]] |
| `docker ps` shows no `cc-<id>` container | [[#Cleanup]] |

Nights 3 to 7 add:

| night | check | contract it depends on |
|---|---|---|
| 3 | `run-night` prints `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; there is a `test` row; no `cc-<id>` container is left | [[#Stops]] |
| 4 | `run-night` prints `stopped`; `stop.json` has `reason: manual`; there is no `done.json` and no `test` row; no `cc-<id>` container is left | [[#Cleanup]] |
| 5 | Kill once `exps/<id>-r2-e0/` exists, so round 1's row is in `results.jsonl`. If the night finishes before that happens, nothing is killed: run night 5 again. Record round 1's `code-state.json` (sha256 and mtime) and follow `docker events` for container creates across the kill. The server picks the killed run up by itself, about 2 minutes after `up` (its runs sweeper), with no watchdog and no manual resume. Then the night finishes: `done.json` exists, every `eval_id` is in `results.jsonl` once, round 1's `code-state.json` is unchanged (so round 1's coder did not run again), and no `cc-<id>-r1-` sandbox is created after the kill (the night resumed from its last stored step instead of replaying round 1). Only the step running at the kill reruns, on a new sandbox of the same name | [[#Crash and resume]], [[#Platform facts]] |
| 6 | Every check of the table above; and `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one | [[#Mock mode]], [[#End of an experiment]] |
| 7 | It writes to `runs-langchain/mock/graphrag-smoke/`. The mock program's answers are canned, so a stage may fail and a round may end in `error` with a repair `e1`; these checks hold either way. `run-night` prints `done`; `done.json` exists and `stop.json` doesn't; `validate-results` passes; every round has an experiment row with `decision_reason`, plus one `test` row; every evaluation has `evals/<eval>/extraction/inputs.jsonl`; every experiment with a commit has `exps/<exp>/check.json`; where an evaluation succeeded, its scenario metric names start with `extraction.`, `graph.` or `retrieval.`, beside the metering metrics (`cost_*`, `latency_total_s`, `model_calls*`) every row carries; within a minute of `done`, `lessons/<id>-r<last round>/proposal.json` exists with `applied: false`, and the scenario's `lessons.md` is unchanged; no `cc-<id>` container is left | [[#Scenario contract]], [[#Evaluator]], [[#Repair]], [[#Lessons across nights]] |

Mock metrics mean nothing: a score of 0 is expected. The checks prove that everything ran. A coder or review failure falls back quietly in some paths, so the files above are the evidence, not `stop_reason` alone.

Also required, though these nights don't reach them: real-model nights, pause and resume, continue, seed, lessons, export, the worker API and the app. Build them to this spec. The paid end-to-end tests run on real models and spend money. Run one only when the operator says so for that scenario, and name its ceiling first. They write to `runs-langchain/<results folder>/`, with no `mock` in the path:

| # | night | ceiling | passes when |
|---|---|---|---|
| 8 | `npm run run-night -- --config configs/capitals-smoke.yaml` | $0.50 | `done`; a `test` row; `spend_usd` above 0 and at most 0.50; `meter.jsonl` shows real calls |
| 9 | `npm run run-night -- --config configs/datenorm-smoke.yaml` | $0.50 | `done`; at least one experiment row with `keep`; test accuracy above 0.125, the starter's dev score |
| 10 | `npm run run-night -- --config configs/e2e/budget.yaml` | $0.20 | the cost cap: `stop_reason` is `budget` within 3 rounds; `spend_usd` under 0.20. Mock models cost 0, so only real models reach this cap |
| 11 | `npm run build:scenario:overfit`, then `npm run run-night -- --config configs/e2e/overfit.yaml` | $0.50 | the loop climbs: `stop_reason` is `thresholds` within 4 rounds, and the `test` row's accuracy equals the kept commit's dev accuracy. The scenario is a generated copy of datenorm whose dev and test hold the 32 train items, so the coder can read every answer; its scores say nothing about the program |

Every paid night must also end with `done.json` and no `stop.json`, pass `validate-results`, and leave no `cc-<id>` container.

## What you get, what you build

Given, unchanged by you:

- `scenarios/<name>/`: `datenorm`, `datenorm-hard`, `capitals`, `graphrag`. Each holds its manifest, starter repo, agent spec, gold data, evaluators and scripts
- `configs/*.yaml`: `capitals-smoke`, `datenorm-smoke`, `datenorm`, `graphrag-smoke`, `graphrag`; and `configs/e2e/` (`plateau`, `budget`, `overfit`) for the end-to-end tests
- the scaffold: `package.json` (the LangGraph and LangSmith packages pinned; scripts `server`, `typecheck`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:scenario:overfit`), `langgraph.json` and `src/hello.ts` (a placeholder graph: replace both), `docker/` (the two Dockerfiles; the server's compose override joins them, [[#Deployment and environment]]), `tsconfig.json`, `.env.example`. `zod` is in `package.json` and not required by this spec: keep it or drop it. The Pi packages are not installed yet
- credentials: one `.env` (gitignored, from `.env.example`) holding the provider keys and `LANGSMITH_API_KEY` (a free Developer-plan key), which the Agent Server needs to boot and which also serves tracing and feedback; Pi's `auth.json`
- the LangChain skills, docs MCP and LangSmith MCP (the `langchain-plugins` marketplace), Pi's docs, and the end-to-end test instructions (`.claude/skills/codeclimb-e2e/SKILL.md`: the nights of [[#Goal and done signal]] as a procedure)
- comments in the pack that name files you don't have (a `docs/` page, a source path) are leftovers: this spec replaces them

You build everything else. Source layout is yours. These external contracts are fixed, because the tests and the operators use them:

- npm scripts: `server` (the Agent Server), `server:logs`, `server:stop`, `api` (the worker API and the watchdog), `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:dataset:hard`, `build:scenario:overfit` (given), `export`, `lessons`, `dev` (the app), `build:app` (the app's production build), `typecheck`, `test` (unit tests)
- graphs, in `langgraph.json`: `night`, `stop`, `lessons`
- Docker images:
  - `codeclimb-python` (every Python scenario): Python 3.14 slim, `git`, CA certificates, `uv` 0.13.5; system git identity `codeclimb` / `codeclimb@localhost`, default branch `main`, every directory safe; workdir `/repo`; `PYTHONDONTWRITEBYTECODE=1`, `UV_PYTHON_PREFERENCE=only-system`, `UV_PYTHON_DOWNLOADS=never`; command `sleep infinity`. It needs `bash`, `setsid`, `tar` and `python3`. Gold, evaluators and keys never enter an image
  - `codeclimb-graphrag`: `codeclimb-python` plus `scenarios/graphrag/requirements.txt` installed system-wide with `uv pip`; build context `scenarios/graphrag`
- host tools: Node 24, Docker, `git`, `tar`, `bash`, `python3`, `uv` on the operator's machine (the CLI, the API, export, the dataset and scenario builds, `lessons` by hand); the same tools plus a Docker CLI in the server image, where a night's host commands run (graphrag's through `uv`). "Host" in the scenario contract, the evaluator and the coder means the Agent Server's side of a sandbox: the server container ([[#Deployment and environment]])
- everything in [[#CLI]], [[#Files a night writes]], [[#Result row]], [[#Worker API]] and [[#Deployment and environment]]

Dependencies, pinned to exact versions. These are the versions this spec's SDK facts hold for:

| package | version | note |
|---|---|---|
| `@earendil-works/pi-coding-agent` | 1.3.0 | The Pi SDK |
| `@earendil-works/pi-ai` | 1.3.0 | The version the SDK itself depends on, so one copy installs. Source of the scripted (faux) provider. Two copies break mock mode |
| `pi-web-access` | 0.47.0 | Web research. Its extension is the default export of the package's built entry file; it ships no types |
| `@langchain/langgraph` | 1.7.3 | The functional API: `entrypoint`, `task`, `interrupt`, `Command` |
| `@langchain/core` | 1.3.7 | Peer dependency of LangGraph |
| `@langchain/langgraph-cli` | 1.7.1 | `langgraphjs up`: builds the server image and starts the stack |
| `@langchain/langgraph-sdk` | 1.15.0 | The client the CLI, the API and the graphs use to reach the Agent Server |
| `langsmith` | 0.12.0 | The client for feedback; `langsmith/run_trees` for the tracer |
| `@opentelemetry/api` | 1.10.0 | Used directly for spans |
| `next`, `react`, `react-dom` | 16.4.2, 19.3.1, 19.3.1 | The app only |
| `yaml`, `tsx`, `typescript` | 2.9.1, 4.23.15, 6.0.3 | |
| `@types/node`, `@types/react`, `@types/react-dom` | 24.19.2, 19.3.0, 19.3.0 | Types only |
| `zod` | 4.6.7 | Kept from the scaffold; the code does not use it |

- `server` runs `langgraphjs up` with the compose override, sets `CODECLIMB_HOST_ROOT` to the checkout, and waits until the server answers `/ok`. The server listens on `127.0.0.1:8123` ([[#Deployment and environment]])
- `run-night` and `api` reach `http://127.0.0.1:8123` (`CODECLIMB_SERVER_URL`)
- install with lifecycle scripts off, on the operator's machine and in the image (`NPM_CONFIG_IGNORE_SCRIPTS=true` for the image's `npm ci`)

## Components

| component | job | runs on |
|---|---|---|
| CLI (`run-night`) | parse and validate the config, check models, start / stop / resume / continue through the Agent Server's API, follow `results.jsonl` | your machine |
| Agent Server | durable runtime and worker: runs the graphs (saved steps, interrupts, cancel, a run queue) and, inside them, Pi sessions (coder, reviewer, lessons), the scenario's host commands and the metering proxy. Its graphs share one long-running Node process in the server container; its state is in Postgres, its queue in Redis | your machine: three containers started by `langgraphjs up` (`server`) |
| worker API + watchdog | read nights, stop, resume, continue, export; recover nights a crash left behind. A client of the Agent Server, like the CLI | your machine, its own process |
| sandboxes | the coder's shell and files; the program under evaluation | Docker |
| metering proxy | the only path from a program to a model; holds the keys, meters every call, replays repeated calls | Agent Server process, `/v1` on a fixed port in the server container |
| app | the worker API's client; it never runs Pi or sandboxes | Next.js on `127.0.0.1` |
| experiment store | `experiments.git` + `results.jsonl` + `nights/<id>/`, the source of truth. No database of CodeClimb's own: the Agent Server's Postgres holds only threads, server runs and graph checkpoints | your machine's disk, the checkout mounted into the server container |

Data flow of one round:

1. the night's server run holds the night config and the loop. Each round starts with the smoke test and, on the first scored checkpoint, the A/A noise run
2. the experiment's coder: a sandbox holding the checkpoint and `/spec`, driven by Pi in the Agent Server process. Its result is one commit, moved as a git bundle into `experiments.git`. Then, on the host, the repo check and the diff leak scan
3. the evaluation: per stage, inputs (host) → run (sandbox) → score (host) → metrics
4. keep rule: the weighted score against the checkpoint's plus the noise margin → keep or revert. A commit that failed before scoring gets one repair attempt, then the decision again
5. reviewer (Pi in the Agent Server process): feedback, the next hypothesis, a verdict
6. writes: the row in `results.jsonl`, the note, the history line, a rejected diff. The next round starts from the checkpoint
7. after any soft stop: the test evaluation of the checkpoint → `done.json` → lessons distillation

Isolation invariants. Every design choice below protects them:

- gold, evaluators and provider keys never enter a sandbox (one accepted exception: [[#Splits]])
- only train reaches a coder; the coder never sees eval inputs, outputs or reports
- the reviewer reads dev, per-item errors included; nothing from test reaches a coder, the reviewer or a lesson
- everything a coder reads that came from the evaluation side is scanned for held-out names first
- every decision reads `metrics` from evaluations; the agents' own claims decide nothing

## Scenario contract

CodeClimb never reads a scenario's data. It only runs the commands in `scenario.yaml`. Scenarios share no code with CodeClimb and may use any language (all current ones are Python).

### How a scenario is loaded

- the night config's `scenario` names a directory. The CLI parses its `scenario.yaml` once, validates it, and embeds the parsed scenario in the config that travels in the start input (the night's server run input)
- load fails if `scenario.yaml` or `starter/` is missing, or `lessons` names a missing file. Nothing else is checked: `spec/evaluator/`, `corpus/` and `protocol` are optional, and datenorm and capitals have none
- directory: `scenario.yaml`, `starter/` (the round-0 repo), `spec/agent/` (the coder's spec), `spec/evaluator/` (reviewer protocol), `gold/` (with `splits.json`), `evaluators/`, `scripts/`, optional `corpus/`

`scenario.yaml`:

| field | meaning |
|---|---|
| `name`, `image` | Scenario name; Docker image for coders and evaluators |
| `bundle` | Host: writes the coder's bundle to `{out}`; must contain `spec/`. Fails the night if its own leak check fails |
| `stages[]` | At least one; unique names matching `^[a-z][a-z0-9_-]*$`; run in order |
| `headline` (opt) | Metric names each round reports and logs. They decide nothing: the config's `thresholds` do |
| `diagnostics` (opt) | Regexes of metrics the reviewer reads to explain the headlines. A bad regex fails at load |
| `protocol` (opt) | Files the reviewer reads as its protocol; `path#Heading` = that one `## Heading` section |
| `check` (opt) | Host: reads the commit's files in `{repo}` (a temporary checkout), writes a JSON object to `{report}` with two lists of strings, `errors` and `notes`. Errors block evaluation; notes go to the reviewer. Saved as `exps/<exp>/check.json` (`errors`, `notes`, `held_out_names`: the count of distinct held-out names the leak scan found, and `failed` when the command itself failed), written when the scenario has `check` or `scan` |
| `scan` (opt) | Host: reads the file `{text}`, writes a JSON object to `{report}` with one list, `found`: the held-out names in the text, as the text has them. Without `scan`, or for empty text, nothing is found |
| `lessons` (opt) | Path of the `lessons.md` inside the agent spec: the memory across nights ([[#Lessons across nights]]) |

A stage:

| field | where | job |
|---|---|---|
| `inputs` | host | Writes the `{split}` input to `{inputs}`, answers removed |
| `files` | host → sandbox | Sandbox absolute path → scenario-relative host path, uploaded before `run`; a directory goes whole |
| `run` | sandbox, cwd `/repo` | Runs the program on `{inputs}`, writes under `{out}`, optionally `timings.jsonl` |
| `score` | host | Scores the downloaded `{out}` on `{split}`, writes the JSON report `{report}` |
| `details` (opt) | host | `score` with per-item errors under the report's `details`. Used on dev, never on test |

- placeholders are shell-quoted; an unknown one is an error. Every host-side placeholder value is an absolute path, since the command runs in the scenario directory
- masking: every found name is replaced by `[hidden]`, in any letter case, the longest name first
- host commands run through `bash -c` in the scenario directory, 30-minute timeout, 64 MiB of output; a failure throws with the last 2,000 characters of output, cut at a line start (a half line could hide half a held-out name from a scan)

### Splits

- every scenario has fixed train / dev / test in `gold/splits.json`. CodeClimb never opens it
- CodeClimb passes `{split}` to the stage commands: `dev` every round, `test` once per variation after the night stops. It never passes `train`
- train reaches a coder only through the bundle the scenario's `bundle` command writes. The bundle becomes `/spec` in every coder sandbox. Evaluator sandboxes get no bundle
- a `train/` directory in the bundle switches on the coder's train-measurement duty ([[#Send-backs, reserve and wrap-up]])
- few-shot examples may come from train only; a scenario enforces that in its `check`
- why fixed splits, not folds: graphrag's later documents reuse earlier canonical names, so time-ordered folds hand earlier folds their answer key
- the **scoring hashes** say what scores a night: a map from file path (relative to the checkout) to sha256, over `scenario.yaml` and every file under `evaluators/` and `gold/` (`__pycache__` skipped). Stored in `night.json` as `metric_script_sha256` and compared file by file. Any difference means old scores can't be compared: [[#Continue, seed and rescore]]
- accepted risk: graphrag's retrieval stage uploads the full gold graph (test included) into the eval sandbox, which has open egress. It never reaches a coder or the reviewer

### Stage reports become metrics

- a report's numbers are flattened: nested keys joined with `.`; lists, non-numbers, `per_item` and `details` skipped; a `ci95: [lo, hi]` becomes `ci95_half` = `(hi − lo) / 2`
- with more than one stage, every key gets `<stage>.` in front (`extraction.mentions.f1`)
- each stage adds `output_bytes` (`<stage>.output_bytes`): bytes its run wrote, the timings file aside
- [[#Standard metrics]] are added last and win over a scorer's metric of the same name

## Night config

One night optimizes the whole system: every stage, every round.

| field | default | meaning |
|---|---|---|
| `scenario` | required | Scenario directory |
| `sandbox` | required | `docker`. Any other value (an Inngest config's `inngest`) is read as `docker`, with a printed note |
| `max_rounds` | required | ≥ 1 |
| `max_tokens` | none | Cap on coder + reviewer tokens; a positive integer |
| `plateau_rounds` | 3 | Stop after that many rounds in a row kept nothing; 0 = never |
| `deadline` | required | ISO time, or a duration from night start: `90m`, `8h`, `30s` |
| `timeouts.experiment_min`, `.eval_min` | required | `eval_min` applies to each stage's run |
| `model`, `reviewer_model` | required | `<provider>/<id>` through Pi |
| `coder_thinking`, `reviewer_thinking` | `medium`, `low` | `off`, `minimal`, `low`, `medium`, `high` |
| `allowed_models` | `[]` | Models the program may call. Empty = unmetered: no proxy token |
| `primary_metric` | required | Names the score in charts, the CLI and `done.json`. An evaluation counts only if it reports this metric. It decides nothing |
| `thresholds` | required, ≥ 1 | Metric → target, each > 0, higher is better. They stop the night, and their weighted score decides every keep |
| `weights` | 1 each | Metric → weight > 0 in the weighted score; only threshold metrics |
| `gates` | `{}` | Metric → cap. A missing metric fails its gate |
| `standard_metrics` | `latency`, `cost`: true; `latency_metric`: `latency_total_s`; `cost_metric`: `cost_per_item_usd`; `min_efficiency_gain`: 0.10 | Which standard metrics are named to the agents. Lower is better. Never part of the keep. `min_efficiency_gain` in (0, 1) |
| `budget_usd.experiment` | required | Caps one experiment: `coder_usd + dev_usd` |
| `budget_usd.night` | required | Caps the whole night: every experiment, review and evaluation |
| `noise_margin` | `min` 0.002, `max` 0.005, `fixed` none, `scale_by_replay` true | [[#Noise margin]] |
| `lessons` | `apply` if the scenario declares lessons, else `off` | `off`, `propose`, `apply`. Not `off` without scenario lessons is an error |
| `seed` | none | A night id, `latest` or `best`: start from an ended night's kept commit |
| `results_path` | required | Its directory holds everything nights of this config write |

Validation at parse:

- the reviewer must differ from the coder: an error if `reviewer_model` equals `model` and `reviewer_thinking` is unset or equals `coder_thinking`. Compared as strings, so one model under two providers passes
- `deadline` must parse; `standard_metrics.latency_metric` starts with `latency_`, `cost_metric` with `cost_`; `noise_margin.min` must not exceed `max`
- relative paths in a config (`scenario`, `results_path`) resolve against the directory `run-night` is started in, not the yaml's folder
- the config travels in the start input with paths relative to the checkout; the Agent Server resolves them against `CODECLIMB_ROOT` (default: its cwd; in the server container the compose override sets it to the checkout's host path, where the checkout is mounted). CLI and server may run from different directories, as long as both resolve the same results directory: following, continue and seed read it from the CLI's side
- results directories must sit directly under `<root>/runs-langchain/` (or `<root>/runs-langchain/mock/` for mock nights): the API and the stop cleanup find a night by scanning there. Not `runs/`: the Inngest twin writes its nights there, from the same checkout, and a folder of its own keeps either build from finding, stopping or continuing the other's nights
- models are checked on the CLI and again in the Agent Server with its own credentials (a non-retriable failure of the night's first step). For a Pi model: it is in Pi's model runtime, its provider has credentials, and it is in the provider's list of models available to the account. The check finds missing models and keys, not wrong keys. `openrouter/` entries of `allowed_models` are checked through OpenRouter's per-model endpoints API instead (ready only when it lists at least one endpoint), because its model list omits some callable models; the priced embedding models are left out of the Pi check too

## CLI

`run-night` loads the env files first ([[#Deployment and environment]]).

| command | does |
|---|---|
| `run-night --config <yaml> [--night-id ID] [--sandbox docker] [--seed ID\|latest\|best] [--rounds N] [--no-wait] [--mock [--mock-offline N]]` | Starts a night and follows it |
| `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N] [--no-wait]` | More rounds on an ended night; default: the newest ended night under the config's results |
| `run-night stop --night ID` | Hard stop |
| `run-night resume --night ID [--no-wait]` | Ends a pause for credits, then follows the night |

- night id: `--night-id`, else `n<YYYYMMDD>-<HHMMSS>` from local time. A valid id is 1 to 48 letters, digits or hyphens, not starting with a hyphen
- `--rounds` on a new night replaces `max_rounds`. `--no-wait` starts the night and exits without following
- a night id whose folder exists under the results directory but which has no thread is refused: it was used before, pick another
- starting a night id that already has a thread starts nothing: the CLI prints a note and follows the night that is running, as the twin's deduplicated start does ([[#Durable runtime on LangGraph]])
- following: every 5 s print new rows of the night (round, kind, split, short experiment id, primary metric, decision, spend, hypothesis); print `done` with `done.json` and exit when it appears; print `stopped` with `stop.json`; print where a pause stopped and how to resume. Ctrl-C detaches; the night keeps running
- `--direction` only with `continue`; `--seed` never with `continue`
- `continue` and `lessons` tell a mock night by its folder: a night under `runs-langchain/mock/` is continued, or distilled, as a mock
- `resume` is refused for a night that has a `stop.json` or a `done.json`, that is not paused, or whose pause was resumed already
- a usage or validation error exits 2

### Mock mode

`--mock` runs the same night on scripted models: the Agent Server, sandboxes, Pi sessions and tools, commits, evals, the proxy, the keep rule and every file are real. No provider is called, so it costs nothing and needs no provider credentials. The Agent Server still needs `LANGSMITH_API_KEY` to boot: without it the server container exits with code 3 ([[#Platform facts]]), so mock nights and CI need a key, from the region `LANGSMITH_ENDPOINT` names. With `LANGSMITH_TRACING=false` nothing is traced; the server still checks the key at boot, and with tracing on it was seen running a metadata loop that submits to LangSmith (not checked with tracing off).

- results go to `runs-langchain/mock/<name>/`: the results directory's name moved under a `mock` sibling (`runs-langchain/datenorm-smoke/…` → `runs-langchain/mock/datenorm-smoke/…`)
- models: pi-ai's faux provider, registered as a native provider on the Agent Server process's one Pi model runtime, with provider id `mock` and one model per role: `coder`, `reviewer`, `lessons`. A mock session takes its model object from the faux provider, not from a `<provider>/<id>` lookup. Faux models cost 0
- the faux provider's response queue is shared by every session and gives up one entry per model call; an empty queue answers with an error. So queue a response factory that puts itself back on every call, with a head start of several entries for concurrent sessions; never a fixed list. The factory picks its reply by the model's id:

| role | scripted reply |
|---|---|
| coder | When the last message is a tool result: the closing text `APPROACH: mock change, no real work`. Otherwise one `bash` tool call, with stop reason tool use. Its command appends a timestamped line to `MOCK.md` (so every turn changes the tree), and writes `/tmp/tasks.json` (one task with status `done`), `/tmp/notes.md` (the text `mock note`) and `/tmp/train-score.json` (`before` and `after`, each holding one numeric metric, plus `command`). Every prompt is answered this way, send-backs and resumes included |
| reviewer | A JSON object: `feedback` = `mock feedback`, `hypothesis` = `mock hypothesis`, `verdict` = `mock verdict` |
| lessons | A JSON object with an empty `ops` list |
- program calls get canned answers at zero cost: chat `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0
- skipped: the model checks, the round-start smoke test, web research (it would reach the real web); lessons are never applied
- `--mock-offline N` (only with `--mock`) imitates a lost connection. The coder's model calls number 2 to N+1 of the night's first experiment are answered as failed calls: an assistant message with stop reason `error` and the error text `fetch failed`. Every other call is answered as above. The number travels in the start input
- `mock_credit` (only with `mock`, a start-input field for tests, with no CLI flag) imitates running out of credits: `{ who, call }` answers call number `call` of the night for `who` (`coder`, `reviewer` or `program`) as a credit error, `402 Payment Required: insufficient credits`, once. A coder or reviewer call gets an assistant message with stop reason `error` and that text; a program call is answered as a provider's 402 is: a failed upstream call (502 to the program) and a credit stop. Every later call is answered as above, so a resume carries on

## Experiment lifecycle

A night is a linear loop: one experiment per round, on one coder model, from the **checkpoint** (the last kept commit, with the dev metrics of its own evaluation). A reverted experiment is dropped and the next round restarts from the same checkpoint, carrying what was learned. Why linear: parallel branches burned too many tokens.

### Ids

| thing | id |
|---|---|
| starter / seed commit | `<night>-r0-starter` / `<night>-r0-seed` |
| experiment | `<night>-r<N>-e0`; its repair `<night>-r<N>-e1` |
| dev evaluation | `<exp>-eval` |
| noise run | `<exp>-noise-r<N>` (N = the round it ran in) |
| test evaluation | `<night>-test-r<N>` (N = the last round) |
| sandbox | `cc-<exp id>` for a coder; `cc-<night>-r<N>-eval`, `-eval1` (repair), `-noise`, `-rescore`, `cc-<night>-test-r<N>` for evaluators |

Every sandbox name starts with `cc-<night>`, so a prefix sweep cleans a night.

Work that reruns after a pause gets a new identity ending `-resume<n>`: new step calls, named with it. An experiment keeps its id and sandbox name; a rerun evaluation keeps its `eval_id` but runs on a new sandbox, `cc-<night>-r<N>-eval-resume<n>`.

### Init

- build the bundle with the scenario's `bundle` command into `nights/<id>/bundle/`. The command refuses a non-empty target, and a retried init or a continue finds one. So: move an existing `history/` aside, delete the bundle folder, run the command, fail if it wrote no `spec/`, move `history/` back
- import `starter/` into `experiments.git` as `<night>-r0-starter`, or alias the seed's commit as `<night>-r0-seed`
- compute the deadline; write `night.json`
- the starter is never run: it has no metrics and a weighted score of 0

### Round loop

Each round, in order:

1. **Stop check** ([[#Stops]]). Soft: between rounds only. Before it, a `stop.json` on disk ends the server run quietly: a hard stop is already cleaning up ([[#Cleanup]])
2. **Smoke test.** Before money goes into the round: the same model check as at night start (each model exists, has credentials and is on the account's plan; no paid call) and, for a metered night, the proxy's URL reaches the proxy. A failure is retried every 5 minutes, 6 more times; then the night stops with `outage`. Why: an outage would spend the coder's budget on a round that can't be scored
3. **Noise run**, when due ([[#Noise margin]])
4. **Code.** The experiment's coder on a fresh sandbox from the checkpoint ([[#Coder]]). It commits `/repo` as one commit
5. **Check and leak scan** (in the experiment, on the host). The scenario's `check` on the commit; then `scan` on the lines the commit adds. Both skipped with no commit, on a credit stop, or when the commit's files equal the checkpoint's. A `check` command that itself fails blocks the evaluation as its errors do
6. **Evaluate on dev** in an evaluation ([[#Evaluator]]). Skipped with no commit, with `check` errors, or with unchanged files. The checkpoint is not run again: its stored dev metrics are the reference
7. **Decide** ([[#Keep rule]])
8. **Repair**, at most one per round ([[#Repair]])
9. **Review** ([[#Reviewer]]). Always, also of a reverted experiment and in the last round: its feedback is what the next round, or a continued night, learns. A failed review keeps the last feedback and hypothesis and leaves the verdict empty; it never kills the night
10. **Record.** Append the row, with the review's cost and time
11. **Learn**, in this order (the order is part of what a replay must repeat):
    - write the experiment's note
    - save the rejected diff, if the round kept nothing and changed code
    - add the masked history line
    - set the next round's feedback, masked failures and hypothesis
    - add the round's spend and tokens; reset or raise the count of rounds without a keep; remember the costliest round and evaluation
12. **Keep.** A kept experiment becomes the checkpoint
13. **Thresholds.** If every threshold metric of the checkpoint is present and ≥ its target, stop with `thresholds`

After any soft stop: score the checkpoint on test, on its own evaluator, for the report only. Then finish: the test row, a final sweep of the night's sandboxes, `done.json`, and the lessons run. Test never drives a decision. A hard-stopped night has no test score.

The hypothesis a round tests: round 1 has none, so the coder picks its own and reports it in its `APPROACH` line; later rounds get the reviewer's.

### Stops

Soft stops. The first five are checked in this order at the start of a round, and the first wins. `outage` comes from the smoke test right after them; `thresholds` is checked at the end of each round. `stop_reason` in `done.json`:

| `stop_reason` | when |
|---|---|
| `max_rounds` | the next round's number would pass `max_rounds` |
| `deadline` | now ≥ deadline (moved forward by pauses) |
| `budget` | spend + the costliest round so far + the costliest single evaluation so far (the test eval's estimate) > `budget_usd.night` |
| `tokens` | tokens + the costliest round's tokens so far > `max_tokens` |
| `plateau` | `plateau_rounds` rounds in a row kept nothing |
| `outage` | the round-start smoke test failed 7 times |
| `thresholds` | checked after each round, on the checkpoint |

Spend: a row's spend is `coder_usd + dev_usd + program_usd`. A round's spend is its rows plus one review. The night's spend adds the noise, rescore and test evaluations' program calls.

Hard stops: the stop operation (CLI, app), a night that fails out of retries, a cancel of the night's server run from outside CodeClimb (Studio, the API by hand), the pause timeout, and the 4-day backstop of a variation. All go through one path ([[#Cleanup]]).

### Repair

A commit that failed before it was scored says nothing about its idea.

- repairable: it has a commit, changed files, and either `check` errors or a failed evaluation that was not a credit stop
- allowed only if a stop check passes with the failed attempt's spend and tokens added
- the failed attempt keeps its row (`error`), its cost and its own note
- attempt `e1` starts from the failed commit, with the masked errors, the same hypothesis, and a prompt that says: fix this failure and nothing else; there is no second repair. No research, no plan, no send-backs
- `e1` is decided against the same checkpoint and stands for the round. The decision, the review's diff and the rejected diff all compare `e1` with the checkpoint
- repairable means the evaluation returned `ok: false`. An evaluator run that failed out of its retries is an `error` with no repair, and so is a `check` command that itself failed
- the failed attempt's row (with `reviewer_usd` 0) and its note are written before `e1` starts
- `unchanged` compares a commit with the commit its sandbox started from: the checkpoint, or `e0` for a repair. An `e1` equal to `e0` is recorded as `revert`, `unchanged: true`, with the checkpoint's metrics, and its diff against the checkpoint is still saved as the rejected diff
- the leak scan of a repair covers the lines `e1` adds over `e0`

### Pause for credits

Problem: a program that gets 402 on every call scores as a low F1, and the keep rule and the reviewer would act on it. So running out of credits pauses the night instead of failing it.

- detected: on a program call, HTTP 402 from OpenRouter or a credit message; on a coder or reviewer turn, a credit or quota message from Pi. The message test covers: 402, payment required, insufficient credits / quota / funds / balance, credit balance, out of credits / budget, quota exceeded / exhausted, usage limit reached, key limit exceeded, billing. A 429 rate limit is not a credit error: Pi and the program retry it
- Pi does not throw on a failed model call: it reports an assistant message with stop reason `error` and an error text. Test every assistant message end against the credit pattern, and the thrown error too. A handler around the prompt call alone never sees a credit error
- reported as a credit stop: `who` (coder, reviewer, program), `model`, `message`
- a coder commits its partial work and returns the stop; an evaluation ends the stage at the first credit call and reports no score; a review just stops
- only the night waits, in an interrupt of its server run, with no sandbox running and no step in flight. An experiment or an evaluation never interrupts: it returns the stop, so the interrupt sits in the night's own code between steps, where a resume replays it cleanly; with the sandbox gone, nothing bills
- resume: a resume command from the CLI or the app. Finished work stays; only what stopped reruns: the coder from its commit in the same Pi session on a new sandbox, the evaluation from scratch, the review again. The resumed coder's sandbox is created from a git bundle holding both the paused commit and the round's parent, so the final commit still squashes onto the parent. It gets the same short restart prompt as after a crash; its send-back count and wrap-up flag start again; its clock is set to now minus the coding time so far, once: when the state file shows a paused session, not on a later rerun of the step. Still out of credits → it pauses again at the same place
- paused time doesn't count against the deadline or `experiment_min`
- a pause lasts 3 days, then a timer stops the night with reason `failed` ([[#Durable runtime on LangGraph]]). Stop works while paused
- files: `pause.json` while paused (`pause`, its number; `at`, `round`, `stops[]` each with `where`), `pauses.jsonl` as a log with `resumed_at` and `paused_ms`. Pause numbers run on across a night's variations, so none repeats within a night. `where` is free text naming the step: the experiment, the evaluation, or the review of round N. One pause holds one stop
- ending a pause: log it to `pauses.jsonl`, delete `pause.json`, and add the paused time to `deadlineMs` in `night.json` and to the loop's deadline. This step must be safe to retry: the log holds one entry per pause, and `night.json` records the last pause whose time was added (`pausesApplied`). A night that was stopped while paused stays stopped: the step adds nothing and the night ends its server run quietly
- every evaluation pauses the same way: dev, noise, rescore and test. A rerun keeps its `eval_id`, so it does not replay the calls its paused attempt made

### Continue, seed and rescore

Continue: more rounds on an ended night, under the same id.

- allowed only for a night that ended (`done.json` or `stop.json`) and ran the same scenario
- reopening happens before the continued night's server run is created, by whoever creates it (the CLI for `run-night continue`, the worker API for the app), never in a step of the night. In order: check the night ended and ran this scenario; move the files of rounds past the last recorded round aside; rename the end file; work out the rescore flag, `max_rounds` and the budget; rewrite `night.json` with the new deadline, config and scoring hashes (`startedAt` stays). From then on the night reads as running, so a second continue is refused and the follower never sees the old `done.json`. Done inside the night instead, `run-night continue` would print `done` at its first poll and exit
- the first step of the continued variation only rebuilds the bundle and the state below
- rounds number on from the last recorded round, from the kept commit, with the last review's feedback and hypothesis, the history lines rebuilt from the rows, the notes and the rejected diffs
- `--rounds` adds to the rounds so far (default: the config's `max_rounds`). The deadline restarts from now. The bundle is rebuilt from the scenario as it stands
- budget: `night.json` keeps `run_budget_usd`, the config's `budget_usd.night` as it was at the first continuation. Every continuation sets the night budget to what the night has spent plus `run_budget_usd`, never plus the budget in the saved config, which would compound
- config: the CLI's continue uses the yaml it is given; the API's uses the night's saved config with `scenario.yaml` loaded again from disk
- a direction goes to every new coder and reviewer, masked with `scan`, and replaces the hypothesis the night had reached
- the old `done.json` / `stop.json` is renamed `done-r<last>.json` / `stop-r<last>.json`. Files of rounds past the last recorded round (a night that failed mid-round) move to `unfinished/after-r<last>-<time>/`, so that round reruns from scratch
- each variation ends with its own test eval: test is scored once per variation

Where a continued variation's state comes from:

| state | source |
|---|---|
| checkpoint | The night's last `experiment` row with `keep` (a rescore row counts); else its round-0 commit, with the seed's metrics if the night was seeded. Never `done.json`: a stopped night has none |
| last round | The highest round among its `experiment` rows |
| spend | Over all its rows: coder + dev + program spend, plus each round's review once |
| feedback, hypothesis | The review file of the latest round that has one |
| history | One masked line per round from the `experiment` rows; in a repaired round the last row stands. Changes are against the checkpoint of that time, starting from the seed's metrics |
| noise | `noise.json` as it is, unless this variation rescores |
| tokens, rounds without a keep, costliest round and evaluation, A/A count | Start at zero: `max_tokens` and `plateau_rounds` apply per variation |
| pause count | The highest pause number in `pauses.jsonl` and `pause.json` |
| `rounds` in the new `done.json` | The night's last round number, a rescore round included |

Seed: a new night that starts from an ended night's kept commit instead of the starter.

- `latest` = the newest ended night; `best` = the highest weighted dev score among ended nights of this scenario whose scoring hashes equal the current ones (a tie goes to the newer). Test scores never count. The CLI resolves both to an id before the night starts
- the new night gets its own id, budget and trajectory. Only the code and the dev metrics it was kept on carry over: round 1 must beat them. The seed night's measured noise carries over when the evaluation hasn't changed
- refused if the seed night kept nothing, or if it applies lessons that are not in `lessons.md` yet
- coders and reviewers read a `<start>` note naming the night it came from
- seeds are searched among the nights under the config's own results directory, so the commit is already in `experiments.git`. Newest means the latest `startedAt`
- `night.json`'s `seed` holds the seed night, its kept experiment, its last round, the primary value, the metrics and the rescore flag. The `<start>` note and a later continue read it. A seeded night that kept nothing still has its seed as checkpoint
- the lessons refusal applies when the seed night ran with `lessons: apply`, was not a mock, its scenario declares lessons, and it has rounds with notes or reviews past its newest applied proposal

Rescore: when the scoring hashes changed since the kept commit (continued or seeded) was scored.

- one extra round first: the kept commit gets a new name `<night>-r<N>-e0`, is evaluated on dev, and its row is recorded as `keep` with the new metrics (the old ones if that evaluation failed)
- the round counts toward `max_rounds`, so the CLI and continue add 1
- the noise is measured again afterwards
- the rescore runs before the round loop, with no stop check, smoke test, coder, review, note or history line. Its row has `kind: experiment`, `eval_id` `<night>-r<N>-e0-eval`, null `parent_id` and `model`, and `decision: keep` even when the evaluation failed, so a later continuation finds the commit
- a continued night gets the rescore flag in its start input. A seeded night works it out itself in init, by comparing the seed night's scoring hashes with the current ones; the CLI only adds the round

## Decision and calibration

All of it is pure functions over dev metrics.

### Weighted score

- a threshold metric's share = `min(max(value, 0) / threshold, 1)`; a missing metric's share is 0
- weighted score = sum of `weight × share` over the threshold metrics, divided by the sum of weights
- a metric past its threshold adds nothing more; a loss in one metric costs as much as a gain in another earns
- the starter scores 0

Two different things are called "score". The weighted score decides (row field `score`). The checkpoint's primary-metric value is for display (`done.json`'s `kept.dev_score`, the CLI, charts).

### Keep rule

An experiment is kept only when all hold:

1. it has a commit and its dev evaluation succeeded (the primary metric is a number)
2. its files differ from the checkpoint's
3. no guardrail fired:
   - a gate failed (metric missing or above its cap)
   - a stage wrote no output (`output_bytes` = 0). A backstop that dev does not reach: on dev the evaluator stops at an empty stage first, which makes it a failed evaluation (`error`, repairable)
   - the diff's added lines name 2 or more held-out items (1 is only a note to the reviewer)
4. its weighted score > the checkpoint's weighted score + the noise margin (compared with an epsilon of 1e-12)

Outcomes:

| case | `decision` | row metrics | `decision_reason` |
|---|---|---|---|
| the experiment's coder failed outright | `error` | primary = 0 | `the experiment failed` |
| unchanged files | `revert`, `unchanged: true` | the checkpoint's | `no code change` |
| `check` errors or failed evaluation | `error` | primary = 0 | `not scored` |
| guardrail | `revert` | its own | `blocked: <guardrails>` |
| scored | `keep` or `revert` | its own | `weighted score S > / <= checkpoint P + noise margin M (f of n model calls fresh, A/A B)` |

- in the scored reason, each part appears only when it applies: the margin clause when the margin is above 0, the fresh-calls clause when the evaluation made model calls and replay scaling is on, the A/A value when the base is above 0. Scores print with 4 decimals
- the reviewer never decides. Cost and latency are measured and reported, never scored
- every experiment row carries `decision_reason`; scored and unchanged rows carry `score`

### Noise margin

Problem: a program that calls models scores differently on every run, so a small gain may be luck. Example from one night: the same commit scored twice moved mention F1 +0.018 and relation F1 −0.008.

A/A run:

- when: at the start of the first round whose checkpoint has metrics while the night has no noise yet, unless `noise_margin.fixed` is set. A seeded night starts with its seed's noise and a continued night with its own `noise.json`, so neither runs one, unless it rescores
- what: the checkpoint evaluated on dev once more with no replayed model calls. Its row has `kind: noise`
- the measured move = the sum over threshold metrics of `weight × |share₁ − share₂|`, divided by the sum of weights. Each metric's move counts, so two metrics that move apart add up instead of cancelling
- stored in `noise.json`: `margin` (the move), `expId`, `first` and `second` (the two weighted scores), `moves` (each threshold metric's two values). The review reads the pair
- a failed A/A run is tried again next round. A move above `max` is likely one bad run: it is measured again on the next kept checkpoint. At most 2 A/A runs per night

Margin an experiment must beat:

- base = `fixed`, else the A/A move, else 0
- fresh share `f` = (`model_calls` − `model_calls_replayed`) / `model_calls`, when `scale_by_replay` is on and the experiment made calls; else 1. Why: an experiment replays the checkpoint's answers for every unchanged call, so only its fresh calls add noise; variance scales with `f`, the margin with `√f`
- margin = `clamp(base × √f, min, max)`
- example: an A/A move of 0.022 with 9 of 83 calls fresh gives 0.022 × √(9/83) = 0.0072, capped to 0.005
- `min` (0.002) applies before any A/A run and when it failed; with the starter as checkpoint, the first experiment needs a weighted score above 0.002
- why `max` (0.005): one pair is one sample. One night's pair hit an empty document, measured 0.058, and reverted a round that beat the checkpoint by 0.010 on both F1s

## Coder

Pi (`@earendil-works/pi-coding-agent`, TypeScript SDK) runs in the Agent Server, never in a sandbox, so credentials stay out of sandboxes. Its tools act inside the sandbox.

- providers: any Pi provider as `<provider>/<id>`. Credentials: env keys, or `auth.json` from Pi's `/login` (`~/.pi/agent/auth.json`, or `CODECLIMB_PI_AUTH_PATH`; in the server container the operator's `auth.json` is mounted and `CODECLIMB_PI_AUTH_PATH` points at it). Cost is Pi's catalog price per message: real spend for API keys, an estimate for subscriptions
- isolation: an empty agent directory; no AGENTS.md, skills, prompt templates, extensions or themes from the host; in-memory settings with compaction on and 4 retries; working directory `/repo`. Only Pi's base prompt plus the user prompt reaches the model
- sandbox tools: exactly `read`, `write`, `edit`, `bash`, with Pi's own definitions and their operations routed to the sandbox interface. `grep`, `find`, `ls` stay off. The host environment is never forwarded to the shell; only the meter variables are. A bash command with no timeout of its own gets 10 minutes
- web research, on the host, through `pi-web-access`: `web_search`, `fetch_content`, `get_search_content` ([[#Web research guard]])
- session storage: a session file per experiment under `exps/<exp>/session/`, so a crashed attempt can reopen it

### Pi facts found while building

Found while building the Inngest twin; the same Pi version holds them here. Like platform facts, these cost time to find; they are not design choices.

| need | Pi facility |
|---|---|
| Tools that act in the sandbox | Pi's own tool-definition factories for `read`, `write`, `edit` and `bash`, each given an operations object (read file, write file, make directory, access check, exec) routed to the sandbox. Passed as custom tools together with an allowlist of tool names |
| Bash semantics | The exec operation gets a timeout in seconds and an abort signal, streams output through a callback, and returns the exit code. It reports an abort or a timeout by throwing an error whose message is `aborted` or `timeout:<seconds>`. Switch off the option that exposes the session's environment to the shell |
| Access check | One `test` per flag joined with "and": the sandbox's `sh` rejects a combined test |
| Isolation | A hand-built resource loader that returns no extensions, skills, prompts, themes, AGENTS files or appended prompts, and whose system prompt is unset (Pi's base prompt) or the reviewer's. Plus an empty agent directory |
| Settings | An in-memory settings manager (compaction on, retry on with 4 retries) |
| Sessions | A file-backed session manager created with (working directory, session directory) and reopened with (session file, directory, working directory); an in-memory one for the reviewer and lessons |
| A session with no tools | The "no tools" option set to all |
| Cost and tokens | From each assistant message end: the usage's total cost and total tokens |
| Steering | A steer message reaches a working session mid-turn; it is only possible while the session is streaming |
| One-shot calls (the proxy) | The model runtime's simple completion, and its per-provider auth lookup for the embeddings key |

### Web research guard

`pi-web-access` registers more tools than the three and resets the active tool list itself. So the guard is a second extension, loaded after it, through Pi's default resource loader with discovery of extensions, skills, prompts, themes and context files switched off and the two extension factories passed explicitly. The guard:

- re-pins the active tools (the four sandbox tools plus the three web tools) at session start and before each agent start
- blocks every other plugin tool
- edits each call's input in place:

| call | kept inputs | forced |
|---|---|---|
| `web_search` | `query`, `queries`, `numResults`, `recencyFilter`, `domainFilter`, `category` | `provider` = Exa (keyless), `workflow` = none, `includeContent` = false, `proxy` = empty |
| `fetch_content` | `url` or `urls` | `mode` = readable, `proxy` = empty |
| `get_search_content` | all | nothing |

- fetch rules: http(s) only. A github.com file `/blob/` URL becomes its raw-file URL; every other github.com page is refused (the plugin would answer it with the host's GitHub credentials). Video hosts are refused (the plugin would send them to another model): youtube.com, www.youtube.com, m.youtube.com, youtu.be
- the project's own repository is off limits, because it holds the gold: the `origin` remote of the Agent Server's checkout (read in the server container, from the mounted checkout), on github.com, www.github.com, raw.githubusercontent.com, codeload.github.com and api.github.com. Links to it are cut from search results. With no GitHub origin there is no such rule
- off in mock mode

### Prompt

Sections, in order; each only when it has content:

| section | content |
|---|---|
| intro + `<spec>` | Every `.md` in the bundle's `spec/`, the task file (`SPEC.md` or `task.md`) first. A copy is at `/spec/spec`; `/spec/train` is the only labeled data |
| `<direction>` | The operator's direction on a continued night |
| `<trajectory>` | The night so far ([[#Notes, trajectory and rejected diffs]]) and the paths of the rejected diffs |
| `<failures>` | The last experiment's masked errors if it was never scored; for a repair, its own |
| `<targets>` | Threshold metrics the checkpoint has not reached, largest weighted shortfall first, each with its dev value, threshold and weight. Raise all of them in this attempt: one task per metric |
| `<met>` | Threshold metrics already reached on dev by more than their `ci95_half`: plan no task for them, only check they don't fall |
| `<fragile>` | Reached, but by less than their `ci95_half`: they can fall below on the next split. A threshold metric `<x>.mean` takes its half-width from `<x>.ci95_half` in the checkpoint's metrics; any other metric has none, so reached means met |
| `<hypothesis>` | The reviewer's hypothesis to test, within the targets |
| workflow | Four steps: research (at most a fifth of the time; run the program first; score the starting code on train), plan (`/tmp/tasks.json`), implement, review. A repair gets the review step only |
| how to work | The rules below |

Rules the prompt must carry:

- test on cases you write; you never get the evaluation data
- where the spec leaves an interpretation open, choose one on purpose and say which
- how the keep works: the weighted score, the thresholds and weights, the noise
- the optimized standard metrics are measured for the report, not for the keep
- metered nights: the endpoint variables, the models, the experiment's budget, the 402 when it is spent, the free replay of a repeated call after 5 seconds, "call models only through this endpoint"
- each run of the program gets `eval_min` minutes in the evaluation; a longer one scores nothing
- evaluation inputs can be much longer than train's: leave room in token limits and timeouts
- packages: `uv add` in `/repo`, commit `pyproject.toml` and `uv.lock`, run with `.venv/bin/python`
- simpler is better
- write `/tmp/notes.md` for the next coder: at most 20 plain lines of checked facts (tools, limits, runtimes, train measurements, what failed and why); no claim about dev or test
- write `/tmp/train-score.json` when `/spec/train` exists: `before` and `after` objects of metric scores and the `command`; `why` if a metric fell. Score on train items no few-shot example comes from
- send long output to a file; commit only as a checkpoint: the harness commits `/repo` as it stands
- the minutes available and the round's end time; check the clock before stopping
- end the final message with `APPROACH: <one sentence>`

The task file `/tmp/tasks.json` is a JSON list of `{task, check, status}` with status `todo`, `done`, or `dropped` plus a `note`.

### Send-backs, reserve and wrap-up

Problem: coders stopped at about half their time, with open tasks or no measurement.

- reserve = the last 20% of the experiment's time or of its budget, whichever comes first
- when the coder stops, it is sent back for one more turn if any of these holds:
  - `/tmp/tasks.json` is missing, invalid, or has a task that is neither `done` nor `dropped` with a note
  - the bundle has `train/` and `/tmp/train-score.json` is missing or invalid (valid = `before` and `after` are objects, each with at least one numeric value); or a metric is lower after than before with no `why`
  - it is not in its reserve yet. The message contains "You stopped with N of N minutes and $X of $Y left" (after any task or train-measurement problem), names the next step (the untested parts of the hypothesis, or the worst train items of the metric furthest below its threshold) and asks for exactly one change: commit a checkpoint in the sandbox, build the change, measure it on train against the checkpoint, keep it only if it scores better, else restore the checkpoint
- limits: at most 8 send-backs (a guard against a coder that stops at once each turn); none for a repair; none with less than 3 minutes left; none once the coder was stopped by a cap
- wrap-up: sent at most once per experiment. It contains the literal words "change no more code" and tells the coder to restore the checkpoint if the last change didn't win, close its tasks, bring the train measurement and notes up to date, review again and end with `APPROACH`. Two ways in:
  - mid-turn, as a steering message, when the reserve starts while the coder is working: a timer at 80% of the time, and a check after each assistant message for the budget
  - as one more turn after the send-back loop ends, for a coder that was sent back at least once before its reserve. This also holds when the loop ended on the cap of 8 with the reserve not started, which is what a mock session does
  - no wrap-up turn with less than 3 minutes left, after a cap stop, or for a coder that was never sent back
- the words "You stopped with" appear only in a send-back message, and "change no more code" only in the wrap-up. No other prompt text may contain either: the e2e test counts them in the session file
- the experiment's clock starts before the sandbox is created, so provisioning counts against `experiment_min`

### End of an experiment

| stop | when |
|---|---|
| `done` | the coder finished and nothing sends it back |
| `timeout` | `experiment_min` passed (a timer aborts Pi) |
| `idle` | no model or tool event for 10 minutes, or 25 minutes with a tool running and silent (checked every 30 s) |
| `budget` | `coder_usd + dev_usd ≥ budget_usd.experiment`, checked after each assistant message |
| `agent_error` | The prompt call threw, for a reason that is not a credit error |
| `credits` | a credit stop |
| `cancelled` | the session was aborted from outside: the night was stopped, or the step's backstop timer fired |

- every stop but `cancelled` commits: partial work is still a result. `cancelled` destroys the sandbox and fails the step
- a turn that ends on a failed model call that is not a credit error (a lost connection, after Pi's own retries) is a stop like any other: the send-back rules apply, so the session carries on once calls succeed again. `agent_error` is only for a prompt call that threw
- before the commit the Agent Server reads from the sandbox: `/tmp/notes.md` (cut to 3,000 characters), `/tmp/tasks.json` and `/tmp/train-score.json` (saved under `exps/<exp>/`)
- commit: the sandbox's `.git` is replaced, the tree is committed once on the parent commit (squashing whatever the coder committed), exported as a git bundle and imported as `refs/exp/<exp>`. Message: `<exp id>: <hypothesis>`. In order: the parent's git bundle, uploaded at create, stays in the sandbox outside `/repo`; delete `/repo/.git`; start a new repository on `main`; fetch the parent from that bundle and soft-reset to it; add everything (so `.gitignore` applies); commit, an empty commit allowed, as `codeclimb <codeclimb@localhost>`; bundle `main`; the host reads the bundle and force-fetches `main` into the experiment's ref
- hypothesis recorded: the reviewer's if the round had one, else the last `APPROACH` line of the closing message, backticks and asterisks stripped, cut to 300 characters. With no such line: the closing message's last non-empty line, else `(no summary)`
- a commit whose tree equals its parent's is `unchanged`: nothing is evaluated, and the closing message (cut to 1,000 characters; `(no closing message)` when empty) goes to the reviewer and the history
- `code-state.json` is rewritten on every assistant message, so a killed attempt loses nothing and the app can show it live. Keys: `startedAt`, `sandbox`, `freshRestarts`, `infraErrors`, `coderUsd`, `devUsd`, `tokens`, `tCode`, `tProvision`, and at the end `finishedAt` and `stop`; after a credit stop `stop` and `paused` (the paused commit) with no `finishedAt`
- `code-result.json` holds a finished coder's result, written before the finished state. A rerun step that finds both returns it without coding again

### Crash and resume

- a rerun step with a state file on disk looks for the sandbox by name. "Rerun" is decided by the file, not by the step's attempt number: a step run again after the Agent Server restarted starts at attempt 1, yet its state file is on disk. Alive, with a session file → reopen the session with a short prompt saying the harness restarted and to continue where it left off (a session resume). Dead → one fresh restart from the parent commit, counted in `infra_errors`: the experiment's clock and the session start again; spend, tokens and the restart count carry over. Lost twice → the experiment fails (`sandbox lost twice`)
- after a pause for credits: a new sandbox from the paused commit, the same session, and the clock set so the pause doesn't count
- live registry: an in-process map from the experiment's or the evaluation's id to an abort function. Each entry also carries its night id, since the stop operation has only the night id. Every step builds one abort signal and registers its abort. Three things fire it: the server run's own signal (a cancel), the step's backstop timer, and the stop operation, which runs in the same process and aborts the night's entries directly ([[#Durable runtime on LangGraph]]). Without the registry Pi keeps spending against destroyed sandboxes

## Evaluator

One sandbox per evaluation. Never the coder's sandbox, and created after it is destroyed, so the coder never touches the runner or the inputs. A failed evaluation is an outcome with `ok: false`, not a failed run.

For one commit:

1. **Reset**: kill every process except the sandbox's own init, the guest agent and the image's keep-alive command; wipe `/repo`, `/work`, `/eval`, `/tmp` and the home cache; clone the commit into `/repo`. This makes a step retry safe
2. **Environment**: if the commit has a `uv.lock`, rebuild its environment in `/repo/.venv` (system packages stay importable; frozen; no dev group). No meter token and no stage clock. Limit 3 minutes. A failure fails the evaluation with a `uv.lock: …` error
3. **Token**: on a metered night, open a meter token for this evaluation. Cap = the night's budget left when it starts
4. **Per stage, in order**:
   - `inputs` on the host → `evals/<eval>/<stage>/inputs.jsonl`
   - upload the inputs to `/eval/<stage>/inputs.jsonl` and the stage's `files`
   - `run` in the sandbox, cwd `/repo`, timeout `eval_min`, the meter variables as environment. The harness creates `/eval/<stage>/out` first, puts `/repo/.venv/bin` first on the path, runs the stage command in a subshell and sends its stdout and stderr to `/eval/<stage>/run.log`. `{inputs}` = `/eval/<stage>/inputs.jsonl`, `{out}` = `/eval/<stage>/out`
   - a timeout or a non-zero exit fails the evaluation with the log's tail
   - save `run.log` on the host, also after a clean exit: a program that swallows its errors shows them only there
   - on a metered night, check again that the proxy's URL reaches the proxy; if not, throw: the scores would be the outage's
   - tar the outputs from inside the out directory and download them → `evals/<eval>/<stage>/outputs/`, the run's files at its top level
   - on dev, stop here if the run exited clean but wrote no output: an empty stage can't be kept, and later stages would only spend money. Test always runs every stage
   - parse `timings.jsonl` if present
   - score on the host: `details` on dev when the stage has it, else `score`; `{out}` = the downloaded outputs, `{report}` = `evals/<eval>/<stage>/report.json`
   - flatten the report into metrics
5. **Close**: revoke the token (spend counts even on failure); write `meter.jsonl` and `metrics.json`; destroy the sandbox

Outcomes:

- `ok` = the primary metric is a number
- program crash, timeout, bad timings file, scorer failure, empty dev stage → `ok: false` with an error the reviewer and the next coder read (the run log's last 2,000 characters)
- an `inputs` failure or an infrastructure failure throws → step retry, then the evaluation fails
- a credit stop → no score; the night pauses and reruns it
- the result returned to the night holds aggregates only (metrics, cost, timings, the sandbox instance id); per-item data stays on disk
- a retried evaluation step looks its sandbox up by name and reuses it after the reset. Destroying the sandbox is a step of its own and runs after a failed evaluation too

### Standard metrics

The same for every scenario, measured outside the code under optimization, always recorded.

- latency, from the runner's `timings.jsonl` in a stage's outputs: one JSON line per operation, `{op, id?, ms, warmup?}`; `op` matches `^[a-z][a-z0-9_]*$`; warm-up records count for nothing. Metrics: `latency_<op>_p50_ms`, `latency_<op>_p95_ms` (linear-interpolation percentiles, 3 decimals), `latency_<op>_total_s`, `latency_total_s` (6 decimals). Sandbox setup, clone, scoring and teardown are excluded
- cost, from the proxy's ledger, refused calls excluded: `cost_usd`, `cost_per_item_usd` (items = input lines over all stages), `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`. All 0 without calls. A replayed call is priced as the call it stands for, so unchanged code shows an unchanged cost, though it spent nothing
- the optimized standard metrics are `cost_metric` when `cost` is true, then `latency_metric` when `latency` is true. They are named to the coder and the reviewer; a standard metric that is not optimized stays out of the prompts unless a gate or threshold names it. `model_calls` counts as a cost metric here
- `min_efficiency_gain` is used once, in the reviewer's prompt: mention a change of more than that share in an optimized metric, and propose an efficiency hypothesis only when one blocks the goal, such as a run near its time limit

## Reviewer

One Pi session per round: no tools, in memory, its own system prompt, on `reviewer_model` with `reviewer_thinking`. It decides nothing.

Reads:

- the spec, the scenario's protocol, thresholds, weights, gates, the direction
- the checkpoint: its source (at most 60,000 characters) and its metrics, or a note that it is the unscored starter
- the experiment: hypothesis, metrics, diagnostics, how many model calls were replayed and how many failed, the change of the primary and each headline metric with its `ci95_half`, the loop's decision and reason, guardrails, repository-check notes
- the coder's side: its notes, its task list and train measurements (4,000 characters each), and a flag when its own train measurement fell with no `why`
- evidence, each capped as in the table below: per-item dev errors, each stage's run log, the stages whose outputs didn't change, the diff
- the A/A pair, and the threshold metrics past their target by less than their `ci95_half`
- the night so far (the trajectory)
- which metrics it sees: thresholds, gates and headlines always. With headlines, the rest only as diagnostics. Without headlines, every scorer metric, and latency or cost metrics only when optimized
- an `unchanged` experiment: the checkpoint's scores, the note that nothing was tested, and the coder's closing message

| evidence | cap | when over |
|---|---|---|
| Per-item dev errors (a stage report's `details`) | 70,000 characters per stage | Items shorter than an equal share stay whole; the longer ones split what is left equally |
| A stage's run log | 4,000 characters | Lines containing `HTTP Request:`, and blank lines, are dropped. If it still doesn't fit: the flagged lines first (each distinct line once, with its count, at most half the room), then the end of the log, whole lines only. A flagged line holds one of these whole words, in any case: warn, warning, error, critical, exception, traceback, failed |
| Diff against the checkpoint | 60,000 characters | Cut, with a note of the full length |
| Checkpoint source (every text file) | 60,000 characters | Cut, with a note of the full length |
| Unchanged stages | none | A stage counts as unchanged when a hash over its dev output files, the timings file aside, equals the same hash for the checkpoint's own dev evaluation |

Writes JSON with three fields, all of which coders read:

| field | content |
|---|---|
| `feedback` | What worked, what regressed, which metric families are weakest; why a revert scored worse; what is fragile in a keep |
| `hypothesis` | The next round's plan from the whole night: one concrete change per threshold metric still short, largest weighted shortfall first, one or two sentences each, at most four; nothing an earlier round tried and lost unless something is different now |
| `verdict` | At most 8 lines for the experiment's note: which change moved which metric and why, which coder notes the scores confirm or contradict, what not to try again |

Rules the system prompt must carry:

- each run is one sample: read small moves against the `ci95` and the replayed-call share
- describe categories of error; never write a dev entity, document name, query id or query text; quote no dev counts or sizes, only metric values and their changes
- follow the direction when there is one
- open spec interpretations are tested one round at a time
- after a revert or a round that barely moved a target, try a clearly different change

Handling:

- a reply must parse to `feedback` (string) and a non-empty `hypothesis`; a missing `verdict` is allowed. The JSON object is read from the reply's first opening brace to its last closing brace, so text or a code fence around it is fine; fields are trimmed. One retry asking for JSON only, then the review fails
- leak loop: the three fields go through `scan`. Found → one rewrite request naming what was found; what survives becomes `[hidden]`. `scan` finds copies, not paraphrases, which is why the prompt forbids naming dev items
- persisted: `reviews/r<N>.prompt.md` before the call (a failed review leaves it too), `reviews/r<N>.json` after: `round`, `model`, `feedback`, `hypothesis`, `verdict`, `reviewer_usd`, `t_review`, `tokens`
- a credit error pauses the night and the review runs again

## Memory within and across nights

### Notes, trajectory and rejected diffs

Notes and rejected diffs are files in the bundle's `history/`, so every later coder sandbox has them under `/spec/history/`. They are masked with `scan` before they are written.

The history (one masked line per round: hypothesis, changes, decision, reason) is not a file: it lives in the night's state, so a step retry can't append a line twice. The masked lines travel to each coder and to the reviewer in their step's input. The feedback in a trajectory is read from `reviews/r<N>.json`.

- **note**, one per experiment, `history/notes/r<N>-e<n>.md`, kept whether or not the round is kept:
  - heading: `## r<N>-e<n> · <decision>: <reason>` (reason cut to 300 characters)
  - `### Coder, before the evaluation` + the coder's notes
  - `### Reviewer, after the evaluation` + the verdict
  - a failed attempt that gets a repair has a note with the heading and the coder part only
- **history line**, one per round: `- r<N>: <hypothesis> → <moves> (<decision>: <reason>)`. Moves: the weighted score's change; the primary's change when the scenario has no headlines; each headline and optimized metric's change against the checkpoint, or its value when the checkpoint had none. An error's reason is its last 300 characters. Reason = the unchanged note, the errors, or the decision reason
- **rejected diff**: `history/r<N>.diff`, whole, against the checkpoint, for every round that kept nothing and changed code. Coders read the part they need
- **trajectory**: what the coder and the reviewer of round N read about rounds 1 to N−1, oldest first, the latest marked. Per round: the history line, its notes, the reviewer's feedback. Budget 48,000 characters: past it the oldest rounds lose their feedback first, then their coder parts, then all but the history line; the latest round stays whole. A seeded night starts it with the `<start>` note

### Lessons across nights

Problem: a night's notes and reviews die with its bundle. The scenario's `lessons.md`, which ships in every bundle's spec, is the only memory between nights.

- trigger: when a night finishes or is stopped, a server run of the `lessons` graph starts the distillation, one at a time per scenario so two nights never edit one file ([[#Durable runtime on LangGraph]]). It is started only when lessons are on: the mode is not `off` and the scenario declares lessons. The stop cleanup reads the config from `night.json`
- a night is distilled when it has notes or reviews for rounds past its newest applied proposal. It is skipped when a proposal folder for its last such round already exists, applied or not. This skip is also what makes a second lessons run for the same night harmless
- a credit error fails the distillation, and the step's retries run it again: there is no pause
- input: the rounds past the last applied proposal: notes and reviews (feedback, hypothesis) only. Never `done.json`, a test evaluation or the review prompts. Plus the spec without `lessons.md`, and `lessons.md` with its bullets numbered
- file format: a `# ` title, preamble paragraphs, `## ` sections holding only `- ` bullets (two-space continuation lines). Written in one layout: wrapped at 100 columns, empty sections left out. Anything else under a heading fails the distillation
- the model (the reviewer's model and effort) returns operations, not a new file: `add` (section, text), `edit` (id; new text, a move to another section, or both), `drop` (id), each with a `reason`. At most one op per bullet. Code applies them, so an untouched lesson stays byte for byte
- gates on what a coder would read:
  - a lesson or heading with a held-out name (`scan`) is rejected; a reason is masked instead
  - no metric value: a number with a decimal point, or a number followed by a percent sign (spaces allowed between). A decimal inside a name is not one, such as the version in a model id (`jev-1.14`, `deepseek-v4.1-flash`): it does not count when a letter, digit, underscore, dot or hyphen comes right before it, when a letter, digit, underscore or hyphen comes right after it, or when a dot and another character follow it
  - a lesson ≤ 500 characters, a heading ≤ 80
  - at most 30 lessons: an `add` to a file that already holds 30 is rejected. At most 200 lines: only this cap prunes
  - an `add` is a near-duplicate when it and an existing lesson share ≥ 50% of the shorter one's content words (4 letters or more, stop words aside, plurals folded); rejected unless marked `distinct`
  - a heading the spec cites as (`lessons.md`, Heading) keeps at least one lesson
  - a new heading needs `new_section: true`
- reading the reply: the JSON object is taken from the first opening brace to the last closing brace; an op that is malformed or has no `reason` is left out without failing the rest; one retry when nothing parses
- order of checks: every `edit` and `drop` first, then the `add`s, whatever their order in the reply. So a dropped lesson no longer counts as a near-duplicate and frees a place
- rejected ops get one rewrite: the model is asked for the whole corrected list, which replaces the first and is checked again against the same file. An unparsable rewrite keeps the first list's accepted ops. Ops rejected twice are left out and listed in `changes.md`
- over 200 lines → up to 2 prune rounds: drops, and edits shorter than the lesson they replace, with the bullets numbered again after the ops so far. A proposal still over is never applied
- output, under `<results dir>/lessons/<night>-r<last round>/`: `lessons.md` (the new file), `changes.md` (each op beside the lesson it changes, rejected ops, prunes), `proposal.json` (ops, base sha256, cost, `applied`)
- `apply` also writes the scenario's `lessons.md`, unless that file changed since the proposal or the night was a mock. It never commits: `git diff` is the review
- `night.json` records the sha256 of the `lessons.md` each variation's coders read
- by hand: `lessons distill --config … --night ID [--apply]`, `lessons apply --config … --night ID`, `lessons format --config … [--check]`

## Metering proxy

An HTTP server in the Agent Server process, in the server container; the only way a program reaches a model. Sandboxes hold no provider key.

| route | use |
|---|---|
| `POST /v1/chat/completions` | Text messages only (`system`, `user`, `assistant`), no tools, no streaming. To OpenRouter, `max_tokens`, `temperature`, `response_format`, `seed`, `top_p`, `stop` and `reasoning` are forwarded; through Pi, `max_tokens` only. Answers in OpenAI's shape |
| `POST /v1/embeddings` | `input`: a string or a list of strings |
| `POST /v1/decisions` | OpenRouter decisions models. Body: `model`, `state`, `questions`, optional `assets`. Answers with `answers` |
| `POST /v1/rerank` | Body: `model`, `query`, `documents` (a list of strings), optional `top_n`. Answers with `results`, best first, each an `index` into the documents and a `relevance_score` |
| `POST /v1/_op` | Body: `op`, matching `^[a-z][a-z0-9_]*$`. The runner names the operation later calls belong to; default `program`. Answers 200 with the op and writes no ledger row. The scenario runners call it first and fail on any other status |

- a ledger per token: open with an evaluation id, the allowed models, a `$` cap and a credit-stop callback → a random bearer token; read its spend; close → its calls, token revoked, calls in flight aborted
- refused, in this order: 401 bad or revoked token; 413 body over 16 MiB; 403 model not in `allowed_models`; 402 the ledger already hit a credit stop; 402 cap spent; 400 unsupported request. An upstream failure is 502 and what it cost is still charged. A cap is checked before a call, so the crossing call still runs
- a refusal answers with an object holding `error.message` and `error.type`: `authentication_error` (401), `permission_error` (403), `insufficient_quota` (402), `invalid_request_error` (400, 413), `api_error` (502)
- every call is one ledger row, and one line of `meter.jsonl` or `meter-dev.jsonl`. Always: `kind` (`chat`, `embeddings`, `decisions`, `rerank`), `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd`, `ms`. Only when they apply: `error` (a failed or refused call; never present on a successful one), `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected` (the status of a refused call). The files are written only when the ledger has rows
- backends: `openrouter/<id>` goes straight to OpenRouter with the Agent Server's key and charges the `usage.cost` it reports (a reply with no cost counts as failed); decisions and rerank exist only there. Other chat goes through Pi's model runtime at catalog prices. Outside OpenRouter, embeddings only for `openai/text-embedding-3-small` ($0.02 per million tokens) and `-large` ($0.13)
- OpenRouter facts: base `https://openrouter.ai/api`, with the `openrouter/` prefix stripped from the model id. Chat at `/v1/chat/completions`, and the request must ask for usage accounting or the reply has no cost. Embeddings at `/v1/embeddings`, rerank at `/v1/rerank`. Decisions models refuse chat and live on the alpha path `/alpha/decisions`. The model check is a GET of `/v1/models/<id>/endpoints`. A 200 reply with an `error` body is a failure; HTTP 402 is the credit signal. A reasoning model cut off by its token limit answers with null content: treat it as empty text with finish reason `length`
- Pi backend facts: system messages are joined into the system prompt; earlier assistant turns are rebuilt as assistant messages of the same model; input tokens = input + cache read + cache write. A reply with stop reason `error` or `aborted` is a failure that still costs. Pi has no embeddings: those go to the provider's OpenAI-compatible endpoint with the key Pi resolves for that provider
- two ledgers per experiment: the coder's dev ledger (`<exp>-dev`: `dev_usd`, `meter-dev.jsonl`, never in cost metrics; a new token per Pi attempt, spend carries over; cap = what is left of `budget_usd.experiment`) and the evaluation's (`program_usd`, `meter.jsonl`, the cost metrics)
- program side: `OPENAI_BASE_URL` and `OPENAI_API_KEY`, also as `CODECLIMB_LLM_BASE_URL` and `CODECLIMB_LLM_API_KEY`

Replay cache. Problem: identical code scored 0.722 to 0.767 on one metric across runs, because the model is not deterministic.

- within a night, a successful call is cached by its kind, model and request. A reply cut off by `max_tokens` is not cached
- an evaluation that repeats an earlier evaluation's call gets that answer back, after the time the call took, for free. So unchanged code scores the same and a metric moves only where a change reached
- the same call again within one evaluation is a retry of a bad answer: it goes upstream
- a coder's ledger spans many runs, so it also replays its own calls, unless the call repeats within 5 seconds of its last answer (a retry)
- the A/A run neither reads nor writes the cache
- one night's cache at a time: a new night's first token clears it

Path to the proxy:

- listener: the proxy has its own listener in the Agent Server process, started on first use, at `CODECLIMB_PROXY_HOST` and `CODECLIMB_PROXY_PORT`. In the server container the compose override sets them to `0.0.0.0` (every interface inside the container) and the fixed port 8090. The port is not published to the operator's machine: only containers on the stack's network and on `cc-meter` reach it. With neither variable set (outside the server container: the unit tests) it binds a free port on loopback, or on the Docker bridge's gateway address on Linux. The worker API runs in another process, so unlike the Inngest twin it does not serve `/v1`
- metered: sandboxes join a plain network `cc-meter` and see the proxy at `http://cc-meter-relay:8080/v1`
- the server container joins `cc-meter` too, under the alias `codeclimb-server` (the relay target, `CODECLIMB_RELAY_TARGET`). `cc-meter` must exist before `up`, since the compose override names it as an external network ([[#Deployment and environment]])
- the relay: a container `cc-meter-relay` from the scenario's image, on `cc-meter`, running a small TCP forwarder written with Python's standard library (port 8080 → the relay target and the proxy's port), labelled `cc.meter=1`, `cc.meter.port=<port>` and `cc.meter.target=<target>`, with no managed label. It is shared by nights, never swept, reused while it runs with the same port and target labels and recreated otherwise. Concurrent callers must not remove a relay another just started
- the relay reaches the proxy by the server container's name on `cc-meter`, the same on Docker Desktop and on Linux. The host-gateway alias and the Linux bridge-address bind are off this path. Both are kept as the defaults outside the server container: every relay gets the alias `host.docker.internal`, which is also the relay target when `CODECLIMB_RELAY_TARGET` is unset ([[#Open points for the build]])
- unmetered: the default bridge. Both have internet access; only a token gets a program to a model
- "the path is up" is checked before a coder starts, before an evaluator opens, after each stage's run, and in the round-start smoke test: `cc-meter` and the relay exist, the relay runs, and both its port label equals the proxy's port and its target label equals the relay target; otherwise recreate it. Why the target too: a relay left by another server with the same port but another target would be kept and forward nowhere. There is no HTTP probe from the Agent Server: the relay's name resolves only inside the network
- why: with a broken path a program still runs, and one that swallows its errors would score as a bad program. An outage never becomes a score

## Sandboxes

One interface; Pi's tools and the orchestrator call only this.

- backend: create (name, image, optional commit to clone into `/repo`, optional spec directory for `/spec`, labels, network), find a live sandbox by name (to resume a crashed step), sweep by name prefix or by label
- sandbox: exec (cwd, timeout, abort signal, streamed output, stdin, per-command environment → exit code, stdout, stderr, timed out, aborted), read file, write file, is alive, instance id (changes when recreated under the same name), age, destroy
- a backend must offer: exec that kills the whole process tree on timeout or abort, streamed output, file transfer at least as large as the largest git bundle or `/spec` folder, find by name, sweep
- git holds the state, the image holds the environment: each sandbox = fresh image + commit
- code moves as git bundles through write file / read file: no git credentials in a sandbox, one code path for every backend. Directories move as tars. In this spec "bundle" alone always means the coder's `/spec` folder; a git bundle is always called a git bundle
- `/spec` is uploaded at create; only coders get it
- names are deterministic, so find resumes a step and a prefix sweep cleans a night
- size: 2 vCPU and 2 GiB, as on the Inngest twin's Docker backend. Scenarios must fit in 2 GiB
- before any create, the backend refuses a night that has a `stop.json`, so a step still running after a stop can't leave a new sandbox behind the sweep
- create replaces a stale sandbox of the same name

Docker backend:

- one container per sandbox, limited to 2 CPUs and 2 GiB, on the default bridge or `cc-meter`, kept alive by the image's sleep command
- the backend drives the Docker CLI in the server container against the Docker daemon of the operator's machine, through the mounted Docker socket, so sandboxes are siblings of the server container, not children. Files enter and leave a sandbox by copy (write file, read file, tars), never by bind mount, so host and container paths never need to match
- labels: `cc.managed=1`, `cc.night=<night>`, `cc.run=<experiment or evaluation id>`; sweeps filter on `cc.managed`
- exec: each command runs under a new session leader that waits for it and first writes its process id to a file under `/tmp`. On a timeout or an abort, a second exec sends KILL to that process group. Killing the `docker exec` client alone leaves the command running in the container, and no timeout would work
- helper execs (read, write, kill, reset, clone) use the working directory `/`, because `/repo` is missing during the evaluator's reset. The reset's wipe of `/tmp` spares the process-id files
- write file creates the parent directories
- sweep filters on the managed label plus a name anchored at its start, or a label

## Data and files

### Experiment repository

- `experiments.git`: a bare repo, shared by the nights of one results directory, no remote, no branches
- one commit per experiment, pinned by `refs/exp/<exp id>`
- the starter commit is built from `starter/` with its `.gitignore` honoured, message `starter`, and a fixed author, committer (`codeclimb <codeclimb@localhost>`) and date (`2026-01-01T00:00:00Z`), so the same starter tree always has the same SHA
- `unchanged` compares the two commits' tree ids
- an alias ref points a new experiment id at an existing commit (seed, rescore)

### Result row

`results.jsonl`: one JSON line per experiment, per noise run and per test eval. Validated against a JSON Schema on append, and deduplicated by `eval_id`, so a replayed step writes nothing twice. `validate-results <file>` checks a file; `validate-results --schema` prints the schema.

| fields | meaning |
|---|---|
| `night_id`, `exp_id`, `parent_id`, `eval_id`, `round` | Identity. `eval_id` is the unique row key. `parent_id` = the checkpoint's experiment; null on noise, rescore and test rows |
| `stack`, `backend` | `langchain`; `docker`. The schema accepts `stack` `inngest` or `langchain` and `backend` `docker`, so rows of both builds validate against one schema |
| `kind`, `split` | `experiment`, `noise`, `test`; `dev`, `test` |
| `model`, `reviewer_model`, `hypothesis`, `commit` | What was tried. `model` is null on noise, rescore and test rows; `hypothesis` is null on test rows and a fixed sentence on noise and rescore rows |
| `metrics` | Flat name → number |
| `decision` | `keep`, `revert`, `error`. Noise and test rows: `keep` if the evaluation succeeded, else `error` |
| `score`, `decision_reason` | The weighted score; why it was kept or reverted |
| `coder_usd`, `dev_usd`, `program_usd`, `reviewer_usd`, `tokens` | `reviewer_usd` is the round's review, repeated on the round's rows: count it once per round |
| `wall_s`, `t_provision`, `t_code`, `t_eval`, `t_review`, `t_teardown`, `infra_errors` | Seconds; provision and teardown sum both sandboxes |
| `evaluator_instance`, `unchanged` | Which sandbox incarnation ran the eval; no code change |

Required: all of the above except `kind`, `eval_id`, `night_id`, `score`, `decision_reason`, `dev_usd`, `evaluator_instance`, `unchanged`, which are optional in the schema but always written where they apply. `round`, `tokens` and `infra_errors` are integers ≥ 0; `parent_id`, `model` and `hypothesis` may be null.

Rows that are not experiments:

- noise and test rows: `exp_id` and `commit` are the checkpoint's, `eval_id` is the evaluation's id, the coder fields are 0. A noise row has `split: dev` and carries `score`; a test row has `split: test`
- when such an evaluation failed: `decision: error`, `metrics` holds the primary metric at 0, and `infra_errors` counts it
- with nothing kept, the test evaluation runs on the round-0 commit and `done.json`'s `kept` names it; `dev_score` is 0 for a starter and the seed's primary value for a seed. `test_metrics` is null when the test evaluation failed
- an experiment that was never evaluated still has `eval_id` = `<exp>-eval`

### Files a night writes

Under the directory of `results_path`:

| path | content |
|---|---|
| `results.jsonl` | Every night's rows |
| `experiments.git` | The experiment repository |
| `lessons/<night>-r<N>/` | Lesson proposals |
| `nights/<id>/night.json` | `night_id`, `startedAt`, `deadlineMs`, the round-0 experiment id and SHA, `seed`, the resolved `config`, `metric_script_sha256`, `lessons_sha256`; once they apply, `run_budget_usd`, `variation` and `pausesApplied` |
| `nights/<id>/done.json` | `night_id`, `stop_reason`, `rounds`, `kept` (`exp_id`, `commit`, `dev_score`), `test_metrics`, `spend_usd` (4 decimals), `leftover_sandboxes_destroyed`, `finished_at` |
| `nights/<id>/stop.json` | `at`, `reason` (`manual`, `app`, `failed`, `cancelled`). Written only if the night has no `done.json`; the first stop wins |
| `nights/<id>/pause.json`, `pauses.jsonl` | The current pause; every pause |
| `nights/<id>/noise.json` | The A/A run |
| `nights/<id>/bundle/` | The coder's `/spec`: `spec/`, optional `train/` and more, `history/` growing |
| `nights/<id>/reviews/r<N>.json`, `r<N>.prompt.md` | The review and what it read |
| `nights/<id>/exps/<exp>/` | `session/*.jsonl`, `code-state.json`, `code-result.json`, `tasks.json`, `train-score.json`, `check.json`, `meter-dev.jsonl` |
| `nights/<id>/evals/<eval>/` | `<stage>/{inputs.jsonl, run.log, outputs.tar, outputs/, report.json}`, `meter.jsonl`, `metrics.json` |

Source of truth is git plus `results.jsonl`. The runtime's traces and scores mirror it for debugging and are never read by a decision.

## Interfaces

### Control operations

The Inngest twin's four events, as calls to the Agent Server's API through `@langchain/langgraph-sdk`. One module holds them; the CLI, the worker API, the watchdog and the graphs all call it. Threads and their ids: [[#Durable runtime on LangGraph]].

| operation | call | input | called by |
|---|---|---|---|
| start | Create the night's thread, then a server run of `night` on it. If the thread exists, nothing starts and the CLI follows the running night | `night_id`, `config`, `mock`; optional `seed` (a night id), `variation`, `continue` (`rescore`, optional `direction`), `mock_offline`, `mock_credit` | CLI, API (continue) |
| stop | Write `stop.json` (the first stop wins), then a server run of `stop` on the night's stop thread | `night_id`, optional `reason` | CLI, API, the night's failure and cancel paths, the watchdog |
| resume | A server run of `night` on the night's newest thread with a resume command | `night_id`; the pause number is read from the thread's pending interrupt | CLI, API |
| lessons | A server run of `lessons` on the scenario's lessons thread, queued behind any in flight | `night_id`, `scenario`, `config` | the night at its end; the stop cleanup. Only when lessons are on |
| timer | A server run of `stop` on the night's timer thread, with `afterSeconds` | `night_id`, `reason: failed`, a guard: the pause number or the variation number | the night: at each pause, and at the start of each variation |

### Worker API

Default `127.0.0.1:7421`, in its own process (`api`, on the operator's machine, not in a container), which also runs the watchdog ([[#Durable runtime on LangGraph]]). It reaches the Agent Server at `CODECLIMB_SERVER_URL` and reads `runs-langchain/` from the same checkout the server writes. No token on loopback; off loopback `CODECLIMB_WORKER_TOKEN` is required as a bearer on everything. A busy port is a startup error: two APIs would run two watchdogs over the same nights.

| endpoint | purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/nights`, `GET /api/nights/:id` | Night summaries, read from `runs-langchain/*/nights/*` |
| `GET /api/nights/:id/live` | Summary, the current round's experiment (phase, elapsed, coder and dev spend, tokens), the night's row count, the exportable experiments |
| `GET /api/nights/:id/report` | The night's rows, reviews, config extract and diffs, as JSON |
| `POST /api/nights/:id/stop`, `/resume` | The stop or resume operation; stop writes `stop.json` at once |
| `POST /api/nights/:id/continue` | `{direction?, rounds ≥ 1}`; 409 when the night can't continue |
| `GET /api/nights/:id/export/:exp?format=repo\|source\|bundle` | Download: a git repo `.tar.gz` (default), the tree only, or a git bundle |
| `POST /api/nights/:id/export/:exp` | Body: `kind` = `dir` with a `path` on the API's machine (always the git-repository form), or `kind` = `remote` with a `url` and an optional `branch` |

- status comes from files, not from the durable runtime: `done.json` → `finished`, `stop.json` → `stopped`, `pause.json` → `paused`, no file written for an hour → `stale`, else `running`. So the app doesn't depend on the stack. The hour already covers the ~2 minutes a killed night waits for the server's runs sweeper after `up`
- phase of the live experiment: `evaluated` once its row exists; `starting` with no `code-state.json`; `waiting for eval` once the state has `finishedAt`; otherwise `coding`. A repair (`e1`) takes over from `e0` once its folder exists
- finding nights: scan `<root>/runs-langchain/*/nights/<id>/night.json` and `<root>/runs-langchain/mock/*/nights/<id>/night.json`. The stop cleanup finds a night's folder the same way, since the stop input holds only the night id
- nights start only from the CLI

### App

Next.js on `127.0.0.1`, light and dark themes. Every page reads the worker API through a server route that adds the worker token; the browser never holds it.

- Nights (`/`): every night with status, round, best primary value against its threshold, spend against budget; refreshed every 10 s
- Night (`/nights/<id>`), polled every 5 s, report data refetched when a row lands:
  - status, Stop, Resume while paused, the pause's reason
  - a Continue form (direction, rounds) once the night ended
  - tiles: kept primary value, test (one per stage on a multi-stage scenario), round, spend with a breakdown (agents, program runs), elapsed against the deadline
  - the current round's experiment: phase, elapsed, tokens, coder and program-call spend
  - per-stage tables of the headline metrics with their `ci95` for each kept commit and for test
  - a convergence chart with a metric selector, and a table view
  - a heatmap of per-family accuracy metrics (`acc_*`) where a scenario reports them, for the kept lineage or all experiments
  - the selected experiment: metrics, cost, hypothesis, diff against its parent
  - Export: download a kept commit as a git repository

### Export

- targets: a folder with plain files (refused if not empty, unless forced), a folder as a git repo with the kept lineage as history on branch `codeclimb/<exp id>` (needs an empty or new folder), or a push of that lineage to a remote branch (`codeclimb/<exp id>` or a given one)
- never force-pushes; remotes limited to `https`, `ssh`, `git`, `file` and local paths; option-like arguments and command transports (`ext::`, `fd::`) refused; git never prompts for credentials
- CLI: `export (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])`. `best`, the default for `--exp`, = the kept commit of the most recently finished night

### Tracing

Step bodies call the OpenTelemetry API (`@opentelemetry/api`), a no-op without a tracer provider, with spans built by hand on Pi's event stream:

- one chat span per assistant message (model, tokens, cache, finish reason, cost); one span per tool call; one per sandbox exec, read and write; one per program operation of an evaluation; one per metered call under its evaluation
- one trace per experiment, not one per night. LangSmith caps a trace at 25,000 trace runs, and a night's spans pass that. Each coder session opens its own trace root, named after the experiment; each evaluation (dev, noise, rescore, test) and each review opens one named after its own id. Every root carries `night_id` and, where it has one, `exp_id` as metadata, so a night is found by filtering, not by opening one trace. The night's server run is traced by the Agent Server itself and holds only the steps
- the tracer: a small tracer provider of CodeClimb's own, registered when the graph module loads, that writes each span as a LangSmith trace run with `RunTree` from `langsmith/run_trees` (`postRun` at span start, `end` and `patchRun` at span end, `createChild` for a child span). A `RunTree` created with no parent is its own trace, also inside a step of a traced server run. No OpenTelemetry SDK package is installed, and `initializeOTEL` is not used: it is deprecated and needs three more packages. With no `LANGSMITH_API_KEY`, or with `LANGSMITH_TRACING=false`, no provider is registered and the spans stay no-ops
- a rerun step opens a new root; roots are never shared between steps. A step that needs another step's root (the evaluation mirroring scores onto the experiment's root) gets its run id as plain data
- the primary and headline metrics (every metric when the scenario has no headlines) of each dev evaluation are also mirrored as LangSmith feedback on the experiment's root: `createFeedback({ runId, sessionId, key, score, feedbackId })`. `sessionId` is the tracing project's id (`readProject` by name). `feedbackId` is a UUID derived from the evaluation id and the metric, so a rerun step overwrites its feedback instead of adding a second. One feedback per metric, from the sorted metric names. Only for a successful evaluation; a failed feedback call is swallowed. Never read by a decision
- volume: the free Developer plan allows 5,000 traces a month and 50,000 events an hour. A night of 72 rounds writes about 250 traces; its spans per hour are what to watch. `LANGSMITH_TRACING=false` switches all of it off

## Durable runtime on LangGraph

What the runtime must provide, and the LangGraph or Agent Server feature that provides it. The step bodies stay framework-free. LangGraph appears only in three places: the graph definitions, the step wrappers and the control operations.

Graphs, in `langgraph.json`, each an `entrypoint` of the functional API:

| graph | job |
|---|---|
| `night` | The loop: init, rounds, test evaluation, finish. Its input is the start input; a resume passes a command instead |
| `stop` | The stop cleanup ([[#Cleanup]]); the timers run it too |
| `lessons` | One distillation ([[#Lessons across nights]]) |

Experiments and evaluations are plain functions inside the `night` entrypoint that call steps, not graphs of their own. Their steps are named `<experiment or evaluation id>/<step>` (for example `n20261111-r2-e0/code`), so a trace reads like the Inngest twin's. Why not graphs of their own: the Inngest twin splits them out to stay under its per-run limits on steps and output, which a graph checkpoint doesn't have, and plain functions replay with the night.

| requirement | LangGraph | why |
|---|---|---|
| The loop survives a crash | Every step is a `task()`. Its result goes to the graph checkpoint when it finishes. Every server run CodeClimb creates (night, resume, the watchdog's resume, stop, timer, lessons) passes `durability: "sync"`, so the result is stored in Postgres within about a second of the step's end. That is not "before the next step starts": the server batches its writes, and a kill a few milliseconds after a step finished lost that step's result ([[#Platform facts]]). A rerun replays the entrypoint from the top, and every stored step returns its saved result without running. A kill therefore reruns the step that was running and at most the steps that finished in the last second; the idempotent-write rules make that rerun safe | Nights take hours |
| The night stays small | Steps return small JSON; large state stays on disk | Every step result lives in the graph checkpoint |
| Long steps | Steps run in the Agent Server's own Node process in the server container, which is long-running. The image ends a run after `BG_JOB_TIMEOUT_SECS`; the override sets it to 5 days, a day past the 4-day variation backstop, whose timer is created inside the night's run | A coder step runs up to `experiment_min` |
| Retry | Each step gets `retry` with `maxAttempts` 3 (the first attempt plus 2 retries, as on Inngest). `retryOn` returns false for CodeClimb's non-retriable error (the model check), for CodeClimb's timeout error and for an abort of the server run. The attempt number (`executionInfo.nodeAttempt`) goes to logs only: crash resume reads the state file | Drives session resume |
| A failed step doesn't fail the night | On its last attempt, or at once for a non-retriable error, a step returns its failure as data, and the step wrapper throws it in the entrypoint, where the night's code catches it. LangGraph never sees a failed task | A task that fails out of its retries fails the server run even when the entrypoint catches it ([[#Platform facts]]) |
| Backstop timeouts | CodeClimb's own timer per attempt, never `task()`'s `timeout` option: a step with that option never sees a cancel of its server run ([[#Platform facts]]). Code: `experiment_min × 3 + 30` min. An evaluation, over all its steps: `eval_min × stages × 3 + 15` min. These two are the Inngest twin's invoke timeouts. A host command: 35 min. Every other step: 30 min. A timer that fires aborts the step's signal: the coder stops as `cancelled` (sandbox destroyed) and the evaluator stops its stage. The step then throws CodeClimb's timeout error, which is not retried: the experiment or the evaluation fails and becomes an `error` outcome, as when an Inngest invoke times out | Past retries |
| One abort signal per step | Each step builds one signal from three sources: the server run's signal (`getConfig().signal`), its backstop timer and its live registry entry ([[#Crash and resume]]). It hands that signal to Pi, to sandbox execs and to host commands | Pi ignores a signal it was never given |
| Cancel a night | `runs.cancel` with action `interrupt` on each of the night's pending or running server runs, then the live registry | The server reports a cancelled run as stopped while its step may still run |
| Stop running work | The `stop` graph | One cleanup path |
| Failure = stop | The night's entrypoint catches a failure and runs the stop operation ([[#Cleanup]]) | One cleanup path |
| Pause and resume | `interrupt()` in the night's own code, between steps, with `{ pause: n, at, stops }`; `at` comes from the step that wrote `pause.json`. Resume reads `n` from the thread's pending interrupt (`threads.getState`, under `tasks[].interrupts`), then creates a server run with the command `{ resume: { pause: n } }`. A resume whose number is not the current pause is answered with another `interrupt()`. A night is paused when its newest thread holds a pending interrupt with a pause number, never by the thread's status | A human-paced wait at no cost; a stale resume can't end a later pause |
| Pause timeout, variation backstop | Timers: delayed server runs of `stop` (`afterSeconds`) on the night's timer thread. Each pause creates one due in 3 days that carries its pause number. Each variation creates one due in 4 days that carries its variation number. When a timer fires, the stop graph checks its guard first and does nothing if that pause has ended, or if that variation has ended or is no longer the newest | The runtime has no timed wait inside a run. A delayed run survives a restart and needs no other process |
| One night id, one night | The night's thread id is derived from the night id, and the thread is created with `ifExists: "raise"`. A 409 means the night is already running: the CLI follows it. Its runs use `multitaskStrategy: "reject"` | A double start starts one night |
| Lessons one at a time | One lessons thread per scenario; its runs use `multitaskStrategy: "enqueue"` | No two edits of one file |
| Crash resume | The server first: after `up`, its runs sweeper finds the run a kill left `running` and runs it again on the same server run record, about 2 minutes after `up` (it sweeps every 2 minutes); the replay returns the stored steps. Then the watchdog, for what the server can't recover | Nights take hours |
| Scores mirror | LangSmith feedback on the experiment's trace root ([[#Tracing]]) | Comparison in LangSmith |
| Traces | LangSmith tracing of the server runs (`LANGSMITH_TRACING`), plus CodeClimb's tracer ([[#Tracing]]) | One trace per experiment |

Threads:

| thread | id | metadata | runs |
|---|---|---|---|
| night | First variation: UUID v5 of `night/<night_id>`. Each continue: a random UUID | `kind: night`, `night_id`, `run` (the variation number: 0 at start, +1 per continue) | `night`, reject |
| stop | UUID v5 of `stop/<night_id>`, created if missing | `kind: stop`, `night_id` | `stop`, enqueue |
| timer | UUID v5 of `timer/<night_id>`, created if missing | `kind: timer`, `night_id` | `stop` with `afterSeconds`, enqueue |
| lessons | UUID v5 of `lessons/<scenario>`, created if missing | `kind: lessons`, `scenario` | `lessons`, enqueue |

- the UUID v5 namespace is one constant of the build. Thread ids must be UUIDs
- the night's newest thread is found by a thread search on its metadata (`kind: night`, `night_id`), newest first. Stop, resume, the timers and the watchdog use it
- a continue gets a new thread, so its steps never meet the saved results of the variation before
- delayed runs on one thread each fire at their own time, whatever the order they were created in

Watchdog. Crash recovery only. The worker API's process checks, every 60 s, every night found by files that has neither `done.json` nor `stop.json`, and reads the night's newest thread:
- the thread's status is `error`, on two checks in a row → a server run of `night` on that thread with no input. It replays from the last saved step, and the coder's state file resumes its session. At most 2 such resumes per thread; the third `error` → the stop operation, reason `failed`. A run that failed in the graph's own code already wrote `stop.json` and is never seen here. What arrives here died outside it: a crash past the server's own server-run attempts, or an error before the graph started
- no thread is found, on two checks in a row → the stop operation, reason `failed`. A thread lost with every saved step means a replay would redo finished work, so the night is stopped and can be continued instead. The dev server lost threads this way; on this server the thread is in Postgres and no loss was seen, but the rule stays as a guard
- a thread that is busy, interrupted or idle is left alone: the server owns a running run and its restarts. That covers the gap after a kill: the server picks a killed run up only with its runs sweeper, about 2 minutes after `up`, and until then the watchdog must not act on the night. Measured in night 5: in that gap the thread reads `busy`
- why two checks: a night between its failure and its `stop.json`, or between its start and the server's first write, must not be touched

Rules the loop depends on:

- a replay must take the same path: every clock read, every random choice and every I/O sits inside a step. A resumed attempt gets new step calls (named with `-resume<n>`) instead of re-entering old ones. Saved results are matched to step calls by name and order, so the order of step calls is part of the contract
- only the night interrupts; experiments and evaluations return stops
- a failure of an experiment or an evaluation is caught and becomes an outcome, so one bad experiment doesn't kill the night. The catch rethrows a graph interrupt and an abort of the server run
- an abort is recognized by the signal (`signal.aborted`), never by an error's text: the text depends on the server
- steps take plain data and return small JSON (SHAs, metrics, paths); large state stays on disk
- file writes inside steps are idempotent: rows deduplicate by `eval_id`, other files are rewritten whole
- the Agent Server holds in-memory state (the live registry, the proxy's ledgers and cache). Every graph therefore runs in the one Agent Server process that holds the disk: one server per checkout, one night at a time, with 4 concurrent runs (a night, a stop, a lessons run, a spare). A second night on the same server is not supported. Importing the graph module has no side effects beyond registering the tracer: the proxy starts on first use, and listeners and timers start inside steps
- a code change reaches the server only through a new image: `npm run server` again, which rebuilds from `ADD .` and recreates the server container. To a running night that is a kill: it reruns the running step and loses the in-memory state. `server` never passes `up --watch`: its effect on a running night was not measured, and a watch rebuild would be the same kill at a moment nobody chose
- a server restarted onto new code cannot replay a night started by older code: let running nights finish first

State the night carries across rounds: the checkpoint, feedback, failures, hypothesis, the direction, history, spend, tokens, the costliest round's spend and tokens, rounds without a keep, the costliest evaluation, the deadline, the pause count, the round, the noise and the A/A run count, the stop reason.

### Cleanup

One path for every hard stop: the stop operation.

- the caller writes `stop.json` first: the CLI (`manual`), the API (`app`), the night's failure path (`failed`), its cancel path (`cancelled`), the watchdog (`failed`). A timer has no caller: the stop graph writes `stop.json` (`failed`) once the timer's guard passes. The first stop wins
- then a server run of `stop`, in the Agent Server process, step by step, so a crash mid-cleanup resumes it:
  - cancel the night's pending and running server runs on its night threads, action `interrupt`, without waiting
  - abort the night's live registry entries
  - sweep the night's sandboxes by prefix
  - write `stop.json` if it is still missing
  - start the lessons operation for a night that didn't finish
- the stop operation never assumes a cancelled step has stopped: the server reports the run as interrupted while the step's body may still be running, so the registry abort and the sweep always follow the cancel
- the night's catch, around the whole entrypoint:
  - a graph interrupt (a pause for credits) is rethrown untouched. It travels through the entrypoint as a thrown `GraphInterrupt`, which is why there is no cleanup in a `finally`: it would fire on every pause
  - an abort of the server run with no `stop.json` means someone cancelled it from outside CodeClimb: write `stop.json` with reason `cancelled`, start the stop operation, rethrow
  - any other error, after the step's retries: write `stop.json` with reason `failed`, start the stop operation, rethrow
- the round-start stop check also reads `stop.json`: when it exists, the night ends its server run quietly and the stop graph does the rest
- a finished night sweeps its own prefix before `done.json`
- a stopped or failed night must always end with a `stop.json`, mock nights included. `run-night` only exits when it sees `done.json` or `stop.json`, so a night that died without either leaves the command, and a test run, hanging
- a night can fail before `night.json` exists (a failed model check, bundle command or init), and the stop cleanup then finds no folder. So the night's failure path, which has the start input and with it the results directory, creates `nights/<id>/` and writes `stop.json` with reason `failed` itself when `night.json` is missing, then starts the stop operation. A night with a `stop.json` and no `night.json` can't be continued or used as a seed
- `run-night` exits 0 after printing `done` or `stopped`: tests read the printed word and the files

### Platform facts

Facts of this build, measured with a throwaway graph and mock nights on the pinned packages. They are not checks to repeat, and they hold for these versions only. Three groups, by what was measured where.

Measured on the `langgraphjs up` server on 2026-11-12 (spike #27): image `langchain/langgraphjs-api:24` with API 0.17.1 (revision `5d5a744d`), CLI 1.7.1, mock nights only:

| fact | consequence |
|---|---|
| The image runs CodeClimb's TypeScript from source with `.ts` import paths: its `npm ci` and `tsx` load every graph in `langgraph.json`, and `/ok` answers. The image's schema step warns about the `night` input type (`never`) and about `pi-web-access`'s missing types; both are harmless | No build step of CodeClimb's own |
| The server boots with `LANGSMITH_API_KEY` and no license key. Without the key the container exits with code 3. The boot check goes to the key's region (`LANGSMITH_ENDPOINT`). The server also runs a metadata loop that submits to LangSmith | Mock nights and CI need a key ([[#Mock mode]]) |
| The base image has `python3` (3.12), `uv` (0.13.6) and `tar`, but no `git` and no Docker CLI. With `git` and Debian's `docker-cli` added and the host's Docker socket mounted, the container creates, runs and destroys sandboxes on the host's daemon | The image lines ([[#Deployment and environment]]) |
| With no Python pinned, uv in the container picks the newest CPython for graphrag's `requires-python >=3.14` (3.15), for which `pydantic-core` has no wheel, so the bundle command fails trying to build it. With `UV_PYTHON=3.14`, graphrag's host commands (`bundle`, `check`, `scan`) run and a mock graphrag night finishes with the same decisions as on the dev server. uv's downloaded Python and its cache live in the container's home and are lost when the container is recreated | `UV_PYTHON=3.14` in the compose override |
| A metered mock night writes its meter rows through: sandbox → `cc-meter-relay:8080` on `cc-meter` → the server container's alias on `cc-meter` → the proxy bound on `0.0.0.0` at its fixed port | [[#Metering proxy]] |
| The generated compose publishes the server's port 8000 as `<port>:8000`, on every interface of the host, and the CLI merges it after the override, so the override can add a binding but not replace this one (measured with `docker compose config`). Docker Desktop ignores a network's `com.docker.network.bridge.host_binding_ipv4` (measured on Docker 29.4.3). `up` also swallows a failed build or an exited container, and its own wait for `/ok` is 10 s and not fatal; with the stack already up, the old container keeps answering `/ok` after a failed rebuild | `server` rewrites that one line ([[#Deployment and environment]]), reads the compose status itself and polls `/ok` |
| CLI 1.7.1 honours `api_version` for the JS image: it builds from `langchain/langgraphjs-api:<api_version>-node<node_version>` | `api_version: 0.17.1` pins the image |
| The server reads `N_JOBS_PER_WORKER` (default 10) for the number of runs it executes at once; with 4 its boot log says `Starting 4 background workers` | `N_JOBS_PER_WORKER=4` in the override |
| Git in the container reads a worktree's `origin` once the checkout's git directory (`git rev-parse --git-common-dir`) is mounted at its host path and `safe.directory` is `*` (the mounted files belong to another user) | The git directory mount; the web-research guard works from a worktree |
| The `:24` base image tag floats; `up --no-pull` uses the local copy | Pin `api_version` |
| The generated Dockerfile copies the project with `ADD .` | A `.dockerignore` |
| `durability: "sync"` is honoured but not strict. With `exit`, a step that finished 8 s before a kill of the server container runs again after `up`. With `sync`, its result is in Postgres 1 s into the next step and it is not redone. But the write is asynchronous (a batching checkpointer, 5 ms batch window, its own ingestion loop): a kill issued 6 ms after a step finished lost that step, and it ran again. The bound, about 1 s, was not narrowed | A kill reruns the running step and at most the last second's results; the idempotent-write rules still apply |
| A task that fails out of its retries, inside a `try`/`catch` in the entrypoint, still ends the server run and the thread in `error`. The task calls after it do run now (on the dev server they did not), but the run's result is the error. (On the dev server, 2026-11-11: a task that fails and then succeeds on a retry is harmless) | The step wrapper's failure-as-data stays ([[#Durable runtime on LangGraph]]) |
| After a kill of the server container and `up` again, with Postgres and Redis left running, the server reruns the killed run by itself, on the same server run record, which ends `success`. It does so through its runs sweeper (`sweep_interval` 2 minutes): about 2 minutes after `up`, not at start. `up --wait` and its healthcheck return long before that | Crash resume needs no other process; the watchdog and night 5 wait for it |
| Killed mid-round 2 of a mock datenorm night, the night resumed from its last stored step: it finished by itself, every `eval_id` once, round 1's `code-state.json` unchanged, and neither round 1's nor the noise run's sandboxes were created again. Only the code step running at the kill reran. Its sandbox kept running through the outage and was replaced when the step reran | Night 5 |
| `up` prunes the killed container and creates a new one; Postgres, Redis and the project's data volume are untouched | Graph state survives a recreate; the process's memory does not |
| Image build: about 45 s cold; about 35 s after a code change (from `ADD .`) | The edit loop |

Library behaviour of `@langchain/langgraph` 1.7.3 and `langsmith` 0.12.0, measured on 2026-11-11 on the dev server; the cancel facts were measured on both servers (ADR 0002):

| fact | consequence |
|---|---|
| `runs.cancel` aborts the signal of a running step at once when the step has no `timeout` option, and the entrypoint's `catch` runs in the same instant. A step with the `timeout` option never gets the abort: it runs to its end, the entrypoint runs one more step, and only then throws | No step uses `timeout` |
| After a cancel the server reports the run `interrupted` at once, while the step's body may still be running. The abort's reason reads `interrupt` on the dev server and `Client connection prematurely closed.` on this one | Test the signal, not the text; the stop operation aborts and sweeps after it cancels |
| A resume after `interrupt()` replays the entrypoint: steps called before the interrupt return their saved results, those after it run once. The interrupt reaches the entrypoint as a thrown `GraphInterrupt`, so its `catch` and `finally` run at every pause | The catch rethrows it; no cleanup in a `finally` |
| Saved results are matched to step calls by name and call order, not by input | The order of step calls is part of the contract |
| Step calls don't count toward `recursion_limit`: 400 calls in a row pass under the default of 25 | No `recursion_limit` is set |
| A step's body gets no config argument: it reads the abort signal and `executionInfo.nodeAttempt` through `getConfig()` | |
| LangSmith: a `RunTree` with no parent, created inside a step of a traced server run, is a trace of its own. `createFeedback` called twice with one `feedbackId` stores one feedback, with the later score. A key used against the other region's endpoint gets 403 with an empty message | [[#Tracing]]; `LANGSMITH_ENDPOINT` must match the key's region |

Server behaviour measured on 2026-11-11 on the dev server only. The design still depends on it; it was not re-measured on this server (night 4 and the free suite exercise most of them):

| fact | consequence |
|---|---|
| All server runs share one Node process: a module-level map that one run sets is read by a concurrent run of another graph. This server's boot log shows one JS graphs process | The stop graph aborts the night's registry entries directly; no poll of `stop.json` is needed |
| A server run with no input on an errored thread replays: finished steps return their saved results and the failed one runs again | The watchdog's resume |
| A run created with `afterSeconds` stays pending until its time and survives a kill and a restart. Delayed runs on one thread fire in the order of their times | The timers |
| The dev server has no cron jobs | Timers are delayed runs |
| The default multitask strategy is `enqueue` | The night's runs set `reject` themselves |
| The server runs a killed run again up to 3 server-run attempts per run | The watchdog's `error` rule covers what is past them |
| With tracing on and no project in the workspace yet, the server logs "Failed to get organization ID. Tracing to LangSmith will not work". The first traced run creates the project and its trace arrives all the same | Ignore the warning |
| Not run, read from the dev server's source: `runs.cancel` parses its `wait` parameter so that any value, `0` included, means wait | Cancel without passing `wait` |

## Deployment and environment

One mode: everything on your machine. The Agent Server is LangGraph's self-hosted server, which `langgraphjs up` builds into an image and starts in Docker with its own Postgres and Redis; the sandboxes are Docker containers beside it. Decided 2026-11-12 (issue #26, ADR 0005, `docs/adr/0005-langgraph-up-server.md`, which supersedes ADR 0001). What was left out, and why:

- LangGraph's dev server (`langgraph dev`), the mode before: it keeps its state in memory, writes it to disk only after 3 quiet seconds and ignores a run's `durability`, so a kill lost finished steps and, right after a night's start, the night's thread. Removed, not kept beside this mode
- an external or shared Postgres: `up` starts its own, and the server only connects to it

What the switch fixes and what it does not: [[#Durable runtime on LangGraph]], [[#Known gaps]].

| piece | where |
|---|---|
| Agent Server | `server`: `langgraphjs up`, one compose project of three containers. `langgraph-api`, the server container: graphs, Pi, host commands and the proxy in one Node process, port 8000 inside, published on `127.0.0.1:8123`. Postgres: threads, server runs and graph checkpoints, on the project's data volume. Redis: the run queue |
| worker API + watchdog | `api`, on the operator's machine |
| CLI | `run-night`, on the operator's machine |
| app | `dev`, on the operator's machine |
| sandboxes | Docker, siblings of the server container on the Docker daemon of the operator's machine |
| proxy | Port 8090 in the server container, reached through the relay |
| LangSmith | The key is required to boot; tracing and feedback are optional, on the free Developer plan |

The server image, built by `langgraphjs up` from `langgraph.json`:

- base `langchain/langgraphjs-api:0.17.1-node24` (Node 24). The `:24` tag floats, so `langgraph.json` pins `api_version` to `0.17.1`, the version the platform facts were measured on
- `ADD .` of the checkout, then `npm ci` with lifecycle scripts off, and `tsx` loading the graphs
- extra image lines (`dockerfile_lines`): `git` and Debian's `docker-cli` from apt, `git config --system --add safe.directory '*'`, and `ENV NPM_CONFIG_IGNORE_SCRIPTS=true`. `python3`, `uv`, `tar` and `bash` come with the base image
- `.dockerignore`: `**/.env*` except `.env.example`, `.git`, `**/node_modules`, `.claude/worktrees`, `runs`, `runs-langchain`, `web/.next`, `.langgraph_api`, `**/.venv`, `**/__pycache__`. Without it the keys, the night output, the host's own native modules and, in the main checkout, every worktree would go into the image
- `env: ".env"`: the server container gets the `.env` keys. The path must resolve inside the project

The compose override, `docker/langgraph-up.compose.yaml`, named in `langgraph.json`'s `docker_compose_file`. The CLI merges it into its own compose file, so it adds to the `langgraph-api` service. Adding it and changing `langgraph.json` touched given inputs, with the operator's go-ahead (ticket #29); a further change needs it again.

- mounts: the host's Docker socket (`/var/run/docker.sock`); the checkout at its own host path (`CODECLIMB_HOST_ROOT`), so an absolute path in a night's input names the same file on both sides; the checkout's git directory read-only at its host path (`CODECLIMB_HOST_GIT_DIR`: a worktree's `.git` is a file naming a directory outside the checkout); Pi's `auth.json` (`CODECLIMB_HOST_PI_AUTH`) read-write at `/pi/auth.json`, since Pi writes refreshed subscription tokens back in place (read from Pi's source, not exercised: mock nights). Pi's lock directory beside the file lands in the container, so a refresh there is not locked against a Pi on the host; the volume `uv` at `/uv`
- environment: `CODECLIMB_ROOT` = `CODECLIMB_HOST_ROOT`; `CODECLIMB_PI_AUTH_PATH=/pi/auth.json`; `CODECLIMB_SERVER_URL=http://127.0.0.1:8000` (the graphs call the server they run in); `CODECLIMB_PROXY_HOST=0.0.0.0` and `CODECLIMB_PROXY_PORT=8090`; `CODECLIMB_RELAY_TARGET=codeclimb-server`; `N_JOBS_PER_WORKER=4` (the 4 concurrent runs); `BG_JOB_TIMEOUT_SECS=432000` (5 days: a night's run outlives the variation backstop); `UV_PYTHON=3.14`, and `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR` and `UV_PROJECT_ENVIRONMENT` under `/uv`, so uv's Python and cache survive a container recreate and the container's Linux venv never replaces a scenario's own `.venv` in the checkout. The one project environment serves every uv scenario in turn: uv re-syncs it when the scenario changes
- networks: the project's default network (Postgres, Redis) and the external network `cc-meter`, with the alias `codeclimb-server`
- the published port: `127.0.0.1:8123` only. The override cannot replace the CLI's binding ([[#Platform facts]]), so `server` puts its own `docker` first on `PATH` for `up` (`src/cli/server-docker/docker`): it rewrites the `<port>:8000` line of the compose file `up` pipes on stdin to `127.0.0.1:<port>:8000` and passes every other call to the real `docker` unchanged. After `/ok` answers, `server` checks the container's published port and stops the stack when it is bound beyond loopback

Commands:

- `npm run server` (`src/cli/server.ts`): checks that `.env` exists; sets `CODECLIMB_HOST_ROOT`, `CODECLIMB_HOST_GIT_DIR` and `CODECLIMB_HOST_PI_AUTH` (creating a missing `auth.json` as `{}`, as Pi does, since Docker would otherwise create a directory in its place); creates `cc-meter` when it is missing (an external network must exist before `up`); runs `langgraphjs up --port 8123 --no-pull --wait` with its `docker` first on `PATH`, which records the status of `docker compose up`; fails when that status is not 0 (a failed build: an old container would still answer `/ok`); then polls `/ok` for up to 5 minutes and fails when the server container exits or the deadline passes. Run it again after a code change: it rebuilds the image and recreates the server container, which to a running night is a kill
- `npm run server:logs`: follows the server container's logs (`docker compose logs --follow langgraph-api` on the project)
- `npm run server:stop`: `docker compose down` on the project. Without `-v` Postgres keeps every thread; with `-v` they are gone, and so is every night's crash resume. `server` never passes `up --recreate`, which recreates the volumes too
- the compose project's name is the CLI's: the checkout folder's name and the sha256 of its path, both lowercased; the server container is `<project>-langgraph-api-1`

Environment:

- env file: one `.env` (gitignored; `.env.example` lists every key), loaded first by the CLI and the API (from the directory they start in, then from `CODECLIMB_ROOT` when that is another one), and named in `langgraph.json`'s `env` for the server container. Values already in the shell win
- `LANGSMITH_API_KEY` is required: without it the server does not start. With `LANGSMITH_TRACING=false` nothing is traced; mock nights and CI run that way, with a key
- the machine stays on until the night ends; on macOS it must not sleep: `server` starts a detached `caffeinate -i docker wait <server container>`, which keeps the Mac awake as long as the server container runs and ends with it
- a sandbox keeps running while its server is away
- the app, the API and the Agent Server's published port bind loopback only by default. Inside its container the server and the proxy bind every interface: only the compose project's network and `cc-meter` reach them
- one server per machine for metered nights: the relay is shared ([[#Known gaps]])

| variable | meaning |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY` | Provider keys, read by Pi; the proxy and the model check read `OPENROUTER_API_KEY` themselves. `OPENAI_API_KEY` is the embeddings key when Pi resolves none for `openai` |
| `CODECLIMB_PI_AUTH_PATH` | Another `auth.json`; in the server container `/pi/auth.json`, the mounted one |
| `LANGSMITH_API_KEY` | Required to boot the server; tracing and feedback |
| `LANGSMITH_TRACING`, `LANGSMITH_PROJECT` | Tracing on or off; the project the traces land in, `codeclimb` |
| `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID` | The API endpoint, which must match the key's region (`https://eu.api.smith.langchain.com` for an EU key); the workspace when the key reaches more than one |
| `CODECLIMB_SERVER_URL` | Where the CLI, the API and the graphs reach the Agent Server (default `http://127.0.0.1:8123`; in the server container `http://127.0.0.1:8000`) |
| `CODECLIMB_HOST_ROOT` | The checkout's absolute path on the host, set by `server`; mounted at the same path in the server container |
| `CODECLIMB_HOST_GIT_DIR`, `CODECLIMB_HOST_PI_AUTH` | Set by `server` for the override: the checkout's git directory and the host's `auth.json` |
| `N_JOBS_PER_WORKER` | Runs the server executes at once: 4 |
| `BG_JOB_TIMEOUT_SECS` | The server's run time limit: 432000 (5 days) |
| `CODECLIMB_ROOT` | The checkout the server resolves config paths and `runs-langchain/` against (default: its working directory; in the server container `CODECLIMB_HOST_ROOT`) |
| `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT` | The worker API (default `127.0.0.1:7421`) |
| `CODECLIMB_WORKER_TOKEN`, `CODECLIMB_WORKER_URL` | The API's bearer; where the app reaches the API |
| `CODECLIMB_PROXY_HOST`, `CODECLIMB_PROXY_PORT` | Where the proxy binds; in the server container `0.0.0.0` and 8090 |
| `CODECLIMB_RELAY_TARGET` | Where the relay forwards: the server container's alias on `cc-meter`, `codeclimb-server` |
| `UV_PYTHON` | uv's Python for the host commands in the server container: 3.14 |
| `UV_PYTHON_INSTALL_DIR`, `UV_CACHE_DIR`, `UV_PROJECT_ENVIRONMENT` | uv's Python, cache and project environment in the server container: `/uv/python`, `/uv/cache`, `/uv/venv` on the `uv` volume |

Language: TypeScript on Node 24, ESM, run from source with `tsx` (the Agent Server loads the graph module itself, in the image); `tsc` for types; Node's test runner for unit tests of the pure parts (keep rule, stops, schema, flattening, metering, lessons ops). Next.js and React for the app, `yaml` for configs, `node:http` for the API and the proxy. The graphs are a separate app from the Next.js one, so Pi's native dependencies stay out of its bundle. Scenario code: any language behind the contract.

## Every number in one place

| area | constant | value |
|---|---|---|
| config | `plateau_rounds`; thinking coder / reviewer | 3; `medium` / `low` |
| config | `min_efficiency_gain` | 0.10 |
| config | `noise_margin` `min` / `max` | 0.002 / 0.005 |
| loop | smoke test | 7 tries, 5 min apart |
| loop | A/A runs per night | at most 2 |
| loop | repairs per round | 1 |
| loop | held-out names in a diff that block a keep | ≥ 2 |
| loop | keep comparison epsilon | 1e-12 |
| loop | pause timeout; variation backstop | 3 days; 4 days |
| runtime | step attempts | 3 (2 retries) |
| runtime | backstop timers per attempt | code `experiment_min × 3 + 30` min; an evaluation `eval_min × stages × 3 + 15` min; host command 35 min; other steps 30 min |
| runtime | concurrent runs (`N_JOBS_PER_WORKER`) | 4 |
| runtime | server run time limit (`BG_JOB_TIMEOUT_SECS`) | 5 days (432000 s) |
| runtime | durability; a step's result stored | `sync` on every server run; within about 1 s of the step's end |
| runtime | runs sweeper: a killed run restarts after `up` | about 2 min (sweep every 2 min) |
| runtime | server-run attempts after restarts | 3 on the dev server; not re-measured on this server |
| runtime | watchdog interval; checks before it acts; resumes per thread | 60 s; 2; 2 |
| coder | reserve | the last 20% of time or budget |
| coder | send-backs | at most 8; none with < 3 min left |
| coder | idle watchdog | 10 min quiet; 25 min with a silent tool; checked every 30 s |
| coder | default bash timeout | 10 min |
| coder | Pi retries; compaction | 4; on |
| coder | research share of the time | at most a fifth |
| coder | notes | 20 lines asked; 3,000 characters kept |
| coder | `APPROACH`; unchanged closing message | 300; 1,000 characters |
| coder | fresh restarts after a lost sandbox | 1 |
| memory | trajectory budget | 48,000 characters |
| memory | note heading reason; error reason in a history line | 300 characters each |
| evaluator | environment build; reset; git helper | 3 min; 2 min; 2 min |
| evaluator | host command timeout / output | 30 min / 64 MiB |
| evaluator | error tail | 2,000 characters |
| reviewer | per-item errors per stage | 70,000 characters |
| reviewer | run log per stage | 4,000 characters, half at most for flagged lines |
| reviewer | diff; checkpoint source | 60,000 characters each |
| reviewer | tasks; train measurements | 4,000 characters each |
| reviewer | hypothesis; verdict | at most 4 changes; at most 8 lines |
| reviewer | JSON retries; leak rewrites | 1; 1 |
| lessons | lessons; lines; lesson; heading | 30; 200; 500 characters; 80 characters |
| lessons | near-duplicate overlap; wrap width | 0.5; 100 columns |
| lessons | rewrites; prune rounds | 1; 2 |
| proxy | request body | 16 MiB |
| proxy | coder retry window | 5 s |
| proxy | OpenRouter call timeout; model check timeout | 5 min; 30 s |
| proxy | embeddings prices per million tokens | 0.02 (small), 0.13 (large) |
| ports | Agent Server published on `127.0.0.1`; Agent Server inside its container; worker API; relay; proxy in the server container | 8123; 8000; 7421; 8080; 8090 |
| server image | base image; `api_version`; uv's Python for host commands | `langchain/langgraphjs-api:0.17.1-node24`; 0.17.1; 3.14 |
| server | wait for `/ok` after `up` | 5 min |
| sandbox | size | 2 vCPU and 2 GiB |
| API | stale after; request body | 60 min; 1 MB |
| app / CLI | polling | night 5 s; list 10 s; CLI follow 5 s |
| git | starter commit date | 2026-01-01T00:00:00Z |
| rounding | latency ms / s; cost; spend | 3 / 6 decimals; 9 decimals; 4 decimals |

Scenario numbers (thresholds, budgets, timeouts, models) live in `configs/*.yaml`, not here.

## Known gaps

- a hard-stopped night has no test score; "finish now" would need a stop at the next round
- `eval_min` limits a slow program: on the Inngest twin, at 16 minutes per stage, one extraction timed out. The coder's to fix; the reviewer reads why
- `scan` and `check` find copies, not paraphrases or encodings; the reviewer still reads the diff
- proxy: no streaming, tools or non-text chat; operation attribution assumes one operation at a time; one night per server, because two would share `cc-meter` and the single replay cache
- one relay for every server: `cc-meter-relay` forwards to one server at a time. Two servers running metered nights on one machine (another checkout's, or the old dev server) recreate it in turn, each breaking the other's path until its next check. The relay test of `npm test` recreates it while it runs, with the same effect on a running night; at its end it puts back the relay it found, with that relay's port and target labels, or the default target `host.docker.internal` when the found relay has no target label (a relay from before the target label) ([[#Open points for the build]])
- sandboxes have open egress: only the missing keys keep a program from a model, as on the Inngest twin
- a failed night start needs a new night id (its thread exists)
- the model check finds missing keys, not wrong ones: a bad key fails the first call as `agent_error`
- one A/A pair is one sample; `min` and `max` bound it
- no remote orchestration: while the Agent Server is down, nothing runs. The night resumes from its last stored step once the server is back
- a killed night waits for the runs sweeper: the server picks its run up about 2 minutes after `up`, not at start. Nothing is lost in the wait; the night only starts later
- an interrupted step reruns from its start: durability is per step, not exactly once. A kill reruns the step that was running (a coder step on a new sandbox, its model calls paid again), and possibly one that finished within about a second before the kill, since `sync` stores a result asynchronously. The idempotent-write rules make the rerun safe, not free
- in-process memory is lost on a crash: the proxy's ledgers and replay cache and the live registry. The rerun steps open new tokens and register again. Expected, not measured: the calls a killed evaluation made before the kill are paid but in no ledger, so spend under-counts them; and the cache starts empty, so an evaluation after the crash replays nothing from before it, which makes its calls fresh and its noise margin wider
- a code change needs `npm run server` again, which recreates the server container: to a running night that is a kill
- the server does not boot without a LangSmith key, so mock nights and CI need one
- the watchdog (crash recovery past the server's own server-run attempts, and the lost thread) runs only while `api` runs. The pause timeout and the variation backstop don't need it
- the mock coder stops at once on every turn, so a mock session holds the full 8 send-backs and one wrap-up. With a 5-minute experiment and the 3-minute floor, all of them must start within the first 2 minutes
- four requirements the Inngest reference build misses are part of this spec as well:
  - finding mock nights under `runs-langchain/mock/`
  - the failure path writing `stop.json` before `night.json` exists
  - picking the Linux bridge address (off the metering path in this mode, where the relay reaches the server container by name)
  - a pause end that is safe to retry
- kept as the Inngest twin has them, so the two builds behave the same:
  - a repair's leak scan covers only what `e1` adds over `e0`, so held-out names a failed attempt added and its repair kept are not counted
  - a stop or a pause timeout leaves `pause.json` behind, so a night continued afterwards reads as paused until its next pause ends
  - the sweep prefix `cc-<night>` of a night `a1` also matches a night `a10`; default ids don't collide
- gone on this stack: the Inngest twin's dropped second lessons event. Runs are not deduplicated, and the distillation's own skip makes a repeated run harmless

## Open points for the build

Tickets #26 to #32, the move to `langgraphjs up`, are closed, and what they settled is written into the sections above. These points they left unmeasured or undecided; none is a fact yet.

- image and compose: `langgraph.json`'s `env` must resolve inside the project, so a git worktree needs its own `.env` (a symlink to the main checkout's works; `server` stops when there is none)
- metering:
  - two servers flipping the shared relay ([[#Known gaps]])
  - the Linux bridge-address bind and the host-gateway alias, off the path and kept as the defaults outside the server container. A removal needs the operator's go-ahead
  - sandboxes on `cc-meter` can reach every port of the server container, the Agent Server's API on 8000 included: whether to narrow that
- durability:
  - the server's run time limit, 5 days (`BG_JOB_TIMEOUT_SECS=432000` in the override; the image's default is 24 h): no run has reached it
  - the server-run attempt count: the image's `BG_JOB_MAX_RETRIES` is 3 (read from its config, not measured); whether a sweeper rerun counts as one was not measured
  - the bound on `sync` storage, about 1 s, not narrowed
  - the dev-server-only facts in [[#Platform facts]], not re-measured on this server
  - the step wrapper's workarounds (the final failure returned as data, the own-failure marker, the own backstop timers): all three kept; any removal needs the operator's go-ahead
- the suite:
  - night 5's timing margin: the kill comes as round 2's code step starts, a second or two after round 1's last steps finished, close to the ~1 s `sync` lag. A late round-1 result lost in the kill would rerun and could fail the "no `cc-<id>-r1-` sandbox" check
  - a LangSmith key for CI
  - a failing `scan` in the check step: nothing catches it there, so the step fails and, out of its retries, so does the night (read from the code; the graphrag night's `check.json` shows both commands ran, but a failing `scan` was not tried)

## Suggested build order

1. Scenario contract and config: parse, validate, placeholders, host commands, report flattening, the keep rule, stops, the row schema (all unit-testable)
2. Experiment repository, the sandbox interface, the Docker backend, bundle transfer
3. Pi sessions with sandbox tools, mock models, the coder with its end-of-experiment commit
4. Evaluator with standard metrics; the metering proxy with the relay and the replay cache
5. The night graph on `server`: steps, experiments and evaluations, record, review, notes, test eval, `done.json`; then mock nights 1 and 2
6. Control operations, the stop graph, the timers, the watchdog, crash resume, pause and resume; then mock nights 3 to 6
7. Noise run, repair, send-backs, trajectory, continue, seed, rescore, lessons; then mock night 7
8. Worker API, app, export, tracing and feedback

## Follow-ups for both specs

Changes to stack-neutral parts that the Inngest twin does not have yet. Until it does, these are the only places where the two specs differ outside the declared differences:

- the done signal's nights 3 to 7 (plateau, stop mid-round, kill and restart, lost connection, graphrag-smoke) and the configs under `configs/e2e/`
- `--mock-offline N`, and the rule that a turn ended by a failed model call is sent back like any other stop
- the round-start check of `stop.json`, listed in the round loop
- the word "savepoint" for the coder's own commits. The prompts and messages still say "checkpoint" for them ("commit a checkpoint in the sandbox", "restore the checkpoint"); they change in both specs together
