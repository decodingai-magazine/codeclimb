# 40: Proxy backends: OpenRouter and Pi

**What to build:** On a real-model night the proxy forwards a program's calls upstream: `openrouter/<id>` models to OpenRouter, the only backend for decisions and rerank; other chat models through Pi's providers. It charges what each call cost, answers an upstream failure with 502, and turns a credit error into a credit stop that pauses the night.

**Spec sections:**
- "Interfaces the build must honour" > "Metering proxy": the backends bullet; refusals
- "Runtime and tools": the OpenRouter bullet
- "Features": **Metering**; **Pause for credits** ("A credit error from a program call")
- "Interfaces the build must honour" > "Environment": the provider keys

**Not yet:** nothing is called for real in tests. A paid night needs the operator's go-ahead and is not part of this ticket.

**Blocked by:** 17 (Metering proxy); 21 (Gate: nights 1 to 3 as one repeatable check); 26 (Pause for credits, resume and the pause timeout)

**Status:** ready-for-agent

- [ ] `openrouter/<id>` chat and embeddings go to OpenRouter with `OPENROUTER_API_KEY`, held by the Agent Server; decisions and rerank go only to OpenRouter
- [ ] Other chat models go through Pi's providers with their credentials
- [ ] Each ledger row's `cost_usd` is what the upstream call cost; token counts come from the upstream's usage
- [ ] An upstream failure answers 502 and writes a ledger row with `ok: false` and `error`
- [ ] A credit error from an upstream becomes a credit stop: the call is refused with 402, later calls of that token are refused, and the night pauses as in ticket 26
- [ ] A mock night still gets the mock upstream; no key is read on a mock night
- [ ] Unit tests with a stubbed OpenRouter HTTP server and a stubbed Pi provider cover each backend, the cost, the failure and the credit stop
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
