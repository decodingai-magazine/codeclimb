# 05: Decisions: weighted score, keep rule, noise margin and stop checks

**What to build:** The pure rules that decide a night: the weighted score of a set of metrics, whether an experiment is kept and why, the noise margin it must beat, and which soft stop, if any, ends the night before a round. Every decision reads metrics from evaluations; nothing an agent claims enters them.

**Spec sections:**
- "Features": **The loop** (the starter has a weighted score of 0), **Keep rule**, **Noise margin**, **Stops**
- "Interfaces the build must honour" > "Decisions": all of it
- "Interfaces the build must honour" > "Stops": the `done.json` table and the order of the checks
- "Architecture": isolation invariant "every decision reads metrics from evaluations"
- "Numbers": "held-out names in a diff that block a keep"

**Not yet:** measuring the noise (ticket 19); counting held-out names in a diff (ticket 16); the smoke test's `outage` (ticket 20). These rules take them as inputs.

**Blocked by:** 02 (Night config and scenario loading)

**Status:** ready-for-agent

- [ ] share = `min(max(value, 0) / threshold, 1)`, 0 when the metric is missing; weighted score = Σ `weight × share` / Σ weights; a checkpoint with no dev metrics scores 0
- [ ] The decision table holds row by row, each with its `decision_reason`: the coder failed outright (`error`, `the experiment failed`); unchanged files (`revert`, `unchanged: true`, `no code change`, the checkpoint's metrics); check errors or a failed evaluation (`error`, `not scored`, the primary metric at 0 and nothing else); a guardrail (`revert`, `blocked: <guardrails>`); scored (`keep` or `revert`, a reason that says how the weighted score compares with the checkpoint's plus the margin)
- [ ] Guardrails: a gate whose metric is missing or above its cap; two or more held-out names in the diff's added lines
- [ ] Keep only when the commit was scored, differs from the checkpoint, no guardrail fired, and its weighted score beats the checkpoint's by more than the margin
- [ ] The margin is the measured noise, scaled down by the replayed share of the experiment's model calls when `scale_by_replay` is on, and held between `noise_margin.min` and `.max`; `noise_margin.fixed` replaces the measurement; the margin stays between the floor and the cap also before any noise is measured
- [ ] The soft-stop check returns the first of `max_rounds`, `deadline`, `budget`, `tokens`, `plateau`, in that order; `budget` and `tokens` reserve room for one more round and for the test evaluation; `max_tokens` unset never stops; `plateau_rounds` 0 never stops; `thresholds` holds when every threshold metric of the checkpoint is ≥ its target
- [ ] Unit tests cover every row of the decision table, each guardrail, the margin's floor, cap, fixed value and replay scaling, and each soft stop with fabricated counters
- [ ] `npm run typecheck` and `npm test` pass
