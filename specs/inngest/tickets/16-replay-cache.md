# 16: Replay cache: repeated program calls get the same answer

**What to build:** Within a night the proxy caches each successful call by kind, model and request. A later evaluation that repeats the call gets the cached answer back after the time the call took, for free but priced as the original in the cost metrics. Retries, the coder's own ledger and the A/A run each have their own rule.

**Spec sections** (`specs/inngest/spec.md`): "Metering proxy", "Standard metrics", "Noise margin"

**Blocked by:** 15 (Metering proxy: ledgers, routes, refusals and mock answers)

**Status:** ready-for-agent

- [ ] A successful call is cached by kind, model and request; a reply cut off by `max_tokens` is not cached (unit tests against a fake upstream)
- [ ] A second ledger repeating a call of an earlier ledger gets the cached answer, after the original call's duration, with no upstream call; the row is marked replayed with `replayed_usd`, costs the ledger nothing, and counts in `model_calls_replayed` and in the cost metrics at the original price
- [ ] The same call repeated within one evaluation ledger goes upstream
- [ ] A coder's dev ledger replays its own earlier calls, unless the call repeats within 5 seconds of its last answer
- [ ] A ledger opened for an A/A run neither reads nor writes the cache
- [ ] A new night's first token clears the cache
- [ ] Tests use a controllable clock or short delays, not real 5-second waits where avoidable
