---
name: codeclimb-e2e
description: End-to-end tests for CodeClimb. Use to check that CodeClimb works as expected, after changing the loop, sandboxes, Pi sessions, the metering proxy or the Inngest functions, or when asked to run or verify a night end to end.
---

# CodeClimb end-to-end tests

An end-to-end test runs a whole night: Inngest functions, sandboxes, Pi sessions, commits, evals, the review, the test eval and the report. Unit tests don't cover this.

## What to run

Run these two nights, one after the other:

```bash
npm run run-night -- --config configs/capitals-smoke.yaml --mock
npm run run-night -- --config configs/datenorm-smoke.yaml --mock
```

| Night | What it covers |
|---|---|
| `capitals-smoke` | The program calls a model through the metering proxy |
| `datenorm-smoke` | Two rounds: the review hands its hypothesis to round 2; no metering |

`--mock` replaces the models with scripted ones. It costs nothing and needs no credentials. Metrics mean nothing, so never judge a mock night by its scores: a score of 0 is expected. The check is that everything ran.

## Setup

1. `docker images` lists `codeclimb-python`. If not: `npm run build:image`.
2. `npm run dev:inngest` is running.
3. `npm run worker` is running, on the code under test. Restart it after a code change.

If a Cloud worker is running, it holds the API port. Start the dev worker with `CODECLIMB_API_PORT=7431`. Never stop a Cloud worker that has a night running.

## What to check

Each night writes to `runs/mock/<config-name>/`. For a night `<id>`, pass only if all of these hold:

- `run-night` prints `done`, with `stop_reason` `max_rounds` or `thresholds`, not a stop or a failure.
- `nights/<id>/done.json` exists. `nights/<id>/stop.json` and `pause.json` don't.
- `npm run validate-results -- runs/mock/<config-name>/results.jsonl` passes.
- `results.jsonl` has a row for every experiment of every round, plus a `test` row.
- `git -C runs/mock/<config-name>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit, and its diff adds `MOCK.md`.
- `nights/<id>/exps/*/code-state.json` has `stop: done`, and `nights/<id>/exps/*/session/` holds a session.
- `nights/<id>/reviews/r<n>.json` exists for every round and has `feedback: mock feedback`.
- `nights/<id>/exps/*/train-score.json` exists, and the session holds two send-backs ("You stopped with N of N minutes"): the mock stops at once.
- `nights/<id>/exps/*/tasks.json` holds the mock's done task, and `nights/<id>/bundle/history/notes/` has one `<round>-e<n>.md` per experiment, with a `mock note` coder part and, where the round was reviewed, a `mock verdict` reviewer part.
- Every experiment row has a `decision_reason`. `datenorm-smoke`'s starter scores above 0, so round 1 is kept, a `noise` row follows it and `nights/<id>/noise.json` exists; `capitals-smoke` scores 0 and keeps nothing.
- `report.html` exists next to `results.jsonl`.
- `done.json` has `spend_usd: 0`.
- For `capitals-smoke`: `nights/<id>/evals/*/meter.jsonl` lists the program's calls, with no `error`.
- `docker ps` shows no `cc-<id>` container.

A failure in the coder or review falls back quietly in some paths. Read `code-state.json` and the reviews, not only `stop_reason`.

## Real models

Drop `--mock` when a change touches model calls, prompts or credentials. Smoke configs use Haiku through GitHub Copilot, so they stay cheap, but they do spend. Ask first, because this costs money.
