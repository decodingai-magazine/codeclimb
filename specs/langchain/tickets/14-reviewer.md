# 14: Reviewer

**What to build:** One review per round, a Pi session with no tools on a model or thinking level that differs from the coder's. It reads the round's evidence on dev and writes `feedback`, the next round's `hypothesis` and a short `verdict`. It runs every round, also after a revert and in the last round. Its output is scanned and masked; a failed review keeps the last feedback and never kills the night. The next round's coder tests its hypothesis.

**Spec sections:**
- "Features": **Reviewer**; **The loop** ("later rounds test the reviewer's" hypothesis)
- "Architecture": the data flow of a round (review); isolation invariants ("the reviewer reads dev")
- "Interfaces the build must honour" > "Scenario contract": `headline`, `diagnostics`, `protocol` (`path#Heading`), `details` on dev
- "Interfaces the build must honour" > "Files a night writes": `reviews/r<N>.json`, `r<N>.prompt.md`; the note's reviewer part
- "Interfaces the build must honour" > "Result row": `reviewer_usd`, `t_review`, `tokens`
- "Goal and done signal": C7, C9

**Not yet:** credit stops in a review (ticket 26); the reviewer's last feedback on a continue (ticket 28); real reviewer models (ticket 41).

**Blocked by:** 13 (Notes, history, rejected diffs and the trajectory)

**Status:** ready-for-agent

- [ ] The review reads the spec, the checkpoint, the experiment's diff, its dev metrics (the headlines and the metrics matching `diagnostics`), the per-item dev errors from `details`, the run logs, the coder's notes, the files and sections `protocol` names, and the night so far; nothing from a test evaluation
- [ ] The reply is parsed as JSON with `feedback`, `hypothesis` and `verdict`; a reply that is not that JSON is a failed review
- [ ] The review may describe categories of error but never names a dev item; its output is scanned for held-out names; what the scan finds is rewritten or masked before anything is saved or handed on
- [ ] `reviews/r<N>.json` holds `round`, `model`, `feedback`, `hypothesis`, `verdict`, `reviewer_usd`, `t_review` and `tokens`; `reviews/r<N>.prompt.md` holds what the review read
- [ ] The verdict is added to the round's note as `### Reviewer, after the evaluation`; `reviewer_usd` and `t_review` are on each of the round's rows, and `reviewer_usd` is counted once in the night's spend
- [ ] The review is told the standard metrics the config names (`standard_metrics`); cost and latency are reported to it, never scored
- [ ] Round N+1's coder gets round N's hypothesis; round 1's coder gets none
- [ ] A failed review keeps the last feedback, the round still completes, and the night goes on
- [ ] On `datenorm-smoke --mock`: `reviews/r1.json` and `reviews/r2.json` exist with `feedback: mock feedback`; every note has a `mock verdict` reviewer part; round 2's coder prompt holds `mock hypothesis`
- [ ] `npm run typecheck` and `npm test` pass
