# 42: Proxy backends: OpenRouter and Pi

**What to build:** On a real-model night the proxy forwards a program's calls upstream: `openrouter/<id>` models straight to OpenRouter with the Agent Server's key, other chat models through Pi's model runtime, embeddings to OpenRouter or to the two priced OpenAI models. It charges what each call cost, treats the failure cases as the spec says, and turns a credit signal into a credit stop.

**Spec sections:**
- "Metering proxy": the route table's forwarded parameters, the bullets "backends", "OpenRouter facts" and "Pi backend facts"
- "Coder" > "Pi facts found while building": the "One-shot calls (the proxy)" row
- "Experiment lifecycle" > "Pause for credits": detection on a program call
- "Deployment and environment": the provider-key row of the variable table
- "Every number in one place": proxy rows "OpenRouter call timeout" and "embeddings prices"

**Not yet:** nothing is called for real in tests. A paid night needs the operator's go-ahead and is not part of this ticket.

**Blocked by:** 10 (Pi sessions: mock models and sandbox tools); 20 (Metering proxy: ledgers, routes, refusals, replay); 25 (Check table: mock nights 1 to 3 as one repeatable check); 29 (Pause for credits and resume)

**Status:** ready-for-agent

- [ ] OpenRouter chat: the `openrouter/` prefix is stripped; `max_tokens`, `temperature`, `response_format`, `seed`, `top_p`, `stop` and `reasoning` are forwarded; the request asks for usage accounting; the charge is the reported `usage.cost`; a reply with no cost counts as failed
- [ ] A 200 reply with an `error` body is a failure; HTTP 402 is a credit stop; null content from a reasoning model is empty text with finish reason `length`; a call times out after 5 minutes
- [ ] Embeddings, rerank and decisions go to their OpenRouter paths; decisions and rerank exist only there
- [ ] Pi chat: system messages are joined into the system prompt; earlier assistant turns are rebuilt; only `max_tokens` is forwarded; input tokens = input + cache read + cache write; the price is Pi's catalog price; a reply with stop reason `error` or `aborted` is a failure that still costs
- [ ] Outside OpenRouter, embeddings work only for `openai/text-embedding-3-small` and `-large`, at $0.02 and $0.13 per million tokens, with the key Pi resolves for the provider or `OPENAI_API_KEY`
- [ ] An upstream failure answers 502 to the program and its cost is charged; a credit signal also fires the ledger's credit-stop callback, after which the ledger refuses with 402
- [ ] The proxy picks the mock upstream on a mock night and these upstreams otherwise
- [ ] Unit tests with a stubbed OpenRouter HTTP server and a stubbed Pi completion cover the above; `npm run typecheck` and `npm test` pass
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal": a mock night still gets the mock upstream
