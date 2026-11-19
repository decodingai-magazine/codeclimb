# CodeClimb on Inngest — Build Spec (System 1)

CodeClimb is an optimization loop: a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. Nothing is fine-tuned or trained. This file says what to build on the Inngest stack: the goal, the architecture, the features and the interfaces the build must honour. It holds no code. A coding agent builds the whole application from it and the given inputs, alone.

## Goal and done signal

Build the application so that a **night** (one run of the loop) works end to end: the durable loop, sandboxes, coding-agent sessions, commits, evaluations, the review, the test evaluation and the result files.

You are done when the seven nights below pass, run one after the other, each under a fresh night id (`--night-id`). They run on the local Inngest dev server (`npm run dev:inngest`) and one worker (`npm run worker`), with Docker sandboxes and mock models, so they cost nothing. Before the first night: Docker runs, both images are built (`npm run build:image`, `npm run build:image:graphrag`), `uv` is on the path, the worker runs the code under test, and `docker ps` shows no `cc-` container.

| # | night | what it must show |
|---|---|---|
| 1 | `npm run run-night -- --config configs/capitals-smoke.yaml --mock` | The program calls a model through the metering proxy |
| 2 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` | Two rounds: round 1 is kept, a noise run follows, the review hands its hypothesis to round 2. Ends on `max_rounds` after exactly 2 rounds |
| 3 | `npm run run-night -- --config configs/e2e/plateau.yaml --mock` | The plateau cap: nothing is kept, so the night ends on `plateau` after round 1 |
| 4 | Night 2, left following in its terminal; then, from a second terminal, `npm run run-night -- stop --night <id>` while round 1 runs | A hard stop mid-round |
| 5 | Night 2 with `--no-wait`; once round 2 has started, kill the worker process with its children (the dev server keeps running), then `npm run worker` again | Crash resume |
| 6 | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` | A lost connection mid-turn: the coder's session carries on once model calls succeed again |
| 7 | `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` | A multi-stage, metered night: three stages (`extraction`, `graph`, `retrieval`), a repository check, host commands through `uv`, a repair, lessons at the end |

A mock night writes to `<dir>` = `runs-inngest/mock/<name>/`, where `<name>` is the folder its config's `results_path` names (`capitals-smoke`, `datenorm-smoke`, `e2e-plateau`, `graphrag-smoke`). Paths below are under `<dir>/nights/<id>/` unless they start with `<dir>`.

Common checks, for nights 1, 2, 3 and 6:

