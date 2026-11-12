# 04: Decision functions: weighted score, keep rule, noise margin, soft stops

**What to build:** Everything that decides is a pure function over dev metrics and the parent's counters: the weighted score, the keep rule with its guardrails and outcome table, the `decision_reason` text, the A/A move and the margin an experiment must beat, the soft-stop check in its fixed order, and the thresholds check. The loop tickets only call these.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Decision and calibration", "Weighted score", "Keep rule", "Noise margin", "Stops", "Every number in one place"

**Blocked by:** 03 (Night config: parse, defaults, validation, night ids, results paths)

**Status:** ready-for-agent

- [ ] Weighted score: shares capped at 1, negative values floored at 0, a missing metric's share 0, weights applied, the starter scoring 0 (unit tests)
- [ ] Keep rule: every row of the outcomes table produces the stated `decision`, row metrics and `decision_reason`; each guardrail (failed or missing gate, `output_bytes` = 0, 2 or more held-out names in added lines) blocks with `blocked: <guardrails>`; 1 held-out name is only a note (unit tests)
- [ ] The scored reason prints 4-decimal scores and includes the margin clause, the fresh-calls clause and the A/A value only when each applies; the comparison uses the 1e-12 epsilon (unit tests)
- [ ] A/A move: the weighted sum of absolute share moves, so two metrics that move apart add up; the `noise.json` content (`margin`, `expId`, `first`, `second`, `moves`) is produced from two metric sets (unit tests)
- [ ] Margin: base = `fixed`, else the move, else 0; fresh share `f`; `clamp(base × √f, min, max)`; the spec's worked example (0.022 with 9 of 83 fresh gives 0.005) is a test
- [ ] Soft stops: `max_rounds`, `deadline`, `budget`, `tokens`, `plateau` checked in that order, the first winning, with the budget and token formulas of the Stops table; `plateau_rounds: 0` never stops (unit tests)
- [ ] Thresholds check: every threshold metric present and ≥ its target (unit tests)
- [ ] Spend arithmetic of "Stops" (row spend, round spend, night spend) is a tested function
