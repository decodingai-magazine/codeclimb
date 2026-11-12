---
name: codeclimb-e2e
description: End-to-end tests for CodeClimb, whole nights on the local Agent Server. Use to check that CodeClimb works, after changing the loop, the graphs, sandboxes, Pi sessions, the metering proxy or the stops, or when asked to run or verify a night end to end.
---

# CodeClimb end-to-end tests

An end-to-end test runs a whole night: the graphs, sandboxes, Pi sessions, commits, evaluations, the review, the test evaluation and the result files. Unit tests don't cover this.

Eleven scenarios. 1 to 7 run on mock models and cost nothing: run all seven, in order, every time. 8 to 11 run on real models and spend money: run one only after the user says so for that scenario.

## Setup

1. `docker images` lists `codeclimb-python` and, for scenario 7, `codeclimb-graphrag`. If not: `npm run build:image`, `npm run build:image:graphrag`. Scenario 7's host commands need `uv`.
2. `npm run server` is running on the code under test. It has no hot reload: restart it after every code change.
3. No other night is running on this server (`docker ps` shows no `cc-` container). One server runs one night at a time.

Give every night a fresh id with `--night-id` (for example `plateau-$(date +%H%M%S)`): an id that was used before is refused.

## Free scenarios

| # | Scenario | Command |
|---|---|---|
| 1 | Metered program | `npm run run-night -- --config configs/capitals-smoke.yaml --mock` |
| 2 | Two rounds, iteration cap | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` |
| 3 | Plateau cap | `npm run run-night -- --config configs/e2e/plateau.yaml --mock` |
| 4 | Hard stop mid-round | scenario 2's command with `--no-wait`, then the steps below |
| 5 | Kill and restart | scenario 2's command with `--no-wait`, then the steps below |
| 6 | Lost connection mid-turn | `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` |
| 7 | Multi-stage scenario | `npm run run-night -- --config configs/graphrag-smoke.yaml --mock` |

`--mock` replaces the models with scripted ones. Mock metrics mean nothing: a score of 0 is expected, and the check is that everything ran. Mock nights write to `runs-langchain/mock/<results folder>/`; below, `N` is `runs-langchain/mock/<results folder>/nights/<id>`.

### Checks for every finished mock night (1, 2, 3, 6)

- `run-night` prints `done`.
- `N/done.json` exists; `N/stop.json` and `N/pause.json` don't.
- `npm run validate-results -- runs-langchain/mock/<results folder>/results.jsonl` passes.
- `results.jsonl` has a row for every experiment of every round, plus one `test` row.
- `git -C runs-langchain/mock/<results folder>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit, and its diff adds `MOCK.md`.
- `N/exps/*/code-state.json` has `stop: done`, and `N/exps/*/session/` holds a session file.
- `N/reviews/r<n>.json` exists for every round, with `feedback: mock feedback`.
- `N/exps/*/train-score.json` and `N/exps/*/tasks.json` exist. The session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code").
- `N/bundle/history/notes/r<round>-e<n>.md` exists per experiment, with a `mock note` coder part and, where the round was reviewed, a `mock verdict` reviewer part.
- Every experiment row has a `decision_reason`.
- `done.json` has `spend_usd: 0`.
- `docker ps` shows no `cc-<id>` container.

A failure in the coder or the review falls back quietly in some paths. Read `code-state.json` and the reviews, not only `stop_reason`.

### Checks per scenario

**1. Metered program.** `stop_reason` is `max_rounds`. Capitals scores 0 and keeps nothing. `N/evals/*/meter.jsonl` lists the program's calls, none with `error`.

**2. Iteration cap.** `stop_reason` is `max_rounds` and `done.json` has `rounds: 2`. Round 1 is kept (the starter scores above 0 on dev), a `noise` row follows in round 2, and `N/noise.json` exists.

**3. Plateau cap.** `stop_reason` is `plateau` and `done.json` has `rounds: 1`, though the config allows 3.

**4. Hard stop mid-round.**

1. Start the night with `--no-wait`. Wait until `N/exps/<id>-r1-e0/` exists.
2. `npm run run-night -- stop --night <id>`. It prints `stopped`.
3. Wait 30 s, then check: `N/stop.json` has `reason: manual`; there is no `N/done.json`; `results.jsonl` has no `test` row for the night; `docker ps` shows no `cc-<id>` container.

**5. Kill and restart.** Every night run is created with `durability: "sync"`, so a finished step's result is in Postgres within about a second. A kill of the server container reruns only the step that was running. After `up`, the server picks the killed run up by itself through its runs sweeper, about 2 minutes later.

