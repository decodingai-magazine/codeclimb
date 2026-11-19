# 04: Stage reports and standard metrics

**What to build:** An evaluation's metrics come from two places: the scorer's report per stage, and the standard metrics measured outside the code under optimization (latency from the runner's timings, cost and call counts from the proxy's ledger). This ticket turns those inputs into one flat map of metric name → number.

**Spec sections:**
- "Interfaces the build must honour" > "Scenario contract": "metrics from a report", "standard metrics"
- "Features": **Evaluator** (the standard metrics are always recorded)
- "Interfaces the build must honour" > "Metering proxy": the ledger row fields

**Not yet:** reading files from a sandbox (ticket 11); writing ledger rows (ticket 17).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] A report's numbers are flattened with `.`; lists, `per_item` and `details` are skipped; `ci95: [lo, hi]` becomes `ci95_half`
- [ ] With more than one stage, every key of a stage gets `<stage>.` in front; with one stage, keys stay bare
- [ ] Each stage adds `output_bytes` (prefixed like the rest with more than one stage)
- [ ] From `timings.jsonl` lines `{op, id?, ms, warmup?}`: `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s` per op and `latency_total_s`; a missing or empty file adds no latency metric
- [ ] From ledger rows: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`
- [ ] Unit tests cover a single-stage and a three-stage report, a `ci95` pair, skipped lists, timings with several ops, and a ledger with replayed and failed calls
- [ ] `npm run typecheck` and `npm test` pass
