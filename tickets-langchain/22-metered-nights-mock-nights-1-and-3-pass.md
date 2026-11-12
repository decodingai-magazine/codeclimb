# 22: Metered nights: mock nights 1 and 3 pass

**What to build:** A night whose config has `allowed_models` is metered. Its coder gets a dev ledger and the endpoint variables in its shell; its evaluations open a meter token, hand the variables to each stage's run, check the path after each run, and close the token into `meter.jsonl` and the cost metrics. With this ticket the capitals mock night and the plateau night pass.

**Spec sections:**
- "Evaluator": step 3, the path check after a stage's run, step 5
- "Metering proxy": the bullets on two ledgers per experiment and on the program side; the unmetered and metered networks; when "the path is up" is checked (before a coder starts, before an evaluator opens, after each stage's run)
- "Coder": the meter variables are the only environment forwarded to the shell
- "Coder" > "End of an experiment": the `budget` stop counts `coder_usd + dev_usd`; `devUsd` in `code-state.json`
- "Evaluator" > "Standard metrics": cost metrics
- "Experiment lifecycle" > "Stops": spend; the `plateau` stop
- "Decision and calibration" > "Noise margin": the fresh share in the margin
- "Goal and done signal": nights 1 and 3

**Not yet:** real upstreams (ticket 42); a credit stop on a program call (ticket 29); the smoke test's path check (ticket 24); the A/A run and its ledger with the replay cache off (ticket 23).

**Blocked by:** 17 (Reviewer); 18 (Send-backs, reserve and wrap-up); 21 (Relay and path to the proxy)

**Status:** ready-for-agent

- [ ] A metered night's sandboxes join `cc-meter`; an unmetered night's use the default bridge and get no token
- [ ] The coder's dev ledger is `<exp>-dev`: a new token per Pi attempt with spend carried over, capped at what is left of `budget_usd.experiment`, written to `exps/<exp>/meter-dev.jsonl` only when it has rows, never part of the cost metrics
- [ ] The evaluation's token is capped at the night's budget left when it starts; it is revoked at close even after a failure; `meter.jsonl` is written only when the ledger has rows
- [ ] The run gets `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `CODECLIMB_LLM_BASE_URL` and `CODECLIMB_LLM_API_KEY`
- [ ] A broken path after a stage's run throws instead of scoring
- [ ] The row's `program_usd` and `dev_usd`, the cost metrics and the night's spend follow the spec; the margin's fresh share uses `model_calls` and `model_calls_replayed`
- [ ] `npm run run-night -- --config configs/capitals-smoke.yaml --mock` passes every row of the done signal's table: among them `evals/*/meter.jsonl` lists the program's calls with no `error`, capitals scores 0 and keeps nothing, `spend_usd` is 0
- [ ] `npm run run-night -- --config configs/e2e/plateau.yaml --mock` prints `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; there is a `test` row; no `cc-<id>` container is left
- [ ] `datenorm-smoke --mock` still prints `done`, gets no token and stays on the default bridge
- [ ] `npm run typecheck` and `npm test` pass
