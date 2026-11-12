# 05: Weighted score, keep rule, noise margin and stop checks

**What to build:** The pure functions every decision of a night goes through: the weighted score of a metrics map, the keep decision with its `decision_reason`, the noise margin an experiment must beat, the measured A/A move, the soft-stop check at the start of a round, and the thresholds check at its end.

**Spec sections:**
- "Decision and calibration": "Weighted score", "Keep rule" (the outcomes table and the reason format), "Noise margin" (the measured move and the margin; not when a run is due)
- "Experiment lifecycle" > "Stops": the soft-stop table, its order, and the spend definition
- "Experiment lifecycle" > "Round loop": step 13
- "Every number in one place": config and loop rows

**Not yet:** running the A/A evaluation or deciding when it is due (ticket 23); the `outage` stop (ticket 24); wiring into the night (ticket 15).

**Blocked by:** 01 (Scaffold and Agent Server boot)

**Status:** ready-for-agent

- [ ] Weighted score: a share is `min(max(value, 0) / threshold, 1)`, a missing metric's share is 0, weights default to 1, the starter scores 0
- [ ] The keep rule returns each row of the outcomes table: the coder failed, unchanged files, `check` errors or a failed evaluation, a guardrail (failed gate, missing gate metric, a stage with `output_bytes` 0, 2 or more held-out names), scored keep, scored revert
- [ ] The comparison uses the epsilon 1e-12
- [ ] The scored reason prints scores with 4 decimals and includes the margin clause, the fresh-calls clause and the A/A value only when each applies
- [ ] Margin: base is `fixed`, else the A/A move, else 0; the fresh share applies only with `scale_by_replay` on and calls made; the result is clamped to `min` and `max`; the spec's worked example (0.022 with 9 of 83 calls fresh) gives 0.005
- [ ] The A/A move sums `weight × |share₁ − share₂|` over threshold metrics, divided by the sum of weights
- [ ] The soft-stop check returns `max_rounds`, `deadline`, `budget`, `tokens`, `plateau` in that order, the first that holds; `plateau_rounds: 0` never stops; the budget and token checks add the costliest round and the costliest evaluation as the spec states
- [ ] The thresholds check passes only when every threshold metric is present and at or above its target
- [ ] Unit tests cover the above; `npm run typecheck` and `npm test` pass
