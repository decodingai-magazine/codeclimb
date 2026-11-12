# 24: Model checks, every soft stop, smoke test and outage

**What to build:** A real-model night refuses to start, on the CLI and again in the Agent Server, when a model it names is missing, has no credentials or is not available to the account. Every round begins with the same check plus, for a metered night, the path to the proxy; a failure is retried, and after 7 failures the night stops with `outage`. Mock nights skip all of it. With `outage` in, every soft stop of the spec is proven on the loop: each one still ends with the test evaluation and `done.json`.

**Spec sections:**
- "Night config" > "Validation at parse": the last bullet (the model check, the OpenRouter endpoints check, the embedding models)
- "Experiment lifecycle" > "Round loop": step 2
- "Experiment lifecycle" > "Stops": the soft-stop table on the loop, and its `outage` row
- "Metering proxy": the model-check line of the OpenRouter facts; "the path is up" in the round-start smoke test
- "Durable runtime on LangGraph": the non-retriable error of the night's first step
- "CLI" > "Mock mode": what is skipped
- "Every number in one place": loop row "smoke test"; proxy row "model check timeout"

**Not yet:** any paid call. Nothing here spends money: the check lists models, it does not prompt them.

**Blocked by:** 22 (Metered nights: mock nights 1 and 3 pass); 23 (Noise run; mock night 2 passes in full)

**Status:** ready-for-agent

- [ ] A Pi model passes when it is in Pi's model runtime, its provider has credentials, and the provider lists it as available to the account
- [ ] An `openrouter/` entry of `allowed_models` passes when OpenRouter's per-model endpoints API lists at least one endpoint; the priced embedding models are left out of the Pi check
- [ ] The check times out after 30 s per call
- [ ] On the CLI a failed check is a validation error (exit 2); in the night's first step it is CodeClimb's non-retriable error and the night ends with `stop.json`, reason `failed`
- [ ] The smoke test runs after the soft-stop check of every round; a failure is retried every 5 minutes, 6 more times; then the night soft-stops with `outage` and still scores test
- [ ] The waits between tries are steps, so a replay takes the same path
- [ ] `--mock` skips the model checks and the smoke test
- [ ] Every soft stop (`max_rounds`, `deadline`, `budget`, `tokens`, `plateau`, `thresholds`, `outage`) leads to the test evaluation, the test row, the sweep and `done.json` with that `stop_reason`
- [ ] On mock models, with temporary config copies (inside the checkout but outside `configs/`, each with its own name and a `results_path` folder of its own, which lands directly under `runs-langchain/`); the given configs stay unchanged: a deadline of a few seconds ends with `stop_reason: deadline`; a `datenorm-smoke` copy with a threshold at or below 0.125 ends with `thresholds` after round 1
- [ ] Unit tests cover `budget` and `tokens` through the night's stop check with fabricated counters
- [ ] Unit tests with stubbed provider and OpenRouter replies cover pass, missing model, missing credentials, no endpoint, and the 7-try outage with a faked clock; the three mock nights of tickets 22 and 23 still pass
- [ ] `npm run typecheck` and `npm test` pass
