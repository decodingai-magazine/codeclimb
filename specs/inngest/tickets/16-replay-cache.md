# 16: Replay cache: a repeated call is answered again for free

**What to build:** Within a night a repeated program call is replayed from the night's cache, so unchanged code scores the same and a metric moves only where a change reached. A coder's call repeated within the retry window of its last answer is a retry and goes to the provider, and the A/A run uses no replayed calls.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Metering proxy; Noise margin), "Metering proxy", "Numbers"

**Blocked by:** 15 (Metering proxy: routes, tokens, refusals, ledgers and mock answers)

**Status:** ready-for-agent

- [ ] Within a night a repeated call gets the earlier answer with no upstream call; its ledger line marks it replayed, it counts in `model_calls_replayed`, and it costs the night nothing (unit tests against a stub upstream)
- [ ] Two ledgers of the same night that repeat the same calls against a stub upstream answering at random get the same answers
- [ ] A coder's call repeated within 5 seconds of its last answer goes to the provider (unit test with a controllable clock)
- [ ] A ledger opened for an A/A run neither reads nor fills the cache (unit test)
- [ ] The cache never carries a call from one night into another (unit test)
