# 13: Reviewer: feedback, hypothesis and verdict every round

**What to build:** After each decision the reviewer, a Pi session with no tools and its own system prompt, reads the experiment against the checkpoint and writes feedback, the next hypothesis and a verdict. It decides nothing. A multi-round night now passes the reviewer's hypothesis to the next coder, the review's cost and time land on the round's rows, and a failed review never kills the night.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Reviewer", "Round loop", "Standard metrics", "Files a night writes", "Mock mode"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server)

**Status:** ready-for-agent

- [ ] The review prompt holds what "Reads" lists, with the metric-visibility rule (thresholds, gates and headlines always; diagnostics with headlines; every scorer metric without) and the optimized-standard-metrics rule with `min_efficiency_gain`; an `unchanged` experiment gets the checkpoint's scores, the nothing-was-tested note and the closing message (unit tests)
- [ ] Every evidence cap of the table is implemented and unit-tested: per-item errors at 70,000 characters per stage with the equal-share rule, the run log at 4,000 with dropped lines and flagged lines first, diff and checkpoint source cut at 60,000 with a note, tasks and train measurements at 4,000, unchanged stages by output hash
- [ ] The system prompt carries the five rules of the spec and contains neither `You stopped with` nor `change no more code` (unit test)
- [ ] Reply handling: the object between the first `{` and the last `}`, trimmed fields, `feedback` a string and `hypothesis` non-empty, a missing `verdict` allowed, one retry asking for JSON only, then the review fails (unit tests)
- [ ] Leak loop: the three fields go through `scan`; a find triggers one rewrite request; what survives is masked (unit tests with a fake scan)
- [ ] `reviews/r<N>.prompt.md` is written before the call and `reviews/r<N>.json` after, with the listed keys
- [ ] In the loop: the review runs every round, also after a revert and in the last round; a failed review keeps the last feedback and hypothesis and leaves the verdict empty; `reviewer_usd` and `t_review` are on the round's rows; the next round's coder prompt has the reviewer's hypothesis in `<hypothesis>`
- [ ] End-to-end, mock, dev server: `datenorm-smoke --mock` (its two rounds) prints `done`, `reviews/r1.json` and `reviews/r2.json` exist with `feedback: mock feedback`, and the round-2 commit message is `<exp id>: mock hypothesis`
