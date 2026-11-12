# 25: Check table: mock nights 1 to 3 as one repeatable check

**What to build:** The first three nights of the done signal become one command or script an agent can run: on a running `npm run server`, with `LANGSMITH_TRACING=false`, it runs `capitals-smoke --mock`, `datenorm-smoke --mock` and `configs/e2e/plateau.yaml --mock` one after the other and checks every row the spec lists for each. Whatever earlier tickets left short of the table is fixed here. Every later ticket that touches the loop reruns this check; ticket 46 extends it to the seven nights.

**Spec sections:**
- "Goal and done signal": nights 1, 2 and 3; the check table for nights 1, 2 and 3; night 3's row of the second table
- "CLI" > "Mock mode": where a mock night's results go
- "Data and files" > "Files a night writes"
- "Durable runtime on LangGraph" > "Cleanup": a finished night's sweep
- "Known gaps": one night per server

**Not yet:** nights 4 to 7 (tickets 26, 27, 28, 35); the full suite on a fresh server (ticket 46).

**Blocked by:** 19 (Check, leak scan and guardrails); 22 (Metered nights: mock nights 1 and 3 pass); 23 (Noise run; mock night 2 passes in full); 24 (Model checks, every soft stop, smoke test and outage)

**Status:** ready-for-agent

- [ ] A documented, repeatable check (following the given end-to-end test instructions when the environment holds them) runs the three nights one after the other and asserts each row of the table; it fails with the row's name when one does not hold
- [ ] Nights 1 and 2 print `done` with `stop_reason` `max_rounds` or `thresholds`, and `run-night` exits 0; night 2 ends on `max_rounds` after exactly 2 rounds
- [ ] `results.jsonl` passes `validate-results` and has a row per experiment of every round plus a `test` row; every experiment row has `decision_reason`
- [ ] Every session under `exps/*/session/` holds eight send-backs ("You stopped with N of N minutes") then one wrap-up ("change no more code"); `exps/*/code-state.json` has `stop: done`; `train-score.json` and `tasks.json` exist
- [ ] `reviews/r<n>.json` exists for every round with `feedback: mock feedback`; `bundle/history/notes/r<round>-e<n>.md` exists per experiment with the `mock note` and, where reviewed, `mock verdict` parts
- [ ] `datenorm-smoke`: round 1 kept at dev accuracy 0.125, a `noise` row in round 2, `noise.json` present. `capitals-smoke`: scores 0, keeps nothing, `evals/*/meter.jsonl` lists calls with no `error`
- [ ] `done.json` has `spend_usd: 0`; `stop.json` and `pause.json` are absent; `docker ps` shows no `cc-<id>` container
- [ ] Night 3 prints `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; there is a `test` row; no `cc-<id>` container is left
- [ ] The check can run twice in a row (fresh night ids, shared `experiments.git` and `results.jsonl`) and pass both times
- [ ] `npm run typecheck` and `npm test` pass
