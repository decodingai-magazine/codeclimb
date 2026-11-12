# 20: Metering proxy: ledgers, routes, refusals, replay

**What to build:** An HTTP server that is the only way a program reaches a model. A caller opens a ledger and gets a bearer token; a program holding the token calls `/v1/chat/completions`, `/v1/embeddings`, `/v1/decisions`, `/v1/rerank` and `/v1/_op`; every call becomes one ledger row; refusals follow the spec's order; repeated calls replay. In mock mode every call gets its canned answer at zero cost. The upstream is an interface: this ticket ships the mock one and tests with a stub.

**Spec sections:**
- "Metering proxy": the route table, the ledger bullet, the refusal order and error objects, the ledger row fields, "Replay cache", and the listener bullet of "Path to the proxy"
- "CLI" > "Mock mode": the canned program answers
- "Every number in one place": proxy rows "request body" and "coder retry window"; the rounding row (cost)

**Not yet:** the OpenRouter and Pi upstreams (ticket 42); the relay and the networks (ticket 21); opening tokens from the coder and the evaluator (ticket 22); credit stops beyond the callback's signature (ticket 29).

**Blocked by:** 04 (Stage reports and standard metrics)

**Status:** ready-for-agent

- [ ] The proxy starts on first use, on `CODECLIMB_PROXY_HOST` and `CODECLIMB_PROXY_PORT`, or, when neither is set, on a free port on loopback, or on the Docker bridge's gateway address on Linux (the address selection is unit-tested); importing its module starts nothing
- [ ] Opening a ledger takes an evaluation id, the allowed models, a `$` cap and a credit-stop callback and returns a random bearer token; its spend can be read; closing returns its calls, revokes the token and aborts calls in flight
- [ ] Refusals come in the spec's order with the spec's statuses and `error.type` values: 401, 413 over 16 MiB, 403, 402 after a credit stop, 402 cap spent, 400; an upstream failure is 502 and is still charged; a cap is checked before a call, so the crossing call runs
- [ ] Chat accepts text messages only, no tools and no streaming, and answers in OpenAI's shape; embeddings accept a string or a list; decisions and rerank take and return the bodies the spec lists
- [ ] `/v1/_op` sets the operation of later calls (default `program`), validates the name, and writes no ledger row
- [ ] Each call is one row with the always-present fields; `error` is never present on a successful call; refused calls carry `rejected`
- [ ] Replay: a call an earlier evaluation of the night made is answered from the cache after the time the call took, at no spend, with `replayed_usd`; the same call again within one evaluation goes upstream; a reply cut off by `max_tokens` is not cached
- [ ] A coder-kind ledger also replays its own calls, unless the call repeats within 5 seconds of its last answer
- [ ] A ledger can be opened with the cache off for both reading and writing (the A/A run); a new night's first token clears the cache
- [ ] Mock upstream: chat `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0, all at cost 0
- [ ] Unit tests cover the above over real HTTP against the proxy with a stub upstream; `npm run typecheck` and `npm test` pass
