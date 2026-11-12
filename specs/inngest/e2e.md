# End-to-end test

The seven nights of `SPEC.md`, section "Goal and done signal", as a procedure. This file repeats that section and adds nothing; where the two differ, `SPEC.md` wins. You are done when every night below passes every check listed for it.

Mock metrics mean nothing: a score of 0 is expected. The checks prove that everything ran. A coder or review failure falls back quietly in some paths, so the files are the evidence, not `stop_reason` alone.

## Before the first night

1. Docker is running.
2. Build the images: `npm run build:image`, then `npm run build:image:graphrag` (night 7). `docker images` lists `codeclimb-python` and `codeclimb-graphrag`. `uv` is on the path (night 7's host commands).
3. Start the services, each in its own terminal, and leave them running:
   - `npm run dev:inngest` (the Inngest dev server)
   - `npm run worker`
4. After any code change, start the worker again, so it runs the code under test.
5. Run one night at a time. Before each night, `docker ps` shows no `cc-` container. Give every night a fresh night id with `--night-id <id>`: a start with a used id starts nothing.

`<runs>` below is `runs-inngest/mock`. `<name>` is the folder the night's config names in `results_path`, and `<dir>` is `<runs>/<name>`. `results.jsonl`, `experiments.git` and `lessons/` sit directly in `<dir>`; every other path below (`done.json`, `stop.json`, `pause.json`, `noise.json`, `exps/`, `reviews/`, `bundle/`, `evals/`) is under `<dir>/nights/<id>/`.

## Common checks

Nights 1, 2, 3 and 6 must pass all of these, for their night `<id>`:

- C1. `run-night` prints `done`, with `stop_reason` `max_rounds` or `thresholds` (`plateau` for night 3).
- C2. `<dir>/nights/<id>/done.json` exists; `stop.json` and `pause.json` don't.
- C3. `npm run validate-results -- <dir>/results.jsonl` passes.
- C4. `results.jsonl` has a row per experiment of every round, plus a `test` row.
- C5. `git -C <dir>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit; its diff adds `MOCK.md`.
- C6. `exps/*/code-state.json` has `stop: done`; `exps/*/session/` holds a session file.
- C7. `reviews/r<n>.json` exists for every round, with `feedback: mock feedback`.
- C8. `exps/*/train-score.json` and `exps/*/tasks.json` exist; the session holds eight send-backs ("You stopped with N of N minutes"), then one wrap-up ("change no more code").
- C9. `bundle/history/notes/r<round>-e<n>.md` exists per experiment, with a `mock note` coder part and, where reviewed, a `mock verdict` reviewer part.
- C10. Every experiment row has `decision_reason`.
- C11. `datenorm-smoke`: round 1's commit holds the starter's code, which scores above 0 on dev (accuracy 0.125), so it is kept; a `noise` row follows in round 2 and `noise.json` exists. `capitals-smoke` scores 0 and keeps nothing.
- C12. `done.json` has `spend_usd: 0`.
- C13. `capitals-smoke`: `evals/*/meter.jsonl` lists the program's calls, none with `error`.
- C14. `docker ps` shows no `cc-<id>` container.

## Night 1: the metering proxy

1. `npm run run-night -- --config configs/capitals-smoke.yaml --mock --night-id <id>`
2. `<name>` is `capitals-smoke`. Check C1 to C14.

## Night 2: two rounds and the iteration cap

1. `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --night-id <id>`
2. `<name>` is `datenorm-smoke`. Check C1 to C14. The night ends on `max_rounds` after exactly 2 rounds: round 1 is kept, a noise run follows, the review hands its hypothesis to round 2; no metering.

## Night 3: the plateau cap

1. `npm run run-night -- --config configs/e2e/plateau.yaml --mock --night-id <id>`
2. `<name>` is `e2e-plateau`. Check C1 to C14, and:
   - `run-night` prints `done` with `stop_reason` `plateau`
   - `done.json` has `rounds: 1`
   - there is a `test` row
   - no `cc-<id>` container is left

## Night 4: a hard stop mid-round

`<name>` is `datenorm-smoke`.

1. `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --no-wait --night-id <id>`
2. Once `exps/<id>-r1-e0/` exists, run `npm run run-night -- stop --night <id>`.
3. Check:
   - the stop command prints `stopped` and exits 0
   - within 30 s of it: `stop.json` has `reason: manual`; there is no `done.json` and no `test` row for `<id>`; no `cc-<id>` container is left
   - a `run-night` that was following the night prints `stopped` too

## Night 5: crash resume

`<name>` is `datenorm-smoke`.

1. `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --no-wait --night-id <id>`
2. Follow `docker events` for container creates, from before the kill until the night ends.
3. Once `exps/<id>-r2-e0/` exists (so round 1's row is in `results.jsonl`), record the sha256 and mtime of round 1's `code-state.json`, then kill the worker: the process `npm run worker` started, with its children. The dev server keeps running. If the night finishes before `exps/<id>-r2-e0/` appears, nothing is killed: run night 5 again under a new id.
4. Run `npm run worker` again, and nothing else: no stop, no manual resume. The step that was running is retried by itself about 2 minutes after the kill, when its lease expires.
5. Check, once the night finishes:
   - `done.json` exists
   - every `eval_id` is in `results.jsonl` once
   - round 1's `code-state.json` is unchanged (round 1's coder did not run again)
   - no `cc-<id>-r1-` sandbox is created after the kill (round 1's steps are memoized, not run again)
   - only the step running at the kill is retried: a coder step finds its sandbox by name and reopens its session, or restarts once from the parent commit when the sandbox is gone

## Night 6: a lost connection mid-turn

1. `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6 --night-id <id>`
2. `<name>` is `datenorm-smoke`. Check C1 to C14, and: `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one.

## Night 7: the multi-stage night

1. `npm run build:image:graphrag`
2. `npm run run-night -- --config configs/graphrag-smoke.yaml --mock --night-id <id>`
3. `<name>` is `graphrag-smoke`. A dev evaluation of it may fail: the canned chat answer `mock` gives the extraction stage no rows, so every dev evaluation stops at `extraction` with "the run exited clean but wrote no output", each round's `e0` gets a repair `e1`, both are recorded as `error` (`not scored`), nothing is kept, and the test evaluation scores the starter on all three stages. The night takes under a minute. The checks hold with or without the failure and the repair.
4. Check C1, C2, C3, C5, C6, C7, C10, C12 and C14, and:
   - `results.jsonl` has an `e0` experiment row for every round and exactly one `test` row. A round has an `e1` row only after an `e0` row with decision `error`; no round has an `e2`
   - every `e0` session holds eight send-backs, then one wrap-up; an `e1` session holds neither. `train-score.json` and `tasks.json` exist for both
   - `bundle/history/notes/r<round>-e<n>.md` exists per experiment, with a `mock note` coder part; the `mock verdict` reviewer part is on the note of the round's last experiment
   - every experiment has `exps/<exp>/check.json` with an empty `errors` list
   - every evaluation, dev and test, has `evals/<eval>/extraction/inputs.jsonl` with 8 lines (one per document of the split) and `extraction/run.log`
   - the test evaluation `evals/<id>-test-r<last round>/` holds `extraction/`, `graph/` and `retrieval/`, each with `inputs.jsonl`, `run.log`, `outputs/` and `report.json`
   - `metrics.json` exists for the test evaluation. A dev row that was not scored holds the primary metric at 0 and nothing else
   - the `test` row and `done.json`'s `test_metrics` hold metrics of all three stages, named `extraction.…`, `graph.…` and `retrieval.…`, with `<stage>.output_bytes` for each. Every other name is a standard metric (`cost_*`, `model_calls*`, `latency_*`)
   - every `evals/*/meter.jsonl` lists the program's calls, none with `error`; the `test` row has `model_calls` above 0 and `cost_usd` 0
   - `noise.json` and a `noise` row exist only if a round was kept
   - within a minute of `done`, `lessons/<id>-r<last round>/` holds `lessons.md`, `changes.md` and `proposal.json`; the proposal has an empty `ops` list and is not marked applied; `scenarios/graphrag/spec/agent/lessons.md` is unchanged
