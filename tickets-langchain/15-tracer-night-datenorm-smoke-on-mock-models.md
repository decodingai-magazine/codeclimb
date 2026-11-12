# 15: Tracer night: `datenorm-smoke` on mock models

**What to build:** `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` starts a night on the Agent Server, follows it, and prints `done`. The night runs init, then each round: stop check, code, evaluate on dev, decide, record, keep, thresholds. After the soft stop it scores the checkpoint on test and writes `done.json`. This is the thin path through every layer; later tickets thicken it.

**Spec sections:**
- "Experiment lifecycle": "Ids", "Init", "Round loop" (steps 1, 4, 6, 7, 10, 12, 13 and the part of 11 that updates spend, tokens and the count of rounds without a keep; the paragraph after the list), "Stops"
- "Durable runtime on LangGraph": the `night` row of the Graphs table and the paragraph under it (step names), "Rules the loop depends on", the state the night carries
- "Durable runtime on LangGraph" > "Cleanup": the bullets on the night's catch, on a finished night's sweep, on a night that fails before `night.json` exists, and on `run-night`'s exit code
- "CLI": the `run-night` start command, `--night-id`, `--rounds`, `--no-wait`, `--mock`, following, exit 2
- "CLI" > "Mock mode": what `--mock` skips
- "Data and files": "Files a night writes" (`night.json`, `done.json`, `results.jsonl`), "Result row" (experiment and test rows)
- "Goal and done signal": the check table

**Not yet:** the smoke test (29), the noise run (20), check and scan (19), repair (27), review, notes and history (16, 17), send-backs (18), metering (23), pauses (28), lessons (33), `continue`, `stop` and `resume` commands (35, 24, 28). Until ticket 24 the night's catch writes `stop.json` (`failed` or `cancelled`) and sweeps its own sandboxes itself, so `run-night` never hangs; ticket 24 replaces that with the stop operation. Round 2's hypothesis stays empty until ticket 17.

**Blocked by:** 05, 06, 12, 13, 14

**Status:** ready-for-agent

- [ ] Experiments and evaluations are plain functions inside the `night` entrypoint; their steps are named `<experiment or evaluation id>/<step>`; every clock read, random choice and I/O sits inside a step; steps return small JSON
- [ ] Init builds the bundle, imports the starter as `<night>-r0-starter`, computes the deadline and writes `night.json` with the keys the spec lists that apply so far
- [ ] The coder runs on a fresh sandbox from the checkpoint; the evaluator's sandbox is created after the coder's is destroyed; an evaluation is skipped with no commit or unchanged files
- [ ] A failure of an experiment or an evaluation becomes an `error` outcome and the night goes on; a graph interrupt and an abort of the server run are rethrown
- [ ] `run-night` validates the config (exit 2 on a usage or validation error), starts the night, prints new rows every 5 s, prints `done` with `done.json` or `stopped` with `stop.json`, and exits 0; Ctrl-C detaches; `--no-wait` exits after the start
- [ ] On `datenorm-smoke --mock` these rows of the done signal's table hold: `run-night` prints `done` with `stop_reason` `max_rounds` after exactly 2 rounds; `done.json` exists and `stop.json` and `pause.json` don't; `validate-results` passes; `results.jsonl` has a row per experiment of every round plus a `test` row; `refs/exp/<id>-r1-e0` shows the mock commit and its diff adds `MOCK.md`; `exps/*/code-state.json` has `stop: done` and `exps/*/session/` holds a session file; every experiment row has `decision_reason`; round 1 is kept at dev accuracy 0.125; `done.json` has `spend_usd: 0`; `docker ps` shows no `cc-<id>` container
- [ ] A night whose init fails (a config naming a bundle command that fails, in a test) ends with `nights/<id>/stop.json` holding `reason: failed`, and `run-night` prints `stopped`
- [ ] `npm run typecheck` and `npm test` pass
