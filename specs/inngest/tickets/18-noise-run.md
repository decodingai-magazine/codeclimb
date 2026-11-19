# 18: Noise run: the A/A evaluation and the measured margin; mock night 2 passes

**What to build:** At the start of the first round whose checkpoint has metrics, the checkpoint is evaluated on dev once more with no replayed calls, and how much the score moved sets the noise margin every later keep must beat. Mock night 2 (`datenorm-smoke`) then passes its own checks: round 1 kept, a noise run, the review's hypothesis handed to round 2.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Noise margin; Keep rule; Loop), "Night config", "Ids and names", "Files a night writes", "Result row", "Numbers"

**Blocked by:** 12 (Reviewer: feedback, hypothesis and verdict every round); 16 (Replay cache: a repeated call is answered again for free); 17 (Metered nights on Docker: mock night 1's metering passes)

**Status:** ready-for-agent

- [ ] The A/A run comes at the start of the first round whose checkpoint has metrics, before that round's experiment, as `<exp>-noise-r<N>` in its own sandbox `cc-<eval id>`, with no replayed calls
- [ ] It writes `noise.json` with `margin`, `first` and `second`, and a `noise` row; its spend counts in the night's spend
- [ ] Every later keep uses the margin of ticket 04 with the measured move (or `noise_margin.fixed`) and the experiment's replayed share, and its `decision_reason` says so
- [ ] A night runs at most 2 A/A runs (unit test)
- [ ] With the dev server and the worker up, night 2, `npm run run-night -- --config configs/datenorm-smoke.yaml --mock`, prints `done` with `stop_reason` `max_rounds` after exactly 2 rounds: round 1 holds the starter's code, scores accuracy 0.125 on dev and is kept, a `noise` row follows in round 2, `noise.json` exists (C11), and round 2's coder tests the review's hypothesis
- [ ] Night 1 still passes the checks of ticket 17, and runs no A/A run
