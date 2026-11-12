# CodeClimb on Inngest — Build Spec (System 1)

- what CodeClimb is: an optimization loop where a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. Nothing is fine-tuned or trained
- this file: everything needed to build CodeClimb from scratch on the Inngest stack. It states architecture, contracts, features and numbers; it holds no code. As built in `~/Documents/01-Projects/codeclimb` at commit `e384bb5` (2026-11-11), branch `main`
- use: handed to a coding agent that builds the whole application alone, with zero human input (the layer-2 benchmark of [[codeclimb-eval-spec|codeclimb-eval-spec]]). The twin for the other stack: [[codeclimb-spec-langchain|codeclimb-spec-langchain]]
- stack-specific parts: [[#Durable runtime on Inngest]], [[#Deployment and environment]]. Everything else is stack-neutral
- scenario used for real nights: [[graphrag-spec|graphrag-spec]]. Background: [[autoresearch-coding-framework-fit|autoresearch-coding-framework-fit]], [[agent-observability-harness-support|agent-observability-harness-support]]

## Goal and done signal

Build the application so that a **night** (one run of the loop) works end to end: durable functions, sandboxes, coding-agent sessions, commits, evaluations, the review, the test evaluation and the result files.

You are done when the end-to-end tests pass. They run three mock nights, one after the other, on the local dev server with Docker sandboxes:

- `npm run run-night -- --config configs/capitals-smoke.yaml --mock`: the program calls a model through the metering proxy
- `npm run run-night -- --config configs/datenorm-smoke.yaml --mock`: two rounds; round 1 is kept, a noise run follows, the review hands its hypothesis to round 2; no metering
- `npm run run-night -- --config configs/graphrag-smoke.yaml --mock`: the multi-stage night: two rounds on a scenario with three stages (`extraction`, `graph`, `retrieval`), a metered program, a repository check, host commands through `uv`, a repair, and lessons at the end

Each night writes to `runs/mock/<config-name>/`. For a night `<id>` of `capitals-smoke` or `datenorm-smoke`, all of these must hold:

| check | contract it depends on |
|---|---|
| `run-night` prints `done`, with `stop_reason` `max_rounds` or `thresholds` | [[#CLI]], [[#Stops]] |
| `nights/<id>/done.json` exists; `stop.json` and `pause.json` don't | [[#Files a night writes]] |
| `npm run validate-results -- runs/mock/<name>/results.jsonl` passes | [[#Result row]] |
| `results.jsonl` has a row per experiment of every round, plus a `test` row | [[#Round loop]] |
| `git -C runs/mock/<name>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit; its diff adds `MOCK.md` | [[#Mock mode]], [[#Experiment repository]] |
| `exps/*/code-state.json` has `stop: done`; `exps/*/session/` holds a session file | [[#Coder]] |
| `reviews/r<n>.json` exists for every round, with `feedback: mock feedback` | [[#Reviewer]] |
| `exps/*/train-score.json` and `exps/*/tasks.json` exist; the session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code") | [[#Send-backs, reserve and wrap-up]] |
| `bundle/history/notes/r<round>-e<n>.md` per experiment, with a `mock note` coder part and, where reviewed, a `mock verdict` reviewer part | [[#Notes, trajectory and rejected diffs]] |
| every experiment row has `decision_reason` | [[#Keep rule]] |
| `datenorm-smoke`: round 1's commit holds the starter's code, which scores above 0 on dev (accuracy 0.125), so it is kept; a `noise` row follows in round 2 and `noise.json` exists. `capitals-smoke` scores 0 and keeps nothing | [[#Noise margin]] |
| `done.json` has `spend_usd: 0` | [[#Mock mode]] |
| `capitals-smoke`: `evals/*/meter.jsonl` lists the program's calls, none with `error` | [[#Metering proxy]] |
| `docker ps` shows no `cc-<id>` container | [[#Cleanup]] |

The third night, `graphrag-smoke`, has its own checks, because a dev evaluation of it may fail. As built, it always does: the canned chat answer `mock` gives the extraction stage no rows, so every dev evaluation stops at `extraction` with "the run exited clean but wrote no output", each round's `e0` gets a repair `e1`, both are recorded as `error` (`not scored`), nothing is kept, and the test evaluation scores the starter on all three stages. The night takes under a minute. The checks hold with or without the failure and the repair.

From the table above, these rows hold unchanged: `run-night` prints `done`, `done.json`, `validate-results`, the mock commit of `r1-e0`, `code-state.json` and the session file, the reviews, `decision_reason`, `spend_usd: 0` and `docker ps`. These replace the others:

| check | contract it depends on |
|---|---|
| `results.jsonl` has an `e0` experiment row for every round and exactly one `test` row. A round has an `e1` row only after an `e0` row with decision `error`; no round has an `e2` | [[#Round loop]], [[#Repair]] |
| every `e0` session holds eight send-backs, then one wrap-up; an `e1` session holds neither. `train-score.json` and `tasks.json` exist for both | [[#Send-backs, reserve and wrap-up]], [[#Repair]] |
| `bundle/history/notes/r<round>-e<n>.md` per experiment, with a `mock note` coder part; the `mock verdict` reviewer part is on the note of the round's last experiment | [[#Notes, trajectory and rejected diffs]] |
| every experiment has `exps/<exp>/check.json` with an empty `errors` list | [[#How a scenario is loaded]] |
| every evaluation, dev and test, has `evals/<eval>/extraction/inputs.jsonl` with 8 lines (one per document of the split) and `extraction/run.log` | [[#Evaluator]] |
| the test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json` | [[#Evaluator]], [[#Splits]] |
| `metrics.json` exists for the test evaluation and for a dev evaluation only when every stage was scored. A dev row that was not scored holds the primary metric at 0 and nothing else | [[#Evaluator]], [[#Result row]] |
| the `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `extraction.…`, `graph.…` and `retrieval.…`, with `<stage>.output_bytes` for each. Every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`) | [[#Stage reports become metrics]], [[#Standard metrics]] |
| every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0 | [[#Metering proxy]], [[#Mock mode]] |
| `noise.json` and a `noise` row exist only if a round was kept | [[#Noise margin]] |
| within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged | [[#Lessons across nights]], [[#Mock mode]] |

Mock metrics mean nothing: a score of 0 is expected. The checks prove that everything ran. A coder or review failure falls back quietly in some paths, so the files above are the evidence, not `stop_reason` alone.

Also required, though the mock nights don't reach them: real-model nights, stop, pause and resume, continue, seed, applied lessons, export, the worker API and the app. Build them to this spec.

## What you get, what you build

Given, unchanged by you:

- `scenarios/<name>/`: `datenorm`, `datenorm-hard`, `capitals`, `graphrag`. Each holds its manifest, starter repo, agent spec, gold data, evaluators and scripts
- `configs/*.yaml`: `capitals-smoke`, `datenorm-smoke`, `datenorm`, `graphrag-smoke`, `graphrag`
- credentials: one `.env` (gitignored, from `.env.example`) holding the provider keys; Pi's `auth.json`
- Inngest skills, MCP servers and docs; Pi's docs; the end-to-end test instructions
- comments in the pack that name files you don't have (a `docs/` page, a source path) are leftovers: this spec replaces them

You build everything else. Source layout is yours. These external contracts are fixed, because the tests and the operators use them:

- npm scripts: `dev:inngest` (Inngest dev server), `worker`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `export`, `lessons`, `dev`, `build`, `start` (the app), `typecheck`, `test` (unit tests)
- Docker images:
  - `codeclimb-python` (every Python scenario): Python 3.14 slim, `git`, CA certificates, `uv` 0.13.5; system git identity `codeclimb` / `codeclimb@localhost`, default branch `main`, every directory safe; workdir `/repo`; `PYTHONDONTWRITEBYTECODE=1`, `UV_PYTHON_PREFERENCE=only-system`, `UV_PYTHON_DOWNLOADS=never`; command `sleep infinity`. It needs `bash`, `setsid`, `tar` and `python3`. Gold, evaluators and keys never enter an image
  - `codeclimb-graphrag`: `codeclimb-python` plus `scenarios/graphrag/requirements.txt` installed system-wide with `uv pip`; build context `scenarios/graphrag`
- host tools: Node 24, Docker, `git`, `tar`, `bash`, `python3`, `uv` (graphrag's host commands run through it)
- everything in [[#CLI]], [[#Files a night writes]], [[#Result row]], [[#Worker API]] and [[#Deployment and environment]]

Dependencies, pinned to exact versions. These are the versions this spec's SDK facts hold for:

| package | version | note |
|---|---|---|
| `@earendil-works/pi-coding-agent` | 1.3.0 | The Pi SDK |
| `@earendil-works/pi-ai` | 1.3.0 | The version the SDK itself depends on, so one copy installs. Source of the scripted (faux) provider. Two copies break mock mode |
| `pi-web-access` | 0.47.0 | Web research. Its extension is the default export of the package's built entry file; it ships no types |
| `inngest` | 4.25.0 | `inngest/connect` for the worker; `inngest/experimental` for extended traces and scores |
| `@inngest/otel` | 0.2.2 | Preloaded with Node's import flag by `worker` only |
| `@opentelemetry/api` | 1.10.0 | Used directly for spans |
| `next`, `react`, `react-dom` | 16.4.2, 19.3.1, 19.3.1 | The app only |
| `yaml`, `tsx`, `typescript` | 2.9.1, 4.23.15, 6.0.3 | |

- `worker`, `run-night` and `dev` set `INNGEST_DEV=1`
- `dev:inngest` runs the Inngest CLI's dev command through `npx`, with install scripts allowed for that package (it downloads its binary in one)
- install with lifecycle scripts off

## Components

| component | job | runs on |
|---|---|---|
| CLI (`run-night`) | parse and validate the config, check models, send start / stop / resume / continue, follow `results.jsonl` | your machine |
| worker | durable functions, Pi sessions (coder, reviewer, lessons), the scenario's host commands, worker API, metering proxy. One long-running process | your machine |
| durable runtime | runs the night loop: memoized steps, child runs, cancel, wait-for-event. It never runs CodeClimb's code itself: it calls the worker | Inngest dev server |
| sandboxes | the coder's shell and files; the program under evaluation | Docker |
| metering proxy | the only path from a program to a model; holds the keys, meters every call, replays repeated calls | worker, `/v1` |
| worker API + app | read nights, stop, resume, continue, export. The app is one client of the API; it never runs Pi or sandboxes | worker; Next.js on `127.0.0.1` |
| experiment store | `experiments.git` + `results.jsonl` + `nights/<id>/`, the source of truth. No database | worker's disk |

Data flow of one round:

1. the durable parent run holds the night config and the loop. Each round starts with the smoke test and, on the first scored checkpoint, the A/A noise run
2. coder child run: a sandbox holding the checkpoint and `/spec`, driven by Pi on the worker. Its result is one commit, moved as a git bundle into `experiments.git`. Then, on the host, the repo check and the diff leak scan
3. evaluator child run: per stage, inputs (host) → run (sandbox) → score (host) → metrics
4. keep rule: the weighted score against the checkpoint's plus the noise margin → keep or revert. A commit that failed before scoring gets one repair attempt, then the decision again
5. reviewer (Pi on the worker): feedback, the next hypothesis, a verdict
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

- the night config's `scenario` names a directory. The CLI parses its `scenario.yaml` once, validates it, and embeds the parsed scenario in the config that travels in the start event
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
| `check` (opt) | Host: reads the commit's files in `{repo}` (a temporary checkout), writes a JSON object to `{report}` with two lists of strings, `errors` and `notes`. Errors block evaluation; notes go to the reviewer. Saved as `exps/<exp>/check.json` |
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
- CodeClimb passes `{split}` to the stage commands: `dev` every round, `test` once per run after the night stops. It never passes `train`
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
| `sandbox` | required | `docker` |
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
- `deadline` must parse; `standard_metrics.latency_metric` starts with `latency_`, `cost_metric` with `cost_`
- relative paths in a config (`scenario`, `results_path`) resolve against the directory `run-night` is started in, not the yaml's folder
- the config travels in the start event with paths relative to the checkout; the worker resolves them against `CODECLIMB_ROOT` (default: its cwd). CLI and worker may run from different directories on one machine, as long as both resolve the same results directory: following, continue and seed read it from the CLI's side
- results directories must sit directly under `<root>/runs/` (or `<root>/runs/mock/` for mock nights): the API and the stop cleanup find a night by scanning there
- models are checked on the CLI and again on the worker with its own credentials (a non-retriable failure of the night's first step). For a Pi model: it is in Pi's model runtime, its provider has credentials, and it is in the provider's list of models available to the account. The check finds missing models and keys, not wrong keys. `openrouter/` entries of `allowed_models` are checked through OpenRouter's per-model endpoints API instead (ready only when it lists at least one endpoint), because its model list omits some callable models; the priced embedding models are left out of the Pi check too

## CLI

`run-night` loads the env file first ([[#Deployment and environment]]).

| command | does |
|---|---|
| `run-night --config <yaml> [--night-id ID] [--sandbox docker] [--seed ID\|latest\|best] [--direction TEXT] [--rounds N] [--no-wait] [--mock]` | Starts a night and follows it |
| `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N]` | More rounds on an ended night; default: the newest ended night under the config's results |
| `run-night stop --night ID` | Hard stop |
| `run-night resume --night ID` | Ends a pause for credits |

- night id: `--night-id`, else `n<YYYYMMDD>-<HHMMSS>` from local time. A valid id is 1 to 48 letters, digits or hyphens, not starting with a hyphen
- `--rounds` on a new night replaces `max_rounds`. `--no-wait` starts the night and exits without following
- a night always runs on Docker: a config's `sandbox: inngest` is turned into `docker`, with a printed note
- following: every 5 s print new rows of the night (round, kind, split, short experiment id, primary metric, decision, spend, hypothesis); print `done` with `done.json` and exit when it appears; print `stopped` with `stop.json`; print where a pause stopped and how to resume. Ctrl-C detaches; the night keeps running
- `--direction` on a new night sets the operator's direction for every round, as on a continued one. It travels in the start event and is masked with `scan` in a step of its own, right after init
- `--seed` never with `continue`

### Mock mode

`--mock` runs the same night on scripted models: Inngest, sandboxes, Pi sessions and tools, commits, evals, the proxy, the keep rule and every file are real. No provider is called, so it costs nothing and needs no credentials.

- results go to `runs/mock/<name>/`: the results directory's name moved under a `mock` sibling (`runs/datenorm-smoke/…` → `runs/mock/datenorm-smoke/…`)
- models: pi-ai's faux provider, registered as a native provider on the worker's one Pi model runtime, with provider id `mock` and one model per role: `coder`, `reviewer`, `lessons`. A mock session takes its model object from the faux provider, not from a `<provider>/<id>` lookup. Faux models cost 0
- the faux provider's response queue is shared by every session and gives up one entry per model call; an empty queue answers with an error. So queue a response factory that puts itself back on every call, with a head start of several entries for concurrent sessions; never a fixed list. The factory picks its reply by the model's id:

| role | scripted reply |
|---|---|
| coder | When the last message is a tool result: the closing text `APPROACH: mock change, no real work`. Otherwise one `bash` tool call, with stop reason tool use. Its command appends a timestamped line to `MOCK.md` (so every turn changes the tree), and writes `/tmp/tasks.json` (one task with status `done`), `/tmp/notes.md` (the text `mock note`) and `/tmp/train-score.json` (`before` and `after`, each holding one numeric metric, plus `command`). Every prompt is answered this way, send-backs and resumes included |
| reviewer | A JSON object: `feedback` = `mock feedback`, `hypothesis` = `mock hypothesis`, `verdict` = `mock verdict` |
| lessons | A JSON object with an empty `ops` list |
- program calls get canned answers at zero cost: chat `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0
- skipped: the model checks, the round-start smoke test, web research (it would reach the real web); lessons are never applied

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

Work that reruns after a pause gets a new child-run identity ending `-resume<n>`. An experiment keeps its id and sandbox name; a rerun evaluation keeps its `eval_id` but runs on a new sandbox, `cc-<night>-r<N>-eval-resume<n>`.

### Init

- build the bundle with the scenario's `bundle` command into `nights/<id>/bundle/`. The command refuses a non-empty target, and a retried init or a continue finds one. So: move an existing `history/` aside, delete the bundle folder, run the command, fail if it wrote no `spec/`, move `history/` back
- import `starter/` into `experiments.git` as `<night>-r0-starter`, or alias the seed's commit as `<night>-r0-seed`
- compute the deadline; write `night.json`
- the starter is never run: it has no metrics and a weighted score of 0

### Round loop

Each round, in order:

1. **Stop check** ([[#Stops]]). Soft: between rounds only
2. **Smoke test.** Before money goes into the round: the same model check as at night start (each model exists, has credentials and is on the account's plan; no paid call) and, for a metered night, the proxy's URL reaches the proxy. A failure is retried every 5 minutes, 6 more times; then the night stops with `outage`. Why: an outage would spend the coder's budget on a round that can't be scored
3. **Noise run**, when due ([[#Noise margin]])
4. **Code.** A coder child run on a fresh sandbox from the checkpoint ([[#Coder]]). It commits `/repo` as one commit
5. **Check and leak scan** (in the coder child, on the host). The scenario's `check` on the commit; then `scan` on the lines the commit adds. Both skipped with no commit, on a credit stop, or when the commit's files equal the checkpoint's
6. **Evaluate on dev** in an evaluator child ([[#Evaluator]]). Skipped with no commit, with `check` errors, or with unchanged files. The checkpoint is not run again: its stored dev metrics are the reference
7. **Decide** ([[#Keep rule]])
8. **Repair**, at most one per round ([[#Repair]])
9. **Review** ([[#Reviewer]]). Always, also of a reverted experiment and in the last round: its feedback is what the next round, or a continued night, learns. A failed review keeps the last feedback and hypothesis and leaves the verdict empty; it never kills the night
10. **Record.** Append the row, with the review's cost and time
11. **Learn**, in this order (the order is part of what a replay must repeat):
    - add the round's spend and tokens; reset or raise the count of rounds without a keep; remember the costliest evaluation
    - append the round's log entry
    - write the experiment's note
    - add the masked history line
    - save the rejected diff, if the round kept nothing and changed code
    - set the next round's feedback, masked failures and hypothesis
12. **Keep.** A kept experiment becomes the checkpoint
13. **Thresholds.** If every threshold metric of the checkpoint is present and ≥ its target, stop with `thresholds`

After any soft stop: score the checkpoint on test, on its own evaluator, for the report only. Then finish: the test row, a final sweep of the night's sandboxes, `done.json`, and the lessons event. Test never drives a decision. A hard-stopped night has no test score.

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

Hard stops: the stop event (CLI, app), a night run that fails out of retries, and the 4-day run backstop. All go through one path ([[#Cleanup]]).

### Repair

A commit that failed before it was scored says nothing about its idea.

- repairable: it has a commit, changed files, and either `check` errors or a failed evaluation that was not a credit stop
- allowed only if a stop check passes with the failed attempt's spend and tokens added
- the failed attempt keeps its row (`error`), its cost and its own note
- attempt `e1` starts from the failed commit, with the masked errors, the same hypothesis, and a prompt that says: fix this failure and nothing else; there is no second repair. No research, no plan, no send-backs
- `e1` is decided against the same checkpoint and stands for the round. The decision, the review's diff and the rejected diff all compare `e1` with the checkpoint
- repairable means the evaluation returned `ok: false`. An evaluator run that failed out of its retries is an `error` with no repair
- the failed attempt's row (with `reviewer_usd` 0) and its note are written before `e1` starts
- `unchanged` compares a commit with the commit its sandbox started from: the checkpoint, or `e0` for a repair. An `e1` equal to `e0` is recorded as `revert`, `unchanged: true`, with the checkpoint's metrics, and its diff against the checkpoint is still saved as the rejected diff
- the leak scan of a repair covers the lines `e1` adds over `e0`

### Pause for credits

Problem: a program that gets 402 on every call scores as a low F1, and the keep rule and the reviewer would act on it. So running out of credits pauses the night instead of failing it.

- detected: on a program call, HTTP 402 from OpenRouter or a credit message; on a coder or reviewer turn, a credit or quota message from Pi. The message test covers: 402, payment required, insufficient credits / quota / funds / balance, credit balance, out of credits / budget, quota exceeded / exhausted, exceeded your … quota / allowance, usage limit reached, key limit exceeded, billing. A 429 rate limit is not a credit error: Pi and the program retry it
- Pi does not throw on a failed model call: it reports an assistant message with stop reason `error` and an error text. Test every assistant message end against the credit pattern, and the thrown error too. A handler around the prompt call alone never sees a credit error
- reported as a credit stop: `who` (coder, reviewer, program), `model`, `message`
- a coder commits its partial work and returns the stop; an evaluation ends the stage at the first credit call and reports no score; a review just stops
- only the parent run waits, in a durable wait with no sandbox running. A waiting child would hit its invoke timeout; with the sandbox gone, nothing bills
- resume: an event from the CLI or the app. Finished work stays; only what stopped reruns: the coder from its commit in the same Pi session on a new sandbox, the evaluation from scratch, the review again. The resumed coder's sandbox is created from a git bundle holding both the paused commit and the round's parent, so the final commit still squashes onto the parent. It gets the same short restart prompt as after a crash; its send-back count and wrap-up flag start again; its clock is set to now minus the coding time so far, on the first attempt of the resumed step only. Still out of credits → it pauses again at the same place
- paused time doesn't count against the deadline or `experiment_min`
- a pause lasts 3 days, then the night fails, which stops it. Stop works while paused
- files: `pause.json` while paused (`at`, `round`, `stops[]` each with `where`), `pauses.jsonl` as a log with `resumed_at`. `where` is free text naming the step: the experiment, the evaluation, or the review of round N. One pause holds one stop
- ending a pause: log it to `pauses.jsonl`, delete `pause.json`, and add the paused time to `deadlineMs` in `night.json` and to the loop's deadline. This step must be safe to retry
- every evaluation pauses the same way: dev, noise, rescore and test. A rerun keeps its `eval_id`, so it does not replay the calls its paused attempt made

### Continue, seed and rescore

Continue: more rounds on an ended night, under the same id.

- allowed only for a night that ended (`done.json` or `stop.json`) and ran the same scenario
- reopening happens before the start event is sent, by whoever sends it (the CLI for `run-night continue`, the worker API for the app), never in a step of the night. In order: check the night ended and ran this scenario; move the files of rounds past the last recorded round aside; rename the end file; work out the rescore flag, `max_rounds` and the budget; rewrite `night.json` with the new deadline, config and scoring hashes (`startedAt` stays). From then on the night reads as running, so a second continue is refused and the follower never sees the old `done.json`. Done inside the night instead, `run-night continue` would print `done` at its first poll and exit
- the first step of the continued run only rebuilds the bundle and the state below
- rounds number on from the last recorded round, from the kept commit, with the last review's feedback and hypothesis, the log rebuilt from the rows, the notes and the rejected diffs
- `--rounds` adds to the rounds so far (default: the config's `max_rounds`). The deadline restarts from now. The bundle is rebuilt from the scenario as it stands
- budget: `night.json` keeps `run_budget_usd`, the config's `budget_usd.night` as it was at the first continuation. Every continuation sets the night budget to what the night has spent plus `run_budget_usd`, never plus the budget in the saved config, which would compound
- config: the CLI's continue uses the yaml it is given; the API's uses the night's saved config with `scenario.yaml` loaded again from disk
- a direction goes to every new coder and reviewer, masked with `scan`, and replaces the hypothesis the night had reached
- the old `done.json` / `stop.json` is renamed `done-r<last>.json` / `stop-r<last>.json`. Files of rounds past the last recorded round (a night that failed mid-round) move to `unfinished/after-r<last>-<time>/`, so that round reruns from scratch
- each run ends with its own test eval: test is scored once per run

Where a continued run's state comes from:

| state | source |
|---|---|
| checkpoint | The night's last `experiment` row with `keep` (a rescore row counts); else its round-0 commit, with the seed's metrics if the night was seeded. Never `done.json`: a stopped night has none |
| last round | The highest round among its `experiment` rows |
| spend | Over all its rows: coder + dev + program spend, plus each round's review once |
| feedback, hypothesis | The review file of the latest round that has one |
| log | One entry per round from the `experiment` rows; in a repaired round the last row stands. Changes are against the checkpoint of that time, starting from the seed's metrics |
| noise | `noise.json` as it is, unless this run rescores |
| tokens, rounds without a keep, costliest round and evaluation, A/A count | Start at zero: `max_tokens` and `plateau_rounds` apply per run |
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
- a continued night gets the rescore flag in its start event. A seeded night works it out itself in init, by comparing the seed night's scoring hashes with the current ones; the CLI only adds the round

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
| the coder child failed outright | `error` | primary = 0 | `the experiment failed` |
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

Pi (`@earendil-works/pi-coding-agent`, TypeScript SDK) runs in the worker, never in a sandbox, so credentials stay on the host. Its tools act inside the sandbox.

- providers: any Pi provider as `<provider>/<id>`. Credentials: env keys, or `auth.json` from Pi's `/login` (`~/.pi/agent/auth.json`, or `CODECLIMB_PI_AUTH_PATH`). Cost is Pi's catalog price per message: real spend for API keys, an estimate for subscriptions
- isolation: an empty agent directory; no AGENTS.md, skills, prompt templates, extensions or themes from the host; in-memory settings with compaction on and 4 retries; working directory `/repo`. Only Pi's base prompt plus the user prompt reaches the model
- sandbox tools: exactly `read`, `write`, `edit`, `bash`, with Pi's own definitions and their operations routed to the sandbox interface. `grep`, `find`, `ls` stay off. The host environment is never forwarded to the shell; only the meter variables are. A bash command with no timeout of its own gets 10 minutes
- web research, on the host, through `pi-web-access`: `web_search`, `fetch_content`, `get_search_content` ([[#Web research guard]])
- session storage: a session file per experiment under `exps/<exp>/session/`, so a crashed attempt can reopen it

### Pi facts found while building

Like the Inngest platform facts, these cost time to find; they are not design choices.

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
- the project's own repository is off limits, because it holds the gold: the `origin` remote of the worker's checkout, on github.com, www.github.com, raw.githubusercontent.com, codeload.github.com and api.github.com. Links to it are cut from search results. With no GitHub origin there is no such rule
- off in mock mode

### Prompt

Sections, in order; each only when it has content:

| section | content |
|---|---|
| intro + `<spec>` | Every `.md` in the bundle's `spec/`, the task file (`SPEC.md` or `task.md`) first. A copy is at `/spec/spec`; `/spec/train` is the only labeled data |
| `<direction>` | The operator's direction for every round: a continued night's, or a new night's `--direction` |
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
| `cancelled` | the night was stopped |

- every stop but `cancelled` commits: partial work is still a result. `cancelled` destroys the sandbox and fails the step
- before the commit the worker reads from the sandbox: `/tmp/notes.md` (cut to 3,000 characters), `/tmp/tasks.json` and `/tmp/train-score.json` (saved under `exps/<exp>/`)
- commit: the sandbox's `.git` is replaced, the tree is committed once on the parent commit (squashing whatever the coder committed), exported as a git bundle and imported as `refs/exp/<exp>`. Message: `<exp id>: <hypothesis>`. In order: the parent's git bundle, uploaded at create, stays in the sandbox outside `/repo`; delete `/repo/.git`; start a new repository on `main`; fetch the parent from that bundle and soft-reset to it; add everything (so `.gitignore` applies); commit, an empty commit allowed, as `codeclimb <codeclimb@localhost>`; bundle `main`; the host reads the bundle and force-fetches `main` into the experiment's ref
- hypothesis recorded: the reviewer's if the round had one, else the last `APPROACH` line of the closing message, backticks and asterisks stripped, cut to 300 characters. With no such line: the closing message's last non-empty line, else `(no summary)`
- a commit whose tree equals its parent's is `unchanged`: nothing is evaluated, and the closing message (cut to 1,000 characters; `(no closing message)` when empty) goes to the reviewer and the history
- `code-state.json` is rewritten on every assistant message, so a killed attempt loses nothing and the app can show it live. Keys: `startedAt`, `sandbox`, `freshRestarts`, `infraErrors`, `coderUsd`, `devUsd`, `tokens`, `tCode`, `tProvision`, and at the end `finishedAt` and `stop`

### Crash and resume

- a retried step with a state file on disk looks for the sandbox by name. Alive, with a session file → reopen the session with a short prompt saying the harness restarted and to continue where it left off. Dead → one fresh restart from the parent commit, counted in `infra_errors`: the experiment's clock and the session start again; spend, tokens and the restart count carry over. Lost twice → the experiment fails (`sandbox lost twice`)
- after a pause for credits: a new sandbox from the paused commit, the same session, and the clock set so the pause doesn't count
- live registry: an in-process map from run id to an abort function. Each entry also carries its night id, since the stop cleanup has only the night id. Cancelling a durable run never interrupts a running step; without the registry Pi keeps spending against destroyed sandboxes

## Evaluator

One evaluator child run and one sandbox per evaluation. Never the coder's sandbox, and created after it is destroyed, so the coder never touches the runner or the inputs. A failed evaluation is an outcome with `ok: false`, not a failed run.

For one commit:

1. **Reset**: kill every process except the sandbox's own init, the guest agent and the image's keep-alive command; wipe `/repo`, `/work`, `/eval`, `/tmp` and the home cache; clone the commit into `/repo`. This makes a step retry safe
2. **Environment**: if the commit has a `uv.lock`, rebuild its environment in `/repo/.venv` (system packages stay importable; frozen; no dev group). No meter token and no stage clock. Limit 3 minutes. A failure fails the evaluation with a `uv.lock: …` error
3. **Token**: on a metered night, open a meter token for this evaluation. Cap = the night's budget left when it starts
4. **Per stage, in order**:
   - `inputs` on the host → `evals/<eval>/<stage>/inputs.jsonl`
   - upload the inputs to `/eval/<stage>/inputs.jsonl` and the stage's `files`
   - `run` in the sandbox, cwd `/repo`, timeout `eval_min`, the meter variables as environment. The harness creates `/eval/<stage>/out` first, puts `/repo/.venv/bin` first on the path, runs the stage command in a subshell and sends its stdout and stderr to `/eval/<stage>/run.log`. `{inputs}` = `/eval/<stage>/inputs.jsonl`, `{out}` = `/eval/<stage>/out`
   - save `run.log` on the host, also after a clean exit: a program that swallows its errors shows them only there
   - a credit stop ends the evaluation here, with no score
   - on a metered night, check again that the proxy's URL reaches the proxy; if not, throw: the scores would be the outage's. This comes before the exit code is read, so an outage is never recorded as a program failure
   - a timeout or a non-zero exit fails the evaluation with the log's tail
   - tar the outputs from inside the out directory and download them → `evals/<eval>/<stage>/outputs/`, the run's files at its top level
   - on dev, stop here if the run exited clean but wrote no output: an empty stage can't be kept, and later stages would only spend money. Test always runs every stage
   - parse `timings.jsonl` if present
   - score on the host: `details` on dev when the stage has it, else `score`; `{out}` = the downloaded outputs, `{report}` = `evals/<eval>/<stage>/report.json`
   - flatten the report into metrics
5. **Close**: revoke the token (spend counts even on failure); write `meter.jsonl`, and `metrics.json` only when every stage was scored; destroy the sandbox

Outcomes:

- `ok` = the primary metric is a number
- program crash, timeout, bad timings file, scorer failure, empty dev stage → `ok: false` with an error the reviewer and the next coder read (the run log's last 2,000 characters)
- an `inputs` failure or an infrastructure failure throws → step retry, then the evaluation fails
- a credit stop → no score; the night pauses and reruns it
- the result returned to the parent holds aggregates only (metrics, cost, timings, the sandbox instance id); per-item data stays on disk
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

The log (one entry per round: hypothesis, changes, decision, reason) and the history (the same entries as masked lines) are not files: they live in the parent's state, so a step retry can't append one twice. The masked lines travel to each coder in the child run's input. The reviewer's lines are built from the log, unmasked. The feedback in a trajectory is read from `reviews/r<N>.json`.

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

- trigger: when a night finishes or is stopped, an event starts the distillation, one at a time per scenario so two nights never edit one file. The event is sent only when lessons are on: the mode is not `off` and the scenario declares lessons. The stop cleanup reads the config from `night.json`
- a night is distilled when it has notes or reviews for rounds past its newest applied proposal. It is skipped when a proposal folder for its last such round already exists, applied or not
- a credit error fails the distillation, and the function's retries run it again: there is no pause
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
- output, under `<results dir>/lessons/<night>-r<last round>/`: `lessons.md` (the new file), `changes.md` (each op beside the lesson it changes, rejected ops, prunes), `proposal.json` (ops, base sha256, cost; `applied: true` is added when the proposal is applied, and is absent before)
- `apply` also writes the scenario's `lessons.md`, unless that file changed since the proposal or the night was a mock. It never commits: `git diff` is the review
- `night.json` records the sha256 of the `lessons.md` each run's coders read
- by hand: `lessons distill --config … --night ID [--apply]`, `lessons apply --config … --night ID`, `lessons format --config … [--check]`

## Metering proxy

An HTTP server in the worker; the only way a program reaches a model. Sandboxes hold no provider key.

| route | use |
|---|---|
| `POST /v1/chat/completions` | Text messages only (`system`, `user`, `assistant`), no tools, no streaming. `response_format`, `seed`, `top_p`, `stop`, `reasoning` are forwarded. Answers in OpenAI's shape |
| `POST /v1/embeddings` | `input`: a string or a list of strings |
| `POST /v1/decisions` | OpenRouter decisions models. Body: `model`, `state`, `questions`, optional `assets`. Answers with `answers` |
| `POST /v1/rerank` | Body: `model`, `query`, `documents` (a list of strings), optional `top_n`. Answers with `results`, best first, each an `index` into the documents and a `relevance_score` |
| `POST /v1/_op` | Body: `op`, matching `^[a-z][a-z0-9_]*$`. The runner names the operation later calls belong to; default `program`. Answers 200 with the op and writes no ledger row. The scenario runners call it first and fail on any other status |

- a ledger per token: open with an evaluation id, the allowed models, a `$` cap and a credit-stop callback → a random bearer token; read its spend; close → its calls, token revoked, calls in flight aborted
- refused, in this order: 401 bad or revoked token; 413 body over 16 MiB; 403 model not in `allowed_models`; 402 the ledger already hit a credit stop; 402 cap spent; 400 unsupported request. An upstream failure is 502 and what it cost is still charged. A cap is checked before a call, so the crossing call still runs
- a refusal answers with an object holding `error.message` and `error.type`: `authentication_error` (401), `permission_error` (403), `insufficient_quota` (402), `invalid_request_error` (400, 413), `api_error` (502)
- every call is one ledger row, and one line of `meter.jsonl` or `meter-dev.jsonl`. Always: `kind` (`chat`, `embeddings`, `decisions`, `rerank`), `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd`, `ms`. Only when they apply: `error` (a failed or refused call; never present on a successful one), `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected` (the status of a refused call). The files are written only when the ledger has rows
- backends: `openrouter/<id>` goes straight to OpenRouter with the worker's key and charges the `usage.cost` it reports (a reply with no cost counts as failed); decisions and rerank exist only there. Other chat goes through Pi's model runtime at catalog prices. Outside OpenRouter, embeddings only for `openai/text-embedding-3-small` ($0.02 per million tokens) and `-large` ($0.13)
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

- listener: the proxy has its own listener, one per worker, started on first use: `CODECLIMB_PROXY_HOST` (default `127.0.0.1`) and `CODECLIMB_PROXY_PORT` (default a random free port). The relay points at that port. The worker API also serves the same handler under `/v1` on its own port, but nothing depends on that: a worker whose API port is busy still has its proxy
- Docker, metered: sandboxes join a plain network `cc-meter` and see the proxy at `http://cc-meter-relay:8080/v1`
- the relay: a container `cc-meter-relay` from the scenario's image, started on the default bridge with the host-gateway alias `host.docker.internal`, running a small TCP forwarder written with Python's standard library (port 8080 → the alias and the proxy's port), labelled `cc.meter=1` and `cc.meter.port=<port>`, with no managed label, then attached to `cc-meter`. It is shared by nights, never swept, reused while it runs with the same port label and recreated otherwise. Concurrent callers must not remove a relay another just started
- reaching the host: Docker Desktop reaches a loopback bind through the alias. On Linux a loopback bind is unreachable from the relay, so the proxy must bind the Docker bridge's gateway address: use `CODECLIMB_PROXY_HOST` when set, and when it is unset on Linux pick that address automatically
- Docker, unmetered: the default bridge. Both have internet access; only a token gets a program to a model
- "the path is up" is checked before a coder starts, before an evaluator opens, after each stage's run, and in the round-start smoke test: `cc-meter` and the relay exist, the relay runs, and its port label equals the proxy's port; otherwise recreate it. There is no HTTP probe from the worker: the relay's name resolves only inside the network
- why: a program that swallows errors would score as a bad program. An outage never becomes a score

## Sandboxes

One interface; Pi's tools and the orchestrator call only this.

- backend: create (name, image, optional commit to clone into `/repo`, optional spec directory for `/spec`, labels, network), find a live sandbox by name (to resume a crashed step), sweep by name prefix or by label
- sandbox: exec (cwd, timeout, abort signal, streamed output, stdin, per-command environment → exit code, stdout, stderr, timed out, aborted), read file, write file, is alive, instance id (changes when recreated under the same name), age, destroy
- a backend must offer: exec that kills the whole process tree on timeout or abort, streamed output, file transfer at least as large as the largest git bundle or `/spec` folder, find by name, sweep
- git holds the state, the image holds the environment: each sandbox = fresh image + commit
- code moves as git bundles through write file / read file: no git credentials in a sandbox, one code path for every backend. Directories move as tars. In this spec "bundle" alone always means the coder's `/spec` folder; a git bundle is always called a git bundle
- `/spec` is uploaded at create; only coders get it
- names are deterministic, so find resumes a step and a prefix sweep cleans a night
- size: 2 vCPU and 2 GiB everywhere, so scenarios must fit
- create replaces a stale sandbox of the same name

Docker backend:

- one container per sandbox, limited to 2 CPUs and 2 GiB, on the default bridge or `cc-meter`, kept alive by the image's sleep command
- labels: `cc.managed=1`, `cc.night=<night>`, `cc.run=<run id>`; sweeps filter on `cc.managed`
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
| `stack`, `backend` | `inngest`; `docker` |
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
| `nights/<id>/night.json` | `night_id`, `startedAt`, `deadlineMs`, the round-0 experiment id and SHA, `seed`, the resolved `config`, `metric_script_sha256`, `lessons_sha256`; `run_budget_usd` once continued |
| `nights/<id>/done.json` | `night_id`, `stop_reason`, `rounds`, `kept` (`exp_id`, `commit`, `dev_score`), `test_metrics`, `spend_usd` (4 decimals), `leftover_sandboxes_destroyed`, `finished_at` |
| `nights/<id>/stop.json` | `at`, `reason` (`manual`, `app`, `failed`, `cancelled`; `stop` when the event names none). Written only if the night has no `done.json`; the first stop wins |
| `nights/<id>/pause.json`, `pauses.jsonl` | The current pause; every pause |
| `nights/<id>/noise.json` | The A/A run |
| `nights/<id>/bundle/` | The coder's `/spec`: `spec/`, optional `train/` and more, `history/` growing |
| `nights/<id>/reviews/r<N>.json`, `r<N>.prompt.md` | The review and what it read |
| `nights/<id>/exps/<exp>/` | `session/*.jsonl`, `code-state.json`, `tasks.json`, `train-score.json`, `check.json`, `meter-dev.jsonl` |
| `nights/<id>/evals/<eval>/` | `<stage>/{inputs.jsonl, run.log, outputs.tar, outputs/, report.json}`, `meter.jsonl`, `metrics.json` |

Source of truth is git plus `results.jsonl`. The runtime's traces and scores mirror it for debugging and are never read by a decision.

## Interfaces

### Events

| event | data | sent by |
|---|---|---|
| `codeclimb/night.start` | `night_id`, `config`, optional `continue` (`rescore`, optional `direction`), optional `direction` (a new night's; never beside `continue`) | CLI, API (continue) |
| `codeclimb/night.stop` | `night_id`, optional `reason` | CLI, API, the failure and cancel handlers |
| `codeclimb/night.resume` | `night_id` | CLI, API |
| `codeclimb/night.finished` (the lessons event) | `night_id`, `scenario`, `config` | the night at its end; the stop cleanup. Only when lessons are on |

### Worker API

Default `127.0.0.1:7421`. It also routes `/v1/*` to the metering proxy's handler, which has its own listener besides ([[#Metering proxy]]). No token on loopback; off loopback `CODECLIMB_WORKER_TOKEN` is required as a bearer on everything but `/v1`. A busy port is logged, not fatal.

| endpoint | purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/nights`, `GET /api/nights/:id` | Night summaries, read from `runs/*/nights/*` |
| `GET /api/nights/:id/live` | Summary, the current round's experiment (phase, elapsed, coder and dev spend, tokens), the exportable experiments |
| `GET /api/nights/:id/report` | The night's rows, reviews, config extract and diffs, as JSON |
| `POST /api/nights/:id/stop`, `/resume` | Send the event; stop also writes `stop.json` at once |
| `POST /api/nights/:id/continue` | `{direction?, rounds ≥ 1}`; 409 when the night can't continue |
| `GET /api/nights/:id/export/:exp?format=repo\|source\|bundle` | Download: a git repo `.tar.gz` (default), the tree only, or a git bundle |
| `POST /api/nights/:id/export/:exp` | Body: `kind` = `dir` with a `path` on the worker's machine (always the git-repository form), or `kind` = `remote` with a `url` and an optional `branch` |

- status comes from files, not from the durable runtime: `done.json` → `finished`, `stop.json` → `stopped`, `pause.json` → `paused`, no file written for an hour → `stale`, else `running`. So the app doesn't depend on the stack
- phase of the live experiment: `evaluated` once its row exists; `starting` with no `code-state.json`; `waiting for eval` once the state has `finishedAt`; otherwise `coding`. A repair (`e1`) takes over from `e0` once its folder exists
- finding nights: scan `<root>/runs/*/nights/<id>/night.json` and `<root>/runs/mock/*/nights/<id>/night.json`. The stop cleanup finds a night's folder the same way, since the stop event holds only the night id
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
- the Next.js app also serves an Inngest scaffold of its own, apart from the worker: app id `codeclimb`, one `hello-world` function on the event `test/hello.world`, served at `/api/inngest` and sent by `POST /api/hello`. `inngest.json` points the dev server at `http://localhost:3000/api/inngest`, with discovery off. The loop uses none of it

### Export

- targets: a folder with plain files (refused if not empty, unless forced), a folder as a git repo with the kept lineage as history on branch `codeclimb/<exp id>` (needs an empty or new folder), or a push of that lineage to a remote branch (`codeclimb/<exp id>` or a given one)
- never force-pushes; remotes limited to `https`, `ssh`, `git`, `file` and local paths; option-like arguments and command transports (`ext::`, `fd::`) refused; git never prompts for credentials
- CLI: `export (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])`. `best`, the default for `--exp`, = the kept commit of the most recently finished night

### Tracing

OpenTelemetry API, a no-op without a provider, built by hand on Pi's event stream:

- one chat span per assistant message (model, tokens, cache, finish reason, cost); one span per tool call; one per sandbox exec, read and write; one per program operation of an evaluation; one per metered call under its evaluation
- the primary and headline metrics (every metric when the scenario has no headlines) of each dev evaluation are also mirrored as native scores on the experiment's run. Never read by a decision

## Durable runtime on Inngest

What the runtime must provide, and the Inngest feature that provides it. The step bodies stay framework-free; the Inngest SDK appears only in the function definitions, the worker's connection and where events are sent.

| requirement | Inngest | why |
|---|---|---|
| The loop survives a worker crash | Memoized steps; the loop's variables are rebuilt on replay | Nights take hours |
| The parent stays small | A thin `run-night` plus invoked children `run-experiment` and `run-evaluator` | Limits on steps and output per run |
| Long steps | A `connect()` worker, not serverless; app id `codeclimb-worker` | A coder step runs up to `experiment_min` |
| Retry | 2 retries on `run-night`, `run-experiment`, `run-evaluator` and `distill-lessons`; the two cleanup functions set none and keep the SDK default. The coder step learns its attempt number | Drives session resume |
| Backstop timeouts | Experiment invoke: `experiment_min × 3 + 30` min. Evaluator invoke: `eval_min × stages × 3 + 15` min. Night: 4 days | Past retries and a pause |
| Cancel a night and its children | `run-night`, `run-experiment` and `run-evaluator` each cancel on the stop event for their night | Cancelling a parent may not cancel invoked children |
| Stop running work | `night-stop-cleanup` on the stop event; `run-cancelled-cleanup` on the platform's function-cancelled event | Cancel never interrupts a running step |
| Failure = stop | The night's failure handler sends the stop event | One cleanup path |
| Pause and resume | Wait for the resume event, 3-day timeout | A human-paced wait at no cost |
| One night id, one run | A stable start-event id `night-start-<id>`; a continue uses a fresh id | A double send starts one night |
| Lessons one at a time | `distill-lessons` with a concurrency of 1 per scenario; event ids `lessons-<night>-r<round>` and `lessons-<night>-stop` | No two edits of one file |
| Scores mirror | The score middleware on the client and the step-level score call, in the evaluator child. The target is the experiment child's run id, which that child returns and the parent passes on. One step per metric, named from the sorted metric names (a memoized result's key order can differ on replay). Only for a successful evaluation; a failed score call is swallowed | Comparison in the dashboard |
| Traces | The extended-traces middleware on the client plus the `@inngest/otel` preload at worker start | Our spans nest under the step |

Rules the loop depends on:

- a replay must take the same path: every clock read and every I/O sits inside a step, and a resumed attempt gets a new step identity instead of re-entering an old one
- only the parent waits; children return stops
- a child's failure is caught and becomes an outcome, so one bad experiment doesn't kill the night
- steps take plain data and return small JSON (SHAs, metrics, paths); large state stays on disk
- file writes inside steps are idempotent: rows deduplicate by `eval_id`, other files are rewritten whole
- the worker holds in-memory state (live Pi aborts, the proxy's ledgers and cache), so children must run on the worker that holds the disk
- a worker restarted onto new code cannot replay a night started by older code: let running nights finish first

State the parent carries across rounds: the checkpoint, feedback, failures, hypothesis, log, history, spend, tokens, per-round spends and tokens, rounds without a keep, the costliest evaluation, the deadline, the pause count, the round, the noise and the A/A run count, the stop reason.

### Cleanup

One path for every hard stop:

- `night-stop-cleanup`: abort the night's live Pi sessions in this worker, sweep its sandboxes by prefix, write `stop.json`, and send the lessons event for a night that didn't finish
- `run-cancelled-cleanup`: abort that run's Pi session and sweep the sandboxes it created. If the cancelled run was the night's parent (a timeout or a stop), send the stop event too
- a finished night sweeps its own prefix before `done.json`
- a stopped or failed night must always end with a `stop.json`, mock nights included. `run-night` only exits when it sees `done.json` or `stop.json`, so a night that died without either leaves the command, and a test run, hanging
- a night can fail before `night.json` exists (a failed model check, bundle command or init), and the stop cleanup then finds no folder. So the night's failure handler, which gets the start event and with it the results directory, creates `nights/<id>/` and writes `stop.json` with reason `failed` itself when `night.json` is missing, then sends the stop event. A night with a `stop.json` and no `night.json` can't be continued or used as a seed
- `run-night` exits 0 after printing `done` or `stopped`: tests read the printed word and the files

### Platform facts found while building

These cost time to find. They are not design choices.

- a killed worker's step resumes after about 2 minutes, when its lease expires
- the function-cancelled event carries the triggering event, which tells the parent run from its children

## Deployment and environment

One mode, with the worker on your machine. Why not a hosted worker: every piece of worker state is on disk, and a coder step outlives serverless limits.

| | local |
|---|---|
| orchestration | Inngest dev server (`dev:inngest`) |
| worker | `worker` (dev mode) |
| CLI | `run-night` |
| sandboxes | Docker |
| proxy | A random port, the relay |

- env file: one `.env` (gitignored; `.env.example` lists every key), loaded first by the CLI and the worker; values already in the shell win
- the CLI and the worker default `INNGEST_DEV` to `1`, and `dev` sets it for the app
- the machine stays on until the night ends; on macOS the worker holds `caffeinate -i`
- a sandbox keeps running while its worker is away
- the app and the API bind loopback only by default

| variable | meaning |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY` | Provider keys; `OPENROUTER_BASE_URL` points the proxy elsewhere, for tests |
| `CODECLIMB_PI_AUTH_PATH` | Another `auth.json` |
| `INNGEST_DEV` | Dev |
| `CODECLIMB_ROOT` | The checkout the worker resolves config paths and `runs/` against |
| `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT` | The worker API (default `127.0.0.1:7421`); without `CODECLIMB_API_PORT` the port falls back to `PORT` |
| `CODECLIMB_WORKER_TOKEN`, `CODECLIMB_WORKER_URL` | The API's bearer; where the app reaches the worker |
| `CODECLIMB_PROXY_HOST`, `CODECLIMB_PROXY_PORT` | Where the proxy binds; on Linux Docker the `docker0` address |
| `CODECLIMB_WORKER_ID` | The worker's instance id (default `codeclimb-worker-local`) |

Language: TypeScript on Node 24, ESM, run from source with `tsx`; `tsc` for types; Node's test runner for unit tests of the pure parts (keep rule, stops, schema, flattening, metering, lessons ops). Next.js and React for the app, `yaml` for configs, `node:http` for the API and the proxy. The worker is a separate app from the Next.js one, so Pi's native dependencies stay out of its bundle. Scenario code: any language behind the contract.

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
| loop | pause timeout; night backstop | 3 days; 4 days |
| loop | function retries (night, children, lessons) | 2 |
| loop | invoke timeouts | `experiment_min × 3 + 30` min; `eval_min × stages × 3 + 15` min |
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
| proxy | ports | relay 8080 |
| sandbox | size | 2 vCPU, 2 GiB |
| API | port; stale after; request body | 7421; 60 min; 1 MB |
| app / CLI | polling | night 5 s; list 10 s; CLI follow 5 s |
| git | starter commit date | 2026-01-01T00:00:00Z |
| rounding | latency ms / s; cost; spend | 3 / 6 decimals; 9 decimals; 4 decimals |

Scenario numbers (thresholds, budgets, timeouts, models) live in `configs/*.yaml`, not here.

## Known gaps

- a hard-stopped night has no test score; "finish now" would need a stop at the next round
- `eval_min` limits a slow program: at 16 minutes per stage, one extraction timed out. The coder's to fix; the reviewer reads why
- `scan` and `check` find copies, not paraphrases or encodings; the reviewer still reads the diff
- proxy: no streaming, tools or non-text chat; operation attribution assumes one operation at a time; two nights on one worker share `cc-meter` and the single replay cache
- sandboxes have open egress: only the missing keys keep a program from a model
- a failed night start needs a new night id (the start event id is deduplicated)
- the model check finds missing keys, not wrong ones: a bad key fails the first call as `agent_error`
- one A/A pair is one sample; `min` and `max` bound it
- `stack` is fixed to `inngest` in the row
- the mock coder stops at once on every turn, so a mock session holds the full 8 send-backs and one wrap-up. With a 5-minute experiment and the 3-minute floor, all of them must start within the first 2 minutes
- four places where this spec asks for more than the reference build does:
  - finding mock nights under `runs/mock/` for `stop.json` and the API. The reference scans `runs/*/nights/` only, so a stopped mock night leaves `run-night` waiting
  - the failure handler writing `stop.json` when `night.json` doesn't exist yet. The reference writes none, and `run-night` waits
  - picking the Docker bridge address on Linux when `CODECLIMB_PROXY_HOST` is unset. The reference needs it set by hand
  - the step that ends a pause being safe to retry. The reference's throws on a retry after it deleted `pause.json`
- kept as the reference has them, though they are weak spots:
  - a repair's leak scan covers only what `e1` adds over `e0`, so held-out names a failed attempt added and its repair kept are not counted
  - the stop cleanup's lessons event id is `lessons-<night>-stop`: a continued night stopped a second time reuses it, and the runtime may drop the second event
  - a stop or a pause timeout leaves `pause.json` behind, so a night continued afterwards reads as paused until its next pause ends
  - the sweep prefix `cc-<night>` of a night `a1` also matches a night `a10`; default ids don't collide

## Suggested build order

1. Scenario contract and config: parse, validate, placeholders, host commands, report flattening, the keep rule, stops, the row schema (all unit-testable)
2. Experiment repository, the sandbox interface, the Docker backend, bundle transfer
3. Pi sessions with sandbox tools, mock models, the coder with its end-of-experiment commit
4. Evaluator with standard metrics; the metering proxy with the relay and the replay cache
5. The night loop on the dev server: children, record, review, notes, test eval, `done.json`; then the first two mock nights
6. Stop, cleanup, crash resume, pause and resume
7. Noise run, repair, send-backs, trajectory, continue, seed, rescore, lessons; then the third mock night
8. Worker API, app, export, tracing
