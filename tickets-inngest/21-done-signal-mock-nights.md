# 21: Done signal: both mock nights pass the end-to-end checks

**What to build:** The spec's done signal becomes one command or script an agent can run: with the dev server and the worker up, it runs `capitals-smoke --mock` and then `datenorm-smoke --mock`, and checks every row of the table in "Goal and done signal" for both nights. Whatever earlier tickets left short of the table is fixed here. Every later ticket that touches the loop reruns this check.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "Mock mode", "Files a night writes", "Cleanup"

**Blocked by:** 12 (Hard stop and cleanup: every dead night ends in stop.json); 14 (Notes, trajectory and rejected diffs: memory within a night); 15 (Send-backs, reserve and wrap-up); 18 (Metered nights on Docker: relay, meter variables, both ledgers, cost metrics); 19 (Noise run: the A/A evaluation and the measured margin); 20 (Model checks, every soft stop and the round-start smoke test)

**Status:** ready-for-agent

- [ ] A documented, repeatable check (following the given end-to-end test instructions when the environment holds them) runs both nights one after the other on the dev server with Docker sandboxes and asserts each row of the table; it fails with the row's name when one does not hold
- [ ] Both nights print `done` with `stop_reason` `max_rounds` or `thresholds`, and `run-night` exits 0
- [ ] `results.jsonl` passes `validate-results` and has a row per experiment of every round plus a `test` row; every experiment row has `decision_reason`
- [ ] Every session under `exps/*/session/` holds eight send-backs (`You stopped with N of N minutes`) then one wrap-up (`change no more code`); `exps/*/code-state.json` has `stop: done`; `train-score.json` and `tasks.json` exist
- [ ] `reviews/r<n>.json` exists for every round with `feedback: mock feedback`; `bundle/history/notes/r<round>-e<n>.md` exists per experiment with the `mock note` and, where reviewed, `mock verdict` parts
- [ ] `datenorm-smoke`: round 1 kept at dev accuracy 0.125, a `noise` row in round 2, `noise.json` present. `capitals-smoke`: scores 0, keeps nothing, `evals/*/meter.jsonl` lists calls with no `error`
- [ ] `done.json` has `spend_usd: 0`; `stop.json` and `pause.json` are absent; `docker ps` shows no `cc-<id>` container
- [ ] The check can run twice in a row (fresh night ids, shared `experiments.git` and `results.jsonl`) and pass both times
- [ ] `npm run typecheck` and `npm test` pass
