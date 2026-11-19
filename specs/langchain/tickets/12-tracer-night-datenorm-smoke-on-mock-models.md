# 12: Tracer night: `datenorm-smoke` on mock models

**What to build:** `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` starts a night on the Agent Server, follows it and prints `done`. The night runs as a graph of durable steps: init, then rounds of stop check → one experiment → dev evaluation → keep or revert → the row → a kept experiment becomes the checkpoint → threshold check, until a soft stop; then the checkpoint is scored on test and `done.json` is written. This is the thin path through every layer; later tickets thicken it.

**Spec sections:**
- "Goal and done signal": night 2, C1 to C6, C10 to C12, C14
- "Architecture": the CLI and Agent Server rows; the data flow of a night and of a round; the terms (checkpoint, variation, step, attempt)
- "Features": **The loop**, **Keep rule**, **Stops** (soft stops; "A night always ends with `done.json` or `stop.json`, also when it fails before `night.json` exists")
- "Interfaces the build must honour" > "CLI": the `run-night` start command, `--night-id`, `--sandbox`, `--rounds`, `--no-wait`, `--mock`, following, Ctrl-C, exit 2
- "Interfaces the build must honour" > "Files a night writes": `night.json`, `done.json`, `stop.json`, `results.jsonl`
- "Interfaces the build must honour" > "Result row": experiment and test rows; "with nothing kept, test runs on the round-0 commit"
- "Interfaces the build must honour" > "Ids": the test evaluation id
- "Interfaces the build must honour" > "Environment": `CODECLIMB_SERVER_URL`
- "Runtime and tools": the LangGraph JS bullet; "a step that fails is retried, and one that keeps failing becomes the outcome of its experiment or evaluation"; "one night id is one night"
- "Numbers": each mock night within 300 s; `--no-wait` returns within 120 s

**Not yet:** the review, notes and history (tickets 13, 14); send-backs (ticket 15); check and scan (ticket 16); metering (ticket 18); the noise run (ticket 19); the model checks and smoke test (ticket 20); the stop command (ticket 22); crash resume (ticket 24); pauses (ticket 26); repair (ticket 27); lessons (ticket 30). Until ticket 22, a failed night writes its own `stop.json` with a failure reason and sweeps its sandboxes, so `run-night` never hangs. Round 2's hypothesis stays empty until ticket 14.

**Blocked by:** 05 (Decisions: weighted score, keep rule, noise margin and stop checks); 06 (Result rows and `validate-results`); 10 (Coder experiment); 11 (Evaluator, unmetered)

**Status:** ready-for-agent

- [ ] Init builds the bundle, imports the starter as `<night>-r0-starter` and writes `night.json` with the night's identity, start, deadline, round-0 commit, resolved config and scoring hashes; the starter is never evaluated on dev and the round-0 checkpoint has a weighted score of 0
- [ ] Each round runs the soft-stop check, one experiment `<night>-r<N>-e0` from the checkpoint, its dev evaluation `<exp>-eval` on a sandbox created after the coder's is removed, the decision, the row, and the threshold check; a kept experiment becomes the checkpoint with its dev metrics; a reverted one is dropped
- [ ] An experiment with no commit or unchanged files is not evaluated; its row still has `eval_id` `<exp>-eval`
- [ ] A failure inside an experiment or an evaluation is retried, and one that keeps failing becomes that experiment's or evaluation's `error` outcome; the night goes on
- [ ] A finished step's result is saved once and never run again in the same night (test on the graph's step results)
- [ ] After a soft stop the checkpoint, or the round-0 commit when nothing was kept, is evaluated on test as `<night>-test-r<N>` on `cc-<night>-test-r<N>`; the `test` row carries the checkpoint's `exp_id` and `commit`, `parent_id` null, and `decision` `keep` when the evaluation succeeded, else `error`
- [ ] `done.json` holds `night_id`, `stop_reason`, `rounds` (the last recorded round), `kept` (`exp_id`, `commit`, `dev_score`), `test_metrics`, `spend_usd` and `finished_at`; then the night's sandboxes are swept
- [ ] Rows carry `night_id`, `kind`, `eval_id`, `stack: langchain`, `backend: docker`, `model`, `reviewer_model`, `hypothesis`, `commit`, `coder_usd`, `program_usd`, `tokens`, `wall_s`, `t_provision`, `t_code`, `t_eval`, `t_teardown`, `infra_errors` and `evaluator_instance`
- [ ] `run-night` starts the night on the Agent Server at `CODECLIMB_SERVER_URL` (default `http://127.0.0.1:8123`), prints new rows every 5 s, prints `done` when `done.json` appears or `stopped` when `stop.json` does, each as the first word of a line of its own, then exits 0; `--no-wait` exits 0 after the start; Ctrl-C detaches and leaves the night running; `--sandbox docker` is accepted; `--rounds` sets `max_rounds`
- [ ] A night id used before is refused (exit 2); an id that is running is followed, not started twice
- [ ] A night whose init fails (a test config whose bundle command fails) ends with `stop.json` although no `night.json` exists, and `run-night` prints `stopped`
- [ ] On `datenorm-smoke --mock`: `run-night` prints `done` with `stop_reason` `max_rounds` after exactly 2 rounds, within 300 s; C2, C3, C4, C5, C6, C10, C12 and C14 hold; round 1 is kept at dev accuracy 0.125
- [ ] `npm run typecheck` and `npm test` pass
