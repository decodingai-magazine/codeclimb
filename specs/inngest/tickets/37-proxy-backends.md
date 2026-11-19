# 37: Proxy backends: OpenRouter and Pi's model layer

**What to build:** On a real-model night the metering proxy forwards a program's calls to OpenRouter, or to any other provider through Pi's model layer, charges what each call cost, answers an upstream failure as a failure, and turns a credit signal into the credit pause of ticket 24. Everything is tested against fakes; no paid call.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Metering proxy; Pause for credits), "Metering proxy", "Runtime and tools", "Environment"

**Blocked by:** 17 (Metered nights on Docker: mock night 1's metering passes); 24 (Pause for credits and resume)

**Status:** ready-for-agent

- [ ] `openrouter/<id>` models go to OpenRouter with `OPENROUTER_API_KEY`, at `OPENROUTER_BASE_URL` when set; each call is charged what it cost (tests against a fake OpenRouter at that address)
- [ ] Other models go through Pi's model layer with the worker's credentials; each call is charged what it cost (tests against a fake model layer)
- [ ] An upstream failure answers 502 `api_error` to the program and is a failed ledger line with `error`
- [ ] A credit or quota signal from upstream answers 402 `insufficient_quota` and pauses the night as ticket 24 does
- [ ] A mock night uses the mock answers and never these backends
- [ ] No test makes a paid call
