# 04: Decision functions: weighted score, keep rule, noise margin, stop order

**What to build:** The pure functions that decide every keep and every soft stop, fully unit-tested before any night runs: the weighted score, the keep rule with its guardrails and its `decision_reason`, the noise margin, and the stop checks in the spec's order. Every decision reads metrics from evaluations only.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Loop; Weighted score; Keep rule; Noise margin; Soft stops), "Night config", "Result row", "Numbers"

**Blocked by:** 03 (Night config, night ids and the runs folder)

**Status:** ready-for-agent

- [ ] Weighted score: each threshold metric's share is `min(max(value, 0) / threshold, 1)` and the score is the weighted mean of the shares, with the config's weights (1 each by default); gains past a threshold add nothing; cost and latency metrics never enter it; the starter's score is 0 (unit tests)
- [ ] Keep rule: an experiment is kept only if it has a commit, its dev evaluation succeeded, its files differ from the checkpoint's, no guardrail fired and its weighted score beats the checkpoint's by more than the noise margin; otherwise it is reverted, or an `error` when it was not scored (unit tests, one per condition)
- [ ] Each guardrail blocks a keep: a failed gate (a value above its cap, or a missing metric); a stage with no output in an evaluation that was still scored; two or more held-out names in the diff. One held-out name does not block (unit tests)
- [ ] Every decision comes with a `decision_reason` that says which condition decided it (unit tests)
- [ ] Noise margin: the measured A/A move, or `noise_margin.fixed` when set; with `scale_by_replay` it is smaller the more of the experiment's model calls were replayed; always kept between `min` and `max` (unit tests)
- [ ] Stop checks at the start of a round, in this order, the first that holds winning: `max_rounds` (the next round would pass it), `deadline`, `budget` (the night budget can't cover another round and the test evaluation), `tokens` (the token cap can't cover another round), `plateau` (`plateau_rounds` rounds in a row kept nothing; 0 never stops). `thresholds` at the end of a round: every threshold metric of the checkpoint reached its target (unit tests)
