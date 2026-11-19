# 20: Model checks, smoke test, outage and every soft stop

**What to build:** A real-model night refuses to start when a model it names is not available: `run-night` checks before it starts the night. Before money goes into a round, the smoke test checks the models again and, on a metered night, the path to the proxy; a failure is retried, and a lasting one ends the night with `outage`. Mock nights skip both. With `outage` in, every soft stop is proven on the loop: each ends with the test evaluation and `done.json`.

**Spec sections:**
- "Features": **Smoke test**; **Stops** (the order of the soft stops; the reserve)
- "Interfaces the build must honour" > "Stops": the `done.json` table
- "Interfaces the build must honour" > "Mock mode": "skipped: the model checks, the smoke test"
- "Architecture": the CLI row ("checks models")
- "Numbers": smoke test

**Not yet:** any paid call: the checks are tested against stubbed providers and a stubbed proxy path.

**Blocked by:** 19 (Noise run: night 2 passes)

**Status:** ready-for-agent

- [ ] A model check passes when the model exists for its provider, the provider has credentials and the model is available to the account; it never prompts a model
- [ ] On the CLI a failed check is a validation error (exit 2) that names the model, and no night is started
- [ ] The smoke test runs at the start of every round, after the soft-stop check; a failure is retried, 7 tries 5 minutes apart; then the night stops soft with `outage`, still scores test and writes `done.json`
- [ ] `--mock` skips the model checks and the smoke test
- [ ] Every soft stop (`max_rounds`, `deadline`, `budget`, `tokens`, `plateau`, `outage`, `thresholds`) ends with the test evaluation, the `test` row, the sweep and `done.json` with that `stop_reason`
- [ ] On mock models with temporary config copies (outside `configs/`, each with a `results_path` folder of its own): a deadline of a few seconds ends with `deadline`; a `datenorm-smoke` copy with an accuracy threshold at or below 0.125 ends with `thresholds` after round 1
- [ ] Unit tests with stubbed providers and a fake clock cover: pass, missing model, missing credentials, a model not available to the account, the 7-try outage; and `budget` and `tokens` through the night's stop check with fabricated counters
- [ ] Nights 1, 2 and 3 still pass
- [ ] `npm run typecheck` and `npm test` pass
