# 29: Model checks, smoke test and outage

**What to build:** A real-model night refuses to start, on the CLI and again in the Agent Server, when a model it names is missing, has no credentials or is not available to the account. Every round begins with the same check plus, for a metered night, the path to the proxy; a failure is retried, and after 7 failures the night stops with `outage`. Mock nights skip all of it.

**Spec sections:**
- "Night config" > "Validation at parse": the last bullet (the model check, the OpenRouter endpoints check, the embedding models)
- "Experiment lifecycle" > "Round loop": step 2
- "Experiment lifecycle" > "Stops": the `outage` row
- "Metering proxy": the model-check line of the OpenRouter facts; "the path is up" in the round-start smoke test
- "Durable runtime on LangGraph": the non-retriable error of the night's first step
- "CLI" > "Mock mode": what is skipped
- "Every number in one place": loop row "smoke test"; proxy row "model check timeout"

**Not yet:** any paid call. Nothing here spends money: the check lists models, it does not prompt them.

**Blocked by:** 23

**Status:** ready-for-agent

- [ ] A Pi model passes when it is in Pi's model runtime, its provider has credentials, and the provider lists it as available to the account
- [ ] An `openrouter/` entry of `allowed_models` passes when OpenRouter's per-model endpoints API lists at least one endpoint; the priced embedding models are left out of the Pi check
- [ ] The check times out after 30 s per call
- [ ] On the CLI a failed check is a validation error (exit 2); in the night's first step it is CodeClimb's non-retriable error and the night ends with `stop.json`, reason `failed`
- [ ] The smoke test runs after the soft-stop check of every round; a failure is retried every 5 minutes, 6 more times; then the night soft-stops with `outage` and still scores test
- [ ] The waits between tries are steps, so a replay takes the same path
- [ ] `--mock` skips the model checks and the smoke test
- [ ] Unit tests with stubbed provider and OpenRouter replies cover pass, missing model, missing credentials, no endpoint, and the 7-try outage with a faked clock; the three mock nights of tickets 20 and 23 still pass
- [ ] `npm run typecheck` and `npm test` pass
