# 20: Check table: mock nights 1 to 3 as one repeatable check

**What to build:** The first three nights of the done signal become one command or script an agent can run: with the dev server and the worker up, it runs `capitals-smoke --mock`, `datenorm-smoke --mock` and `configs/e2e/plateau.yaml --mock` one after the other and checks every row "Goal and done signal" lists for each: the first table for all three (the spec holds nights 1, 2, 3 and 6 to it), plus night 3's row of the second. Nights 4 to 7 pass in the tickets that build what they prove (tickets 21, 22, 23 and 29). Whatever earlier tickets left short of the table is fixed here. Every later ticket that touches the loop reruns this check; ticket 40 extends it to the seven nights.

**Spec sections** (`specs/inngest/spec.md`): "Goal and done signal", "Mock mode", "Files a night writes", "Cleanup"

**Blocked by:** 13 (Notes, trajectory and rejected diffs: memory within a night); 14 (Send-backs, reserve and wrap-up); 17 (Metered nights on Docker: relay, ledgers, cost metrics; mock nights 1 and 3 pass); 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes); 19 (Model checks, every soft stop and the round-start smoke test)

**Status:** ready-for-agent

- [ ] A documented, repeatable check (its preconditions and its checks are the ones "Goal and done signal" states; nothing outside the spec defines it) runs the three nights one after the other on the dev server with Docker sandboxes and asserts each row of the table; it fails with the row's name when one does not hold
- [ ] Nights 1 and 2 print `done` with `stop_reason` `max_rounds` or `thresholds`, night 3 with `plateau`, and `run-night` exits 0; night 2 ends on `max_rounds` after exactly 2 rounds
- [ ] `results.jsonl` passes `validate-results` and has a row per experiment of every round plus a `test` row; every experiment row has `decision_reason`
- [ ] `git -C runs-inngest/mock/<name>/experiments.git log refs/exp/<id>-r1-e0` shows the mock commit, and its diff adds `MOCK.md`
- [ ] Every session under `exps/*/session/` holds eight send-backs (`You stopped with N of N minutes`) then one wrap-up (`change no more code`); `exps/*/code-state.json` has `stop: done`; `train-score.json` and `tasks.json` exist
- [ ] `reviews/r<n>.json` exists for every round with `feedback: mock feedback`; `bundle/history/notes/r<round>-e<n>.md` exists per experiment with the `mock note` and, where reviewed, `mock verdict` parts
- [ ] `datenorm-smoke`: round 1 kept at dev accuracy 0.125, a `noise` row in round 2, `noise.json` present. `capitals-smoke`: scores 0, keeps nothing, `evals/*/meter.jsonl` lists calls with no `error`
- [ ] `done.json` has `spend_usd: 0`; `stop.json` and `pause.json` are absent; `docker ps` shows no `cc-<id>` container
- [ ] Night 3 holds every row above that is not named for another config, and its own row of the second table: `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; there is a `test` row; no `cc-<id>` container is left. It runs on capitals, so it keeps nothing
- [ ] The check can run twice in a row (fresh night ids, shared `experiments.git` and `results.jsonl`) and pass both times
- [ ] `npm run typecheck` and `npm test` pass