| # | check |
|---|---|
| C1 | `run-night` prints `done`; `stop_reason` is `max_rounds` or `thresholds` (`plateau` for night 3) |
| C2 | `done.json` exists; `stop.json` and `pause.json` don't |
| C3 | `npm run validate-results -- <dir>/results.jsonl` passes |
| C4 | `<dir>/results.jsonl` has a row per experiment of every round, plus a `test` row |
| C5 | `git -C <dir>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit; its diff adds `MOCK.md` |
| C6 | `exps/*/code-state.json` has `stop: done`; `exps/*/session/` holds a session file |
| C7 | `reviews/r<n>.json` exists for every round, with `feedback: mock feedback` |
| C8 | `exps/*/train-score.json` and `exps/*/tasks.json` exist; the session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code") |
| C9 | `bundle/history/notes/r<round>-e<n>.md` per experiment, with a `mock note` coder part and, where reviewed, a `mock verdict` reviewer part |
| C10 | every experiment row has `decision_reason` |
| C11 | `datenorm-smoke`: round 1 holds the starter's code, scores above 0 on dev (accuracy 0.125) and is kept; a `noise` row follows in round 2 and `noise.json` exists. `capitals-smoke` scores 0 and keeps nothing |
| C12 | `done.json` has `spend_usd: 0` |
| C13 | `capitals-smoke`: `evals/*/meter.jsonl` lists the program's calls, none with `error` |
| C14 | no `cc-<id>` container exists, running or stopped (`docker ps -a`) |

Added checks:

- night 3: `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; a `test` row exists; no `cc-<id>` container, running or stopped
- night 4: stop once `exps/<id>-r1-e0/` exists. The stop command prints `stopped` and exits 0. Within 30 s: `stop.json` has `reason: manual`, there is no `done.json` and no `test` row, no `cc-<id>` container is left, running or stopped. The `run-night` that started the night and is still following it prints `stopped` too
- night 5: kill once `exps/<id>-r2-e0/` exists (if the night finishes first, run it again). Start the worker again and nothing else. The night then finishes by itself: `done.json` exists, every `eval_id` is in `results.jsonl` once, round 1's `code-state.json` is unchanged (sha256 and mtime), and no `cc-<id>-r1-` sandbox is created after the kill
- night 6: C1 to C14, and `exps/<id>-r1-e0/session/` holds an assistant message with stop reason `error`, followed by assistant messages without one

Night 7 passes C1, C2, C3, C5, C6, C7, C10, C12 and C14, and these. A dev evaluation of it may fail (the mock's chat answer gives the extraction stage no rows), and the checks hold with or without that:

- an `e0` experiment row for every round and exactly one `test` row; an `e1` row only after an `e0` row with decision `error`; no `e2`
- every `e0` session holds eight send-backs, then one wrap-up; an `e1` session holds neither; `train-score.json` and `tasks.json` exist for both
- a note per experiment with a `mock note` coder part; the `mock verdict` part is on the note of the round's last experiment
- every experiment has `exps/<exp>/check.json` with an empty `errors` list
- every evaluation has `evals/<eval>/extraction/inputs.jsonl` with 8 lines and `extraction/run.log`
- the test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`, and a `metrics.json`
- a dev row that was not scored holds the primary metric at 0 and nothing else
- the `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `<stage>.…`, with `<stage>.output_bytes` for each; every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
- every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
- `noise.json` and a `noise` row exist only if a round was kept
- within a minute of `done`, `<dir>/lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged

Mock metrics mean nothing; the files are the evidence that everything ran. Also required, though no night above reaches them: real-model nights, pause and resume, continue, seed, applied lessons, export, the worker API and the app.

## Architecture

| component | responsibility | runs on |
|---|---|---|
| CLI (`run-night`) | Validates the config, checks the models, starts / stops / resumes / continues a night, follows its rows | your machine |
| worker | One long-running process holding all of CodeClimb's logic: the loop, the agent sessions, the scenario's host commands, the worker API, the metering proxy | your machine |
| durable runtime | Drives the night so it survives crashes; it never runs CodeClimb's code itself, it calls the worker | Inngest dev server |
| sandboxes | The coder's shell and files; the program under evaluation | Docker |
| metering proxy | The only path from a program to a model: holds the keys, meters every call, replays repeated calls | in the worker |
| worker API + app | Read nights; stop, resume, continue, export. The app is one client of the API | worker; Next.js on loopback |
| experiment store | `experiments.git`, `results.jsonl` and `nights/<id>/`: the source of truth. No database | worker's disk |

```
CLI ──start/stop/resume──▶ durable runtime ──calls──▶ worker ──▶ Pi sessions (coder, reviewer, lessons)
 ▲                                                      │──▶ Docker sandboxes ──▶ metering proxy ──▶ model providers
 └────────── follows files ◀── experiment store ◀──────┘
```

- a night: init (build the coder's bundle, import the starter commit) → rounds → on a soft stop, score the kept commit on test → `done.json` → distill lessons
- a round: stop check → smoke test → noise run when due → experiment → dev evaluation → keep or revert → at most one repair → review → record the row → update notes and history → threshold check
- an experiment: a fresh sandbox holding the checkpoint (the last kept commit) and the bundle as `/spec` → the coder works in it → its tree becomes one commit in `experiments.git` → the scenario's repository check and leak scan on the host
- an evaluation: its own sandbox with the commit; per stage: inputs written on the host → the program runs in the sandbox → outputs scored on the host → metrics

Isolation invariants every feature protects:

- gold data, evaluators and provider keys never enter a sandbox
- only train data reaches a coder; the reviewer reads dev; nothing from test reaches a coder, the reviewer or a lesson
- text from the evaluation side is scanned for held-out names before a coder reads it
- every decision reads metrics from evaluations; the agents' own claims decide nothing

## Features

- **Loop.** A night is linear: one experiment per round, from the checkpoint. A reverted experiment is dropped and the next round restarts from the same checkpoint, carrying what was learned. Round 1 has no hypothesis, so the coder picks one; later rounds test the reviewer's. The starter is never run on dev: its weighted score is 0. When nothing was kept, the test evaluation scores the starter.
- **Weighted score.** A threshold metric's share is `min(max(value, 0) / threshold, 1)`; the weighted score is the weighted mean of the shares. It decides every keep, so gains past a threshold add nothing. The primary metric is for display only.
- **Keep rule.** An experiment is kept only if it has a commit, its dev evaluation succeeded, its files differ from the checkpoint's, no guardrail fired (a failed gate; a stage with no output in an evaluation that was still scored, which a dev evaluation never is, because there an empty stage ends it as an `error`; two or more held-out names in the diff) and its weighted score beats the checkpoint's by more than the noise margin. Cost and latency are reported, never scored. Every experiment row says why in `decision_reason`.
- **Noise margin.** A program that calls models scores differently on every run, so a small gain may be luck. At the start of the first round whose checkpoint has metrics while the night has no measured noise, the checkpoint is evaluated on dev once more with no replayed calls (the A/A run, a `noise` row, `noise.json`). The margin is the measured move (or the configured fixed value), smaller the more of the experiment's model calls were replayed, and kept between the configured `min` and `max`. With `noise_margin.fixed` set there is no A/A run. A second A/A run is due at the start of the next round after a failed one, or on the next kept checkpoint after a move above `max` (implausibly large: likely one bad run).
- **Soft stops.** Checked between rounds, so a round always finishes: round cap, deadline, night budget, token cap, plateau, outage, thresholds reached. After a soft stop the checkpoint is scored on test once, for the report only.
- **Smoke test.** Before money goes into a round, check that the models and the metered path are reachable; a round that can't be scored would waste the coder's budget. Repeated failures stop the night with `outage`.
- **Hard stop and cleanup.** A stop request, a cancel of the night's run from outside (through the runtime's own API or dashboard), a night that fails for good and the night's backstop all end the same way: live agent sessions are aborted, the night's sandboxes are destroyed, `stop.json` is written. A stopped or failed night always ends with a `stop.json`, however early it failed, so a following `run-night` never hangs. No test score.
- **Repair.** A commit that failed before it was scored (repository-check errors or a failed evaluation) says nothing about its idea. It gets one repair attempt `e1`, started from the failed commit with the masked errors and told to fix that failure only: no research, no send-backs. The failed attempt keeps its `error` row and its note; `e1` is decided against the same checkpoint and stands for the round.
- **Pause for credits.** A program that gets 402 on every call would score as a bad program. So a credit or quota error, from a program call or an agent turn, pauses the night instead: nothing runs, no sandbox exists, and paused time counts against no deadline. On resume only what stopped runs again. A pause nobody ends times out and stops the night.
- **Crash recovery.** The worker can die at any moment. When it is back the night carries on by itself: finished rounds, experiments and evaluations are not run again and no row is written twice. A coder that was running finds its sandbox by name and reopens its session; if the sandbox is gone it restarts once from the parent commit.
- **Continue.** More rounds on an ended night (one with a `done.json` or a `stop.json`) under the same id, from its kept commit (its round-0 commit when it kept nothing), with its last feedback and hypothesis, optionally with an operator's direction. Its state is rebuilt from the night's files; each continued run ends with its own test evaluation. Each continued run has a fresh deadline and the budget of one run (`budget_usd.night`) on top of what the night has already spent, so the budget does not compound. Its rounds number on from the night's last recorded round, so `done.json`'s `rounds` counts every run's rounds.
- **Seed.** A new night that starts from an ended night's kept commit and dev metrics instead of the starter: `latest`, `best` (highest weighted dev score under unchanged scoring) or a night id. Seeding from a night whose checkpoint has no dev metrics (it kept nothing and was not seeded) is refused before anything starts. The seed night's measured noise carries over when the scoring is unchanged, so no A/A run is due; without it, round 1 starts with the A/A run.
- **Rescore.** When the scenario's scoring files changed since the kept commit was scored, old scores can't be compared: a continued or seeded night first evaluates that commit again in one extra round, then measures noise again. The extra round's row is an `experiment` row with `model` null.
- **Coder.** A Pi coding-agent session that runs in the worker, so credentials stay on the host, with exactly four tools (`read`, `write`, `edit`, `bash`) that act inside the sandbox. Nothing from the host reaches the session: no agent files, skills, settings or environment. Its prompt carries the scenario's spec, the night so far, the metrics still short of their thresholds, the hypothesis, how the keep works, and the time and budget it has. The session is persisted per experiment so it can be reopened.
- **Send-backs, reserve and wrap-up.** Coders stop early, with open tasks or no measurement. A coder that stops outside its reserve (the last part of its time or budget), or with an open task list or a missing train measurement, is sent back for one more turn, a bounded number of times. The wrap-up (close tasks, update the measurement and notes, change no more code) comes at most once per experiment: when the reserve starts while the coder works, or as one more turn after the send-back loop ends for a coder sent back at least once, also when the loop ended on the send-back cap before the reserve. No wrap-up with under 3 minutes left, after a time or budget cap stop, or for a coder never sent back. So on a 5-minute experiment, all eight send-backs of a mock coder and its wrap-up must start within the first 2 minutes. A repair gets neither.
- **End of an experiment.** However the coder stops (done, timeout, idle, budget, agent error, credits), its partial work is committed: whatever it committed itself is squashed into exactly one commit whose only parent is the commit the sandbox started from. A turn that ends on a failed model call (a lost connection) is a stop like any other, so the send-back rules carry the session on; agent error is only for a prompt call that threw. Only a cancelled experiment commits nothing. A coder is idle when its session shows no activity for longer than a limit the build chooses, longer while a tool runs.
- **Web research guard.** The coder may search and fetch public web pages, on the host. The guard limits it to plain search and readable fetches, refuses the project's own repository (it holds the gold), other GitHub pages and video hosts. Off in mock mode.
- **Evaluator.** One sandbox per evaluation, never the coder's, so the coder never touches the runner or the inputs. A program crash, a timeout, a scorer failure or, on dev, a stage that wrote no output is an outcome (`error`, not scored) with the run log's tail for the reviewer and the next coder. Test always runs every stage. A path to the proxy that is down fails the evaluation instead of scoring it: an outage never becomes a score.
- **Standard metrics.** Latency (from the runner's timings) and cost (from the proxy's ledger) are measured the same way for every scenario, outside the code under optimization, and recorded on every scored row.
- **Reviewer.** One tool-less Pi session per round, on a different model or effort than the coder. It reads the spec, the checkpoint, the diff, the dev metrics with per-item errors, the run logs, the coder's notes and the night so far, and writes `feedback`, the next `hypothesis` and a `verdict`. It decides nothing, reviews reverted rounds too, never names a dev item, and a failed review never kills the night.
- **Notes, trajectory and rejected diffs.** Every experiment leaves a note (the coder's part, then the reviewer's verdict), every round a history line, every round that kept nothing its diff. They are masked for held-out names and travel in the bundle, so each later coder reads what was tried and why it lost, within a size budget (the build chooses it) that drops the oldest detail first.
- **Lessons across nights.** A night's notes die with it; the scenario's `lessons.md`, part of every bundle, is the only memory between nights. After a night ends, a model proposes small operations (add, edit, drop) on that file from the night's notes and reviews; code applies them, so untouched lessons stay byte for byte. Gates keep out held-out names, metric values, near-duplicates and overlong lessons and files (the build chooses the size bounds). One distillation at a time per scenario. A mock night proposes and never applies.
- **Metering proxy.** Sandboxes hold no provider key: a metered program reaches models only through the proxy, with a token bound to one coder attempt or one evaluation, its allowed models and a `$` cap. Every call is metered into a ledger. Within a night a repeated call is replayed for free, so unchanged code scores the same and a metric moves only where a change reached. A coder's call repeated within the retry window of its last answer is a retry and goes to the provider.
- **Sandboxes.** One interface, one backend: a Docker container per sandbox, fresh image plus a commit. No git credentials enter a sandbox. Names are deterministic, so interrupted work finds its sandbox and a prefix sweep cleans a night. A timeout or abort kills the command's whole process tree.
- **Mock mode.** `--mock` runs the same night on scripted models: runtime, sandboxes, sessions, tools, commits, evaluations, proxy and files are real, no provider is called. It is how the done signal runs for free.
- **Worker API and app.** The API reads nights from the files, so status never depends on the runtime, and offers stop, resume, continue and export. The app (Next.js) lists nights and shows one night live: status and controls, the current experiment, kept and test metrics per stage, a convergence chart, each experiment's metrics and diff, and an export button.
- **Export.** A kept commit leaves as plain files, as a git repository with the kept lineage as history, or as a push to a remote branch. It never force-pushes and never runs a command transport: a remote that starts with `-`, has whitespace inside it or names a remote helper (`<name>::`, such as `ext::`) is refused. `best` is the kept commit of the most recently finished night.
- **Tracing.** Model calls, tool calls, sandbox commands and metered calls are OpenTelemetry spans under the night's work, and dev metrics are mirrored as scores in the runtime's dashboard. For debugging only; no decision reads them.

## Interfaces the build must honour

### Given inputs and tools

- given, never changed by you: `scenarios/` (`datenorm`, `datenorm-hard`, `capitals`, `graphrag`), `configs/` (`capitals-smoke.yaml`, `datenorm-smoke.yaml`, `datenorm.yaml`, `graphrag-smoke.yaml`, `graphrag.yaml`, `e2e/plateau.yaml`, `e2e/budget.yaml`, `e2e/overfit.yaml`), `docker/python.Dockerfile`, `docker/graphrag.Dockerfile`, `.env.example`, Pi's docs at `/docs/pi/`, `E2E.md` (this file's done signal as a procedure; this file wins)
- given as a start, yours to extend or replace: `package.json` and `package-lock.json` (the `inngest` package and the `dev:inngest` script only), `tsconfig.json`, `.gitignore`, `src/hello.ts` (a placeholder function)
- host tools: Node 24, Docker, `git`, `tar`, `bash`, `python3`, `uv`
- images: `codeclimb-python` (from `docker/python.Dockerfile`), `codeclimb-graphrag` (from `docker/graphrag.Dockerfile`, build context `scenarios/graphrag`)
- npm scripts: `dev:inngest` (given), `worker`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:scenario:overfit`, `export`, `lessons`, `dev`, `build`, `start`, `typecheck`, `test`
- `build:scenario:overfit` runs `scenarios/datenorm/scripts/build_overfit.py --out generated/datenorm-overfit`, the scenario `configs/e2e/overfit.yaml` names
- install works with lifecycle scripts off (`npm ci --ignore-scripts`)

### Services

| service | address |
|---|---|
| Inngest dev server (`npm run dev:inngest`) | `http://127.0.0.1:8288` |
| worker API (up as soon as `npm run worker` is; no token on loopback) | `http://127.0.0.1:7421` |
| app (`npm run dev`) | loopback, on a port of the build's choice that the worker and the dev server do not use |

- started together, `npm run dev:inngest` and `npm run worker` both answer within 60 s; the worker API answers (any status below 500 on `GET /api/nights`) before the dev server is up, with no `.env` file and no `runs-inngest/` folder. A worker started again answers within 60 s too
- the given `dev:inngest` has the dev server look for the worker's Inngest endpoint at `http://localhost:3000/api/inngest`, with auto-discovery off; a dev server that already runs was started the same way
- Docker may be a remote daemon: it is reached through `DOCKER_HOST` when that is set (no local socket), and it shares no files with the worker except the checkout, at the same path. `CODECLIMB_PROXY_HOST` may then be preset to the Docker bridge address

### CLI

| command | does |
|---|---|
| `run-night --config <yaml> [--night-id ID] [--sandbox docker] [--seed ID\|latest\|best] [--direction TEXT] [--rounds N] [--no-wait] [--mock [--mock-offline N]]` | Starts a night and follows it |
| `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N]` | More rounds on an ended night (default: the newest ended one) |
| `run-night stop --night ID` | Hard stop with reason `manual`; prints `stopped` once `stop.json` exists (`done` if the night finished first) |
| `run-night resume --night ID` | Ends a pause |
| `validate-results <file>`, `validate-results --schema` | Checks a rows file against the row schema; prints the schema |
| `export (--config <yaml> \| --results <jsonl>) [--exp <id>\|best] (--to-dir <path> [--with-history] [--force] \| --to-remote <url> [--branch <name>])` | Export |
| `lessons distill --config … --night ID [--apply]`, `lessons apply --config … --night ID`, `lessons format --config … [--check]` | Lessons by hand |

- night id: `--night-id`, else `n<YYYYMMDD>-<HHMMSS>`; 1 to 48 letters, digits or hyphens, not starting with a hyphen. A start with a used id starts nothing
- following: prints new rows as they land; prints `done` when `done.json` appears or `stopped` when `stop.json` does, then exits 0. `--no-wait` exits 0 after the start
- `done` and `stopped`, from a following `run-night` and from `stop`, are the first word of a line of their own. Ctrl-C detaches; the night keeps running
- `--rounds` replaces `max_rounds` on a new night and adds rounds on a continued one; `--seed` wins over the config's `seed`; `--sandbox` takes only `docker`
- a night under `runs-inngest/mock/` is continued and distilled as a mock; `continue` takes no `--mock`

### Night config

| field | default | meaning |
|---|---|---|
| `scenario` | required | Scenario directory, relative to where `run-night` starts |
| `sandbox` | required | `docker`; anything else is refused |
| `max_rounds` | required | ≥ 1 |
| `max_tokens` | none | Cap on coder + reviewer tokens |
| `plateau_rounds` | 3 | Rounds in a row that kept nothing; 0 = never |
| `deadline` | required | ISO time, or a duration from night start (`90m`, `8h`, `30s`) |
| `hard_deadline` | none | ISO time, or a duration from the start (`90m`, `8h`, `30s`). When it passes the night stops hard, even mid-step: the running experiment or evaluation is aborted, the night's sandboxes are removed and `stop.json` has `reason` `hard_deadline`; no test score |
| `timeouts.experiment_min`, `timeouts.eval_min` | required | Per experiment; per stage run |
| `model`, `reviewer_model` | required | `<provider>/<id>` |
| `coder_thinking`, `reviewer_thinking` | `medium`, `low` | `off`, `minimal`, `low`, `medium`, `high` |
| `allowed_models` | `[]` | Models the program may call; empty = unmetered |
| `primary_metric` | required | The displayed score; an evaluation counts only if it reports it |
| `thresholds` | required | Metric → target > 0, higher is better |
| `weights` | 1 each | Metric → weight > 0, threshold metrics only |
| `gates` | `{}` | Metric → cap; a missing metric fails its gate |
| `standard_metrics` | `latency`, `cost`: true; `latency_metric`: `latency_total_s`; `cost_metric`: `cost_per_item_usd`; `min_efficiency_gain`: 0.10 | Which standard metrics the agents are told about; the reviewer mentions a change in one larger than `min_efficiency_gain` (a share in (0, 1)) |
| `budget_usd.experiment`, `budget_usd.night` | required | Caps |
| `noise_margin` | `min` 0.002, `max` 0.005, `fixed` none, `scale_by_replay` true | |
| `lessons` | `apply` if the scenario declares lessons, else `off` | `off`, `propose`, `apply` |
| `seed` | none | A night id, `latest` or `best` |
| `results_path` | required | `<folder>/results.jsonl`, relative to the runs folder |

- runs folder: `<root>/runs-inngest/`; a mock night writes under `<root>/runs-inngest/mock/`. `<root>` is `CODECLIMB_ROOT`, default the start directory. The results directory is the folder of the resolved `results_path`
- refused at load: `reviewer_model` equal to `model` with the same thinking level; an unparsable `deadline`; a `results_path` that is absolute, has `..`, or is not one folder and a file name; `lessons` not `off` on a scenario without lessons
- also refused at load: a `budget_usd.experiment` above `budget_usd.night`; a `max_rounds` below 1; a thinking level outside the five; a threshold or a weight not above 0, or a weight on a metric without a threshold; a `min_efficiency_gain` outside (0, 1)

### Scenario contract

CodeClimb never reads a scenario's data: it runs the commands of `scenarios/<name>/scenario.yaml`, on the host through `bash -c` in the scenario directory. Load fails without `scenario.yaml` or `starter/`.

| field | meaning |
|---|---|
| `name`, `image` | Scenario name; the Docker image of its sandboxes |
| `bundle` | Host: writes the coder's bundle to `{out}` (must contain `spec/`; refuses a non-empty target). A `train/` in it switches on the train-measurement duty |
| `stages[]` | At least one, run in order; names match `^[a-z][a-z0-9_-]*$` |
| `stages[].inputs` | Host: writes the `{split}` input to `{inputs}` |
| `stages[].files` | Sandbox absolute path → scenario-relative host path, uploaded before `run` |
| `stages[].run` | Sandbox, cwd `/repo`: runs the program on `{inputs}`, writes under `{out}`, optionally `timings.jsonl` |
| `stages[].score`, `.details` (opt) | Host: scores the downloaded `{out}` on `{split}` into the JSON `{report}`; `details` adds per-item errors and is used on dev only |
| `headline`, `diagnostics` (opt) | Metric names to report; regexes of metrics the reviewer reads |
| `protocol` (opt) | Files the reviewer reads; `path#Heading` = one section |
| `check` (opt) | Host: reads the commit in `{repo}`, writes `{report}` with lists `errors` and `notes`; errors block the evaluation. Saved as `exps/<exp>/check.json` |
| `scan` (opt) | Host: reads `{text}`, writes `{report}` with the list `found` of held-out names; each is masked as `[hidden]` |
| `lessons` (opt) | Path of the scenario's `lessons.md` |

- placeholders are shell-quoted absolute paths; `{split}` is `dev` each round and `test` once per run, never `train`
- in the sandbox: `{inputs}` = `/eval/<stage>/inputs.jsonl`, `{out}` = `/eval/<stage>/out`; the commit's `uv.lock` environment is in `/repo/.venv`
- a program reaches models through `OPENAI_BASE_URL` / `OPENAI_API_KEY` (also `CODECLIMB_LLM_BASE_URL` / `CODECLIMB_LLM_API_KEY`); the base URL ends in `/v1`
- metrics: a report's numbers flattened with `.`; `ci95: [lo, hi]` becomes `ci95_half`; with several stages each name gets `<stage>.` in front; each stage adds `output_bytes`
- standard metrics: from `timings.jsonl` lines `{op, id?, ms, warmup?}`: `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s`, `latency_total_s`; a line with `warmup: true` counts toward none of them. From the ledger: `cost_usd`, `cost_per_item_usd` (`cost_usd` over the items: one item per line of every stage's `inputs.jsonl`), `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`
- `night.json` records a sha256 of each of the scenario's scoring files (`scenario.yaml` and every file under `evaluators/` and `gold/`, Python caches left out) as `metric_script_sha256`, so a later night can tell that the scoring changed

### Ids and names

| thing | id |
|---|---|
| starter / seed commit | `<night>-r0-starter` / `<night>-r0-seed` |
| experiment; its repair | `<night>-r<N>-e0`; `<night>-r<N>-e1` |
| dev evaluation; noise run; test evaluation | `<exp>-eval`; `<exp>-noise-r<N>`; `<night>-test-r<N>` |
| sandbox | `cc-<exp id>` for a coder; `cc-<eval id>` for an evaluation; every other sandbox of a night also starts with `cc-<night>` |
| experiment commit | `refs/exp/<exp id>` in `experiments.git`, message `<exp id>: <hypothesis>` |

### Files a night writes

Under the results directory:

| path | content |
|---|---|
| `results.jsonl` | Every night's rows, deduplicated by `eval_id` |
| `experiments.git` | Bare repository, one commit per experiment |
| `lessons/<night>-r<N>/` | `lessons.md`, `changes.md`, `proposal.json` (`ops`; `applied: true` only once applied) |
| `nights/<id>/night.json` | `night_id`, `startedAt`, `deadlineMs`, the round-0 experiment, `seed`, the resolved `config`, `metric_script_sha256`, `lessons_sha256` |
| `nights/<id>/done.json` | `night_id`, `stop_reason`, `rounds` (the last recorded round), `kept` (`exp_id`, `commit`, `dev_score`), `test_metrics`, `spend_usd`, `finished_at` |
| `nights/<id>/stop.json` | `at`, `reason`: `manual` (the CLI's stop), `app` (the worker API's), `cancelled` (a cancel from outside), `failed` (a night that failed for good, a pause that timed out), `hard_deadline`; the backstop gives `cancelled` or `failed`, the build's choice. The first stop wins. Never beside a `done.json` |
| `nights/<id>/pause.json`, `pauses.jsonl` | The current pause (deleted when it ends); every pause |
| `nights/<id>/noise.json` | The A/A run: `margin`, `first`, `second` |
| `nights/<id>/bundle/` | The coder's `/spec`: `spec/`, optional `train/`, `history/notes/r<N>-e<n>.md`, `history/r<N>.diff` |
| `nights/<id>/reviews/r<N>.json` | `round`, `model`, `feedback`, `hypothesis`, `verdict`, `reviewer_usd` |
| `nights/<id>/exps/<exp>/` | One folder per coder attempt (`e0`, `e1`), nothing else under `exps/`: `session/*.jsonl` (Pi's own session file: prompts, send-backs and the wrap-up are its user messages; a failed model call is an assistant message with stop reason `error`), `code-state.json` (rewritten while the coder works; at the end `stop`: `done`, `timeout`, `idle`, `budget`, `agent_error`, `credits`, `cancelled`; never written again after), `tasks.json`, `train-score.json`, `check.json`, `meter-dev.jsonl` |
| `nights/<id>/evals/<eval>/` | `<stage>/inputs.jsonl`, `<stage>/run.log`, `<stage>/outputs/`, `<stage>/report.json`, `meter.jsonl`, `metrics.json` (only when every stage was scored) |

- the coder leaves in its sandbox: `/tmp/tasks.json` (a list of `{task, check, status}`, status `todo`, `done` or `dropped`), `/tmp/notes.md`, `/tmp/train-score.json` (`before`, `after`, `command`); its final message ends with `APPROACH: <one sentence>`
- a send-back message contains "You stopped with N of N minutes"; the wrap-up contains "change no more code". No other prompt contains either phrase
- a scenario's `lessons.md`: a `# ` title, a preamble, then `## ` sections holding only `- ` bullets, each wrapping onto lines indented by two spaces

### Result row

One JSON line per experiment, noise run and test evaluation.

| fields | meaning |
|---|---|
| `night_id`, `exp_id`, `parent_id`, `eval_id`, `round` | Identity; `eval_id` is the unique key |
| `stack`, `backend` | `inngest`; `docker` |
| `kind`, `split` | `experiment`, `noise`, `test`; `dev`, `test` |
| `model`, `reviewer_model`, `hypothesis`, `commit` | What was tried; `model` and `hypothesis` may be null |
| `metrics` | Flat name → number. A row that was not scored holds only the primary metric, at 0 |
| `decision` | `keep`, `revert`, `error` |
| `score`, `decision_reason`, `unchanged` | The weighted score; why; no code change |
| `coder_usd`, `dev_usd`, `program_usd`, `reviewer_usd`, `tokens` | Spend and tokens |
| `wall_s`, `infra_errors` | Wall time in seconds, with a breakdown per phase if you want one; infrastructure failures |

| `stop_reason` | when |
|---|---|
| `max_rounds` | The next round would pass `max_rounds` |
| `deadline` | The deadline passed |
| `budget` | The night budget can't cover another round and the test evaluation |
| `tokens` | The token cap can't cover another round |
| `plateau` | `plateau_rounds` rounds in a row kept nothing |
| `outage` | The smoke test kept failing |
| `thresholds` | Every threshold metric of the checkpoint reached its target |

The first five are checked in this order at the start of a round; `thresholds` at its end.

### Mock mode

- results under `runs-inngest/mock/<results_path>`; every cost is 0; model checks, the smoke test and web research are skipped; lessons are never applied
- mock coder: on each prompt, one `bash` tool call that appends a line to `MOCK.md` and writes `/tmp/tasks.json` (one task, status `done`), `/tmp/notes.md` (`mock note`) and `/tmp/train-score.json`; after the tool result, the closing text `APPROACH: mock change, no real work`. Send-backs and resumes are answered the same way
- mock reviewer: JSON with `feedback` = `mock feedback`, `hypothesis` = `mock hypothesis`, `verdict` = `mock verdict`
- mock lessons model: JSON with an empty `ops` list
- program calls: chat answers `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0
- `--mock-offline N`: the coder's model calls 2 to N+1 of the night's first experiment fail, each as an assistant message with stop reason `error` and the text `fetch failed`
- `CODECLIMB_MOCK_CREDIT=<who>:<n>`: a test hook with no CLI flag; on a mock night, call number `n` of the night's calls by `who` (`coder`, `reviewer` or `program`) fails once with a credit error, to exercise the credit pause

### Metering proxy

- routes, OpenAI-shaped: `POST /v1/chat/completions` (text messages, no tools, no streaming), `POST /v1/embeddings`, `POST /v1/decisions` (`model`, `state`, `questions` → `answers`), `POST /v1/rerank` (`model`, `query`, `documents`, `top_n` → `results` of `index` and `relevance_score`), `POST /v1/_op` (`op`: names the operation later calls belong to; answers 200)
- refusals carry `error.message` and `error.type`: 401 `authentication_error`, 403 `permission_error` (model not allowed), 402 `insufficient_quota` (cap spent, credits), 400 / 413 `invalid_request_error`, 502 `api_error`
- `meter.jsonl` (an evaluation) and `meter-dev.jsonl` (a coder), one line per call: `kind` (`chat`, `embeddings`, `decisions`, `rerank`), `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd`, `ms`; `error` only on a failed or refused call
- the metered path must work on a plain Linux Docker Engine as well as Docker Desktop: with no variable set, and with `CODECLIMB_PROXY_HOST` preset to the Docker bridge address

### Worker API

`GET /api/health`; `GET /api/nights`, `/api/nights/:id`, `/api/nights/:id/live`, `/api/nights/:id/report`; `POST /api/nights/:id/stop`, `/resume`, `/continue` (`{direction?, rounds}`); `GET /api/nights/:id/export/:exp?format=repo|source|bundle`; `POST /api/nights/:id/export/:exp`. Night status, from files: `finished`, `stopped`, `paused`, `stale`, `running`. It finds nights under `runs-inngest/*/nights/` and `runs-inngest/mock/*/nights/`.

### Environment

An optional `.env` (from `.env.example`), loaded by the CLI and the worker when present; values in the shell win. Mock nights need none: everything below has a default or is unset.

| variable | meaning |
|---|---|
| `ANTHROPIC_API_KEY`, `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` | Provider keys; another OpenRouter address, for tests |
| `CODECLIMB_PI_AUTH_PATH` | Another Pi `auth.json` |
| `DOCKER_HOST` | Docker's own variable: the daemon to use, when set |
| `INNGEST_DEV` | Unset, the CLI and the worker use the local dev server on 8288; Inngest Cloud only when a deployment sets otherwise |
| `CODECLIMB_ROOT` | The checkout config paths and `runs-inngest/` resolve against |
| `CODECLIMB_API_HOST`, `CODECLIMB_API_PORT` | The worker API, default `127.0.0.1:7421` |
| `CODECLIMB_WORKER_TOKEN`, `CODECLIMB_WORKER_URL` | The API's bearer off loopback; where the app reaches the worker |
| `CODECLIMB_PROXY_HOST`, `CODECLIMB_PROXY_PORT` | Where the proxy binds. A host that is set is used as given: an address sandboxes can reach, the Docker bridge address on Linux |
| `CODECLIMB_PAUSE_TIMEOUT_S`, `CODECLIMB_BACKSTOP_S` | Test hooks: the pause timeout and the night backstop, in seconds |
| `CODECLIMB_MOCK_CREDIT` | Test hook: a mock night's scripted credit error ([[#Mock mode]]) |

- the worker, which runs the night, reads the three test hooks when it starts, from `.env` or its own shell; set in the CLI's shell alone they do nothing

## Runtime and tools

Inngest is the durable runtime. CodeClimb uses it for:

- durability: a night takes hours and must outlive a worker crash without doing finished work again
- composition: a night starts each experiment and each evaluation as work of its own and waits for it, so one failure is an outcome, not the night's end
- retries: work that fails or is interrupted is tried again
- cancellation: a stop reaches the night and everything it started
- waiting: a paused night waits for its resume at no cost, with a timeout
- events: start, stop, resume and the end of a night; one night id is one run
- concurrency: one lessons distillation at a time per scenario
- observability: traces and scores of a night in its dashboard

Docker gives each coder and each evaluation an isolated, disposable machine. Pi (`@earendil-works/pi-coding-agent`) is the agent runtime of the coder, the reviewer and the lessons model, and its scripted provider is the mock. The metering proxy forwards program calls to OpenRouter, or to any other provider through Pi's model layer.

Stack: TypeScript on Node 24, ESM; Next.js and React for the app; Node's test runner for unit tests of the pure parts.

## Numbers

| what | value |
|---|---|
| A/A runs per variation | at most 2 |
| repairs per round | 1 |
| held-out names in a diff that block a keep | ≥ 2 |
| smoke test | 7 tries, 5 minutes apart |
| pause timeout; night backstop | 3 days; 4 days |
| coder reserve | the last 20% of time or budget |
| send-backs | at most 8; none with under 3 minutes left; one wrap-up |
| fresh restarts after a lost sandbox | 1 |
| coder retry window (a repeat within it is not replayed) | 5 seconds |
| sandbox size | 2 vCPU, 2 GiB |
| starter commit | deterministic: the same tree gives the same SHA |
| `npm ci --ignore-scripts`; `typecheck`; `npm test` | within 900 s; 600 s; 1,200 s. `npm test` runs with no service up (the `codeclimb-python` image is built) |
| `build:image`; `build:image:graphrag` | within 1,200 s each |
| `validate-results` on a night's rows file | within 300 s |
| a mock night, started and followed to `done` | within 300 s |
| a night reaches a round (`exps/<id>-r<N>-e0/` exists) | within 120 s of its start |
| `run-night --no-wait`; `run-night stop` | returns within 120 s each |
| a following `run-night` after `stopped` | exits within 60 s of the stop |
| a night after a worker kill and restart | `done.json` within 480 s of the restarted worker answering |

Scenario numbers (thresholds, budgets, timeouts, models) live in `configs/*.yaml`.

## Dependencies

Pinned to exact versions. A package the table does not list (type definitions, for example) is the build's choice.

| package | version |
|---|---|
| `@earendil-works/pi-coding-agent` | 1.3.0 |
| `@earendil-works/pi-ai` | 1.3.0 |
| `pi-web-access` | 0.47.0 |
| `inngest` | 4.25.0 |
| `@inngest/otel` | 0.2.2 |
| `@opentelemetry/api` | 1.10.0 |
| `next` | 16.4.2 |
| `react`, `react-dom` | 19.3.1 |
| `yaml` | 2.9.1 |
| `tsx` | 4.23.15 |
| `typescript` | 6.0.3 |
