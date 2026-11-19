# 17: Metering proxy

**What to build:** The only path from a program to a model. The proxy runs inside the Agent Server, holds the keys, and serves OpenAI-shaped routes under `/v1`. A caller presents a token that carries its ledger, the allowed models and a dollar cap; every call is a ledger row; within a night a repeated call is replayed from a cache for free. On a mock night the upstream is the scripted program answers.

**Spec sections:**
- "Interfaces the build must honour" > "Metering proxy": the route table, refusals, the ledger row, "The file is written only when the ledger has rows"
- "Features": **Metering**
- "Interfaces the build must honour" > "Mock mode": the program calls row
- "Architecture": the metering proxy row
- "Numbers": proxy request body

**Not yet:** pointing sandboxes at the proxy and the path check (ticket 18); the OpenRouter and Pi upstreams (ticket 40); credit stops (ticket 26).

**Blocked by:** 04 (Stage reports and standard metrics)

**Status:** ready-for-agent

- [ ] Routes: `POST /v1/chat/completions` (OpenAI's shape, text messages only, no tools, no streaming), `/v1/embeddings` (`input` a string or a list), `/v1/decisions` (`model`, `state`, `questions`, optional `assets` → `answers`), `/v1/rerank` (`model`, `query`, `documents`, optional `top_n` → `results` with `index` and `relevance_score`)
- [ ] `POST /v1/_op` with `op` matching `^[a-z][a-z0-9_]*$` names the operation later calls of that token belong to (default `program`), answers 200 and writes no ledger row
- [ ] Refused with an OpenAI-shaped `error`: a bad token, a body over 16 MiB, a model not allowed, a spent cap, an unsupported request (tools, streaming, a non-text message); an upstream failure answers 502
- [ ] Every call writes one ledger row: `kind`, `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd`, `ms`, and when they apply `error` (never on a successful call), `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected`; the ledger file is written only when it has rows
- [ ] A repeated identical call within a night is replayed from the cache at cost 0, with `replayed_usd` holding what it would have cost; a caller can ask for no replay (the A/A run)
- [ ] Mock upstream: chat answers `mock`; embeddings `[1, 0, 0, 0]` per input; decisions `{}`; rerank every score 0; all at cost 0
- [ ] The cost metrics of ticket 04 compute from a ledger the proxy wrote
- [ ] Unit tests drive the proxy over HTTP: every route, every refusal, the replay, `_op`, and the ledger file rule
- [ ] `npm run typecheck` and `npm test` pass
