---
name: codeclimb-e2e
description: End-to-end tests for CodeClimb, whole nights on the local Agent Server. Use to check that CodeClimb works, after changing the loop, the graphs, sandboxes, Pi sessions, the metering proxy or the stops, or when asked to run or verify a night end to end.
---

# CodeClimb end-to-end tests

An end-to-end test runs a whole night: the graphs, sandboxes, Pi sessions, commits, evaluations, the review, the test evaluation and the result files. Unit tests don't cover this.

Ten scenarios. 1 to 6 run on mock models and cost nothing: run all six, in order, every time. 7 to 10 run on real models and spend money: run one only after the user says so for that scenario.

## Setup

1. `docker images` lists `codeclimb-python`. If not: `npm run build:image`.
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

`--mock` replaces the models with scripted ones. Mock metrics mean nothing: a score of 0 is expected, and the check is that everything ran. Mock nights write to `runs/mock/<results folder>/`; below, `N` is `runs/mock/<results folder>/nights/<id>`.

### Checks for every finished mock night (1, 2, 3, 6)

- `run-night` prints `done`.
- `N/done.json` exists; `N/stop.json` and `N/pause.json` don't.
- `npm run validate-results -- runs/mock/<results folder>/results.jsonl` passes.
- `results.jsonl` has a row for every experiment of every round, plus one `test` row.
- `git -C runs/mock/<results folder>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit, and its diff adds `MOCK.md`.
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

**5. Kill and restart.** The server writes its state to disk 3 s after its last change, so kill it only once round 1 is on disk.

1. Start the night with `--no-wait`.
2. Wait, up to 2 minutes, until both hold: `N/exps/<id>-r2-e0/` exists, and `.langgraph_api/.langgraphjs_api.checkpointer.json` is newer than `runs/mock/datenorm-smoke/results.jsonl`. If the night finishes first, nothing was killed: run scenario 5 again, up to 3 times, and only then report it as not run.
3. Save a copy of `N/exps/<id>-r1-e0/code-state.json`.
4. `kill -9` the process listening on port 2024 (`lsof -nP -t -iTCP:2024 -sTCP:LISTEN`), then start `npm run server` again. Start nothing else: the server reruns the night by itself.
5. Wait for `N/done.json`, then check: every `eval_id` is in `results.jsonl` exactly once; round 1's `code-state.json` equals the saved copy (round 1 was not redone); the checks for a finished mock night hold.

**6. Lost connection mid-turn.** `--mock-offline 6` makes six of the first coder's model calls fail as a lost connection. Scenario 2's checks hold, and `N/exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one: the session carried on.

## Paid scenarios

Each spends real money. Before running one, ask the user and name the scenario and its ceiling. They need provider credentials (`.env` or Pi's `auth.json`) and write to `runs/<results folder>/`, with no `mock` in the path.

| # | Scenario | Command | Ceiling | Passes when |
|---|---|---|---|---|
| 7 | Capitals | `npm run run-night -- --config configs/capitals-smoke.yaml` | $2 | `done`; a `test` row; `spend_usd` above 0 and at most 2; `meter.jsonl` shows real calls |
| 8 | Datenorm | `npm run run-night -- --config configs/datenorm-smoke.yaml` | $10 | `done`; at least one experiment row with `keep`; test accuracy above 0.125, the starter's dev score |
| 9 | Cost cap | `npm run run-night -- --config configs/e2e/budget.yaml` | $0.20 | `stop_reason` is `budget` within 3 rounds; `spend_usd` under 0.20 |
| 10 | Overfit | `npm run build:scenario:overfit`, then `npm run run-night -- --config configs/e2e/overfit.yaml` | $4 | `stop_reason` is `thresholds` within 4 rounds; the `test` row's accuracy equals the kept commit's dev accuracy |

For every paid night also check: `N/done.json` exists with no `stop.json`; `validate-results` passes; `docker ps` shows no `cc-<id>` container.

Scenario 10 runs on a generated copy of datenorm whose dev and test hold the train items. The coder can read every answer, so a night that does not reach the threshold means the loop is broken, not the coder. Its scores say nothing about the program.

## Report

One line per scenario: passed, failed with the check that failed and the file that shows it, or not run with the reason. A scenario passes only when every one of its checks holds.
