# 15: Metering proxy: ledgers, routes, refusals and mock answers

**What to build:** A caller on the worker opens a ledger and gets a bearer token; a program holding that token can call chat, embeddings, decisions and rerank through `/v1`, and name its current operation through `/v1/_op`. Every call becomes a ledger row; refusals follow a fixed order and shape; closing the ledger returns its calls and revokes the token. In mock mode calls get canned answers at zero cost. The upstream is an interface: this ticket ships the mock one and tests with a stub. The replay cache (ticket 16), the route from a sandbox to the proxy (ticket 17) and the OpenRouter and Pi backends (ticket 38) are separate.

**Spec sections** (`specs/inngest/spec.md`): "Metering proxy", "Mock mode", "Standard metrics", "Pause for credits", "Deployment and environment"

**Blocked by:** 08 (Pi sessions with sandbox tools, mock models, the model check and credit detection)

**Status:** ready-for-agent

- [ ] The proxy has its own listener, one per worker, started on first use on `CODECLIMB_PROXY_HOST` (default `127.0.0.1`) and `CODECLIMB_PROXY_PORT` (default a random free port), built on `node:http`; the handler is exported so the worker API can also mount it under `/v1`
- [ ] Ledger lifecycle: open (evaluation id, allowed models, a dollar cap, a credit-stop callback) returns a random token; spend can be read; close returns the calls, revokes the token and aborts calls in flight (unit tests)
- [ ] The five routes accept and answer in the shapes of the route table; `/v1/_op` validates the op pattern, answers 200 and writes no row; the default op is `program`
- [ ] Refusals come in the spec's order with the stated status and `error.type`: 401, 413 (16 MiB), 403, 402 after a credit stop, 402 cap spent, 400; an upstream failure is 502 and its cost is still charged; the cap is checked before a call, so the crossing call runs (unit tests against a local test server)
- [ ] Each call is one ledger row with the always-present keys, and `error`, `finish_reason`, `reasoning_tokens`, `replayed_usd`, `rejected` only when they apply; `error` is never on a successful row; writing `meter.jsonl` / `meter-dev.jsonl` happens only when the ledger has rows
- [ ] Mock mode: chat answers `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0, all at zero cost and with no upstream call
- [ ] Cost metrics of "Standard metrics" are computed from ledger rows: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`, refused calls excluded, all 0 without calls, 9 decimals (unit tests)
- [ ] A credit signal from the upstream fires the ledger's credit-stop callback, after which the ledger refuses with 402 (unit test with a stub upstream)
- [ ] No criterion needs a paid call: every test runs against the mock upstream or a stub
