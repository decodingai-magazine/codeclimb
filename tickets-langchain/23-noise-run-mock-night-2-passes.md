# 23: Noise run; mock night 2 passes in full

**What to build:** At the start of the first round whose checkpoint has metrics, the night evaluates the checkpoint on dev once more and measures how far the same commit moves. That move becomes the base of the noise margin every later experiment must beat. With this ticket, mock night 2 of the done signal passes every check of its table.

**Spec sections:**
- "Decision and calibration" > "Noise margin": the A/A run (when, what, `noise.json`, the retry rules, at most 2 per night)
- "Experiment lifecycle" > "Round loop": step 3
- "Experiment lifecycle" > "Ids": the noise run's id and sandbox name
- "Data and files" > "Result row": noise rows; "Files a night writes": `noise.json`
- "Reviewer": the A/A pair in what it reads
- "Metering proxy" > "Replay cache": the A/A run's ledger reads and writes no cache
- "Goal and done signal": night 2 and the check table

**Not yet:** a seeded or continued night's inherited noise (tickets 32, 36).

**Blocked by:** 17 (Reviewer); 18 (Send-backs, reserve and wrap-up); 22 (Metered nights: mock nights 1 and 3 pass)

**Status:** ready-for-agent

- [ ] The A/A run is due when the checkpoint has metrics and the night has no noise yet, unless `noise_margin.fixed` is set
- [ ] It runs on its own sandbox `cc-<night>-r<N>-noise`, writes a row with `kind: noise` (the checkpoint's `exp_id` and `commit`, coder fields 0, `score`, `decision` by the evaluation's success) and `noise.json` with `margin`, `expId`, `first`, `second` and `moves`
- [ ] A failed A/A run is tried again next round; a move above `max` is measured again on the next kept checkpoint; never more than 2 A/A runs per night
- [ ] The margin of every later decision uses the measured move as its base, and the scored reason shows the A/A value when the base is above 0
- [ ] The reviewer's prompt holds the A/A pair
- [ ] On a metered night the A/A run's ledger is opened with the replay cache off, for reading and for writing
- [ ] The noise evaluation's program spend counts toward the night's spend
- [ ] Unit tests cover when a run is due and the retry rules
- [ ] `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` passes every row of the done signal's table that applies to it: round 1 is kept, a `noise` row follows in round 2 and `noise.json` exists, the review hands its hypothesis to round 2, the night ends on `max_rounds` after exactly 2 rounds, and all the file checks hold (the `meter.jsonl` row is for capitals only)
- [ ] `capitals-smoke --mock` and the plateau night of ticket 22 still pass; capitals keeps nothing and runs no A/A
- [ ] `npm run typecheck` and `npm test` pass