1. Follow container creates in the background: `docker events --filter type=container --filter event=create --format '{{.Time}} {{.Actor.Attributes.name}}'`.
2. Start the night with `--no-wait`.
3. Poll every 50 ms, up to 2 minutes, until `N/exps/<id>-r2-e0/` exists: round 1's row is in `results.jsonl`. If the night finishes first, nothing was killed: run scenario 5 again, up to 3 times, and only then report it as not run.
4. Record the sha256 and mtime of `N/exps/<id>-r1-e0/code-state.json`.
5. `docker kill` the server container: the stack's `langgraph-api` service, named in `npm run server`'s last line (`<project>-langgraph-api-1`). Leave its Postgres and Redis running. Note the time.
6. `npm run server` again. Start nothing else: no watchdog, no manual resume. The server reruns the night by itself about 2 minutes after `up`.
7. Wait for `N/done.json`, then check:
   - every `eval_id` is in `results.jsonl` exactly once;
   - round 1's `code-state.json` has the recorded sha256 and mtime (round 1's coder did not run again);
   - no `cc-<id>-r1-` sandbox was created after the kill (the night resumed from its last stored step, it did not replay round 1); only the step running at the kill reruns, on a new sandbox of the same name;
   - the thread has one server run, `success` (`curl -s http://127.0.0.1:8123/threads/<thread>/runs`);
   - the checks for a finished mock night hold.

   If only the `cc-<id>-r1-` check fails, run scenario 5 again before suspecting the code: the kill comes a second or two after round 1's last step, close to the ~1 s that `sync` takes to store a result.

**6. Lost connection mid-turn.** `--mock-offline 6` makes six of the first coder's model calls fail as a lost connection. Scenario 2's checks hold, and `N/exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one: the session carried on.

**7. Multi-stage scenario.** Graphrag has three stages, a metered program, `check`, `scan` and lessons. The mock program's answers are canned, so a stage may fail and a round may end in `error` with a repair `e1`. These checks hold either way:

- `run-night` prints `done`; `N/done.json` exists and `N/stop.json` doesn't; `validate-results` passes.
- Every round has an experiment row with a `decision_reason`, and there is one `test` row.
- Every evaluation has `N/evals/<eval>/extraction/inputs.jsonl`.
- Every experiment with a commit has `N/exps/<exp>/check.json`.
- Where an evaluation succeeded, its metric names start with `extraction.`, `graph.` or `retrieval.`.
- Within a minute of `done`, `runs-langchain/mock/graphrag-smoke/lessons/<id>-r<last round>/proposal.json` exists with `applied: false`, and `git status` shows the scenario's `lessons.md` unchanged.
- `docker ps` shows no `cc-<id>` container.

## Paid scenarios

Each spends real money. Before running one, ask the user and name the scenario and its ceiling. They need provider credentials (`.env` or Pi's `auth.json`) and write to `runs-langchain/<results folder>/`, with no `mock` in the path.

| # | Scenario | Command | Ceiling | Passes when |
|---|---|---|---|---|
| 8 | Capitals | `npm run run-night -- --config configs/capitals-smoke.yaml` | $0.50 | `done`; a `test` row; `spend_usd` above 0 and at most 0.50; `meter.jsonl` shows real calls |
| 9 | Datenorm | `npm run run-night -- --config configs/datenorm-smoke.yaml` | $0.50 | `done`; at least one experiment row with `keep`; test accuracy above 0.125, the starter's dev score |
| 10 | Cost cap | `npm run run-night -- --config configs/e2e/budget.yaml` | $0.20 | `stop_reason` is `budget` within 3 rounds; `spend_usd` under 0.20 |
| 11 | Overfit | `npm run build:scenario:overfit`, then `npm run run-night -- --config configs/e2e/overfit.yaml` | $0.50 | `stop_reason` is `thresholds` within 4 rounds; the `test` row's accuracy equals the kept commit's dev accuracy |

For every paid night also check: `N/done.json` exists with no `stop.json`; `validate-results` passes; `docker ps` shows no `cc-<id>` container.

Scenario 11 runs on a generated copy of datenorm whose dev and test hold the train items. The coder can read every answer, so a night that does not reach the threshold means the loop is broken, not the coder. Its scores say nothing about the program.

## Report

One line per scenario: passed, failed with the check that failed and the file that shows it, or not run with the reason. A scenario passes only when every one of its checks holds.
