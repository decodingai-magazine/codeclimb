# 12: Reviewer: feedback, hypothesis and verdict every round

**What to build:** Every round ends with a review: one tool-less Pi session on the reviewer's model reads the round's evidence and writes `feedback`, the next `hypothesis` and a `verdict`, which the next round's coder tests. The review decides nothing, runs on reverted rounds too, never names a dev item, and a failed review never kills the night.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Reviewer; Loop), "Architecture", "Night config", "Scenario contract", "Files a night writes", "Mock mode"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server)

**Status:** ready-for-agent

- [ ] One review per round, in a tool-less session on `reviewer_model` at `reviewer_thinking`
- [ ] The review reads the scenario's spec and `protocol` files, the checkpoint, the diff, the dev metrics with per-item errors, the run logs, the coder's notes and the night so far; the metrics it is shown include the scenario's `headline` and the ones its `diagnostics` match (unit tests on the prompt builder)
- [ ] The review is told about the standard metrics `standard_metrics` enables and mentions a change in one larger than `min_efficiency_gain` (unit test)
- [ ] `reviews/r<N>.json` holds `round`, `model`, `feedback`, `hypothesis`, `verdict` and `reviewer_usd`; `reviewer_usd` is on the round's row
- [ ] The review runs every round, kept, reverted or `error`, and the keep decision never reads it (unit test)
- [ ] The review's text passes the scenario's `scan` before any coder reads it, and found names are masked (unit test with a fake scan)
- [ ] A review that fails leaves the round recorded and the night running (test with a failing fake reviewer)
- [ ] The next round's coder prompt carries the review's hypothesis, and that round's commit message is `<exp id>: <hypothesis>`
- [ ] With the dev server and the worker up, `datenorm-smoke --mock` prints `done`; `reviews/r1.json` and `reviews/r2.json` exist with `feedback: mock feedback` (C7), and round 2's commit message ends with `mock hypothesis`
