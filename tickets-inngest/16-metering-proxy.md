# 16: Metering proxy: ledgers, routes, refusals and backends

**What to build:** A caller on the worker opens a ledger and gets a bearer token; a program holding that token can call chat, embeddings, decisions and rerank through `/v1`, and name its current operation through `/v1/_op`. Every call becomes a ledger row; refusals follow a fixed order and shape; closing the ledger returns its calls and revokes the token. In mock mode calls get canned answers at zero cost. The replay cache (ticket 17) and the route from a sandbox to the proxy (ticket 18) are separate.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Metering proxy", "Mock mode", "Pi facts found while building", "Pause for credits", "Deployment and environment"

**Blocked by:** 08 (Pi sessions with sandbox tools, mock models, the model check and credit detection)

**Status:** ready-for-agent

- [ ] The proxy has its own listener, one per worker, started on first use on `CODECLIMB_PROXY_HOST` (default `127.0.0.1`) and `CODECLIMB_PROXY_PORT` (default a random free port), built on `node:http`; the handler is exported so the worker API can also mount it under `/v1`
- [ ] Ledger lifecycle: open (evaluation id, allowed models, a dollar cap, a credit-stop callback) returns a random token; spend can be read; close returns the calls, revokes the token and aborts calls in flight (unit tests)
- [ ] The five routes accept and answer in the shapes of the route table; `/v1/_op` validates the op pattern, answers 200 and writes no row; the default op is `program`
- [ ] Refusals come in the spec's order with the stated status and `error.type`: 401, 413 (16 MiB), 403, 402 after a credit stop, 402 cap spent, 400; an upstream failure is 502 and its cost is still charged; the cap is checked before a call, so the crossing call runs (unit tests against a local test server)
- [ ] Each call is one ledger row with the always-present keys, and `error`, `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected` only when they apply; `error` is never on a successful row; writing `meter.jsonl` / `meter-dev.jsonl` happens only when the ledger has rows
- [ ] OpenRouter backend, tested against a fake upstream through `OPENROUTER_BASE_URL`: prefix stripped, usage accounting requested, `usage.cost` charged, a reply without cost failed, a 200 with an `error` body failed, HTTP 402 and credit messages reported as a credit stop (`who: program`, `model`, `message`), null content from a cut-off reasoning model read as empty text with finish reason `length`, decisions on the alpha path, rerank, a 5-minute call timeout
- [ ] Pi backend, tested against a fake model runtime: system messages joined, assistant turns rebuilt, input tokens = input + cache read + cache write, stop reason `error` or `aborted` a failure that still costs; embeddings outside OpenRouter only for the two OpenAI models at their fixed prices, through the provider's OpenAI-compatible endpoint with the key Pi resolves
- [ ] Mock mode: chat answers `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0, all at zero cost and with no upstream call
- [ ] Cost metrics of "Standard metrics" are computed from ledger rows: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`, refused calls excluded, all 0 without calls, 9 decimals (unit tests)
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes
