# 15: Metering proxy: routes, tokens, refusals, ledgers and mock answers

**What to build:** The HTTP proxy in the worker that is a program's only path to a model. It answers the OpenAI-shaped routes for a token bound to one coder attempt or one evaluation, refuses what the token does not allow, meters every call into a ledger, and on a mock night answers with the canned replies at no cost. The cost metrics come from its ledger. Real upstreams come in ticket 37; this ticket's upstream is the mock or a stub.

**Spec sections** (`specs/inngest/spec.md`): "Metering proxy", "Features" (Metering proxy; Standard metrics), "Scenario contract", "Mock mode", "Environment"

**Blocked by:** 01 (Project scaffold, npm scripts, env loading and sandbox images)

**Status:** ready-for-agent

- [ ] The proxy is an HTTP listener the worker will hold; it binds `CODECLIMB_PROXY_HOST` and `CODECLIMB_PROXY_PORT` when set, a set host used as given
- [ ] Routes, in the shapes "Metering proxy" states: `POST /v1/chat/completions` (text messages, no tools, no streaming), `POST /v1/embeddings`, `POST /v1/decisions`, `POST /v1/rerank`, and `POST /v1/_op`, which names the operation later calls belong to and answers 200 (unit tests against a local listener)
- [ ] A token is bound to one coder attempt or one evaluation, its allowed models and a `$` cap. Refusals carry `error.message` and `error.type`: 401 `authentication_error`, 403 `permission_error` (model not allowed), 402 `insufficient_quota` (cap spent, credits), 400 / 413 `invalid_request_error`, 502 `api_error` (unit tests, one per refusal)
- [ ] Every call is one ledger line with `kind`, `model`, `op`, `ok`, `input_tokens`, `output_tokens`, `cost_usd` and `ms`, and `error` only on a failed or refused call; an evaluation's ledger is written as `meter.jsonl`, a coder's as `meter-dev.jsonl` (unit tests)
- [ ] Mock answers: chat `mock`, embeddings `[1, 0, 0, 0]` per input, decisions `{}`, rerank every score 0, every cost 0, no upstream call (unit tests)
- [ ] The cost metrics come from a ledger: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed` (unit tests on fabricated ledgers)
