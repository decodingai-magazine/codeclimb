# 04: Stage reports and standard metrics

**What to build:** Given the files an evaluation leaves behind (each stage's report, its `timings.jsonl`, its input line count, its output size, the proxy's ledger rows), the build returns the evaluation's flat `metrics` map exactly as a result row carries it.

**Spec sections:**
- "Scenario contract" > "Stage reports become metrics"
- "Evaluator" > "Standard metrics": the latency and cost bullets
- "Every number in one place": the rounding row

**Not yet:** producing those files (tickets 13, 20); naming optimized metrics to the agents (tickets 11, 17).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] Flattening joins nested keys with `.`, skips lists, non-numbers, `per_item` and `details`, and turns `ci95: [lo, hi]` into `ci95_half`
- [ ] With more than one stage every key gets `<stage>.` in front; with one stage none does; each stage adds its `output_bytes`
- [ ] `timings.jsonl` parsing: `op` must match the pattern, warm-up records count for nothing, a malformed file is an error the evaluator can report
- [ ] Latency metrics: `latency_<op>_p50_ms`, `latency_<op>_p95_ms` by linear interpolation at 3 decimals, `latency_<op>_total_s` and `latency_total_s` at 6 decimals
- [ ] Cost metrics from ledger rows, refused calls excluded: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd`, `model_calls`, `model_calls_replayed`, `model_calls_failed`; all 0 without calls; a replayed call is priced as the call it stands for
- [ ] Standard metrics are added last and win over a scorer's metric of the same name
- [ ] Unit tests cover the above; `npm run typecheck` and `npm test` pass
