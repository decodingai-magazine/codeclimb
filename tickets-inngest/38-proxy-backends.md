# 38: Proxy backends: OpenRouter and Pi

**What to build:** On a real-model night the proxy forwards a program's calls upstream: `openrouter/<id>` models straight to OpenRouter with the worker's key, other chat models through Pi's model runtime, embeddings to OpenRouter or to the two priced OpenAI models. It charges what each call cost, treats the failure cases as the spec says, and turns a credit signal into a credit stop. Both backends sit behind the upstream interface of ticket 15; a mock night keeps the mock upstream.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Metering proxy", "Pi facts found while building", "Pause for credits", "Deployment and environment", "Every number in one place"

**Blocked by:** 15 (Metering proxy: ledgers, routes, refusals and mock answers); 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] OpenRouter backend, tested against a fake upstream through `OPENROUTER_BASE_URL`: prefix stripped, usage accounting requested, `usage.cost` charged, a reply without cost failed, a 200 with an `error` body failed, HTTP 402 and credit messages reported as a credit stop (`who: program`, `model`, `message`), null content from a cut-off reasoning model read as empty text with finish reason `length`, decisions on the alpha path, rerank, a 5-minute call timeout
- [ ] Pi backend, tested against a fake model runtime: system messages joined, assistant turns rebuilt, input tokens = input + cache read + cache write, stop reason `error` or `aborted` a failure that still costs; embeddings outside OpenRouter only for the two OpenAI models at their fixed prices, through the provider's OpenAI-compatible endpoint with the key Pi resolves
- [ ] An upstream failure answers 502 to the program and its cost is still charged; a credit signal fires the ledger's credit-stop callback, after which the ledger refuses with 402
- [ ] The proxy picks the mock upstream on a mock night and these backends otherwise
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
