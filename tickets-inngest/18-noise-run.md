# 18: Noise run: the A/A evaluation and the measured margin; mock night 2 passes

**What to build:** At the start of the first round whose checkpoint has metrics, the checkpoint is evaluated on dev once more with no replayed calls. The move between the two scores is stored in `noise.json`, recorded as a `noise` row, and feeds the margin of every later keep and the reviewer's reading of small moves.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "Noise margin", "Round loop", "Ids", "Result row", "Reviewer", "Files a night writes"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server); 12 (Reviewer: feedback, hypothesis and verdict every round); 16 (Replay cache: repeated program calls get the same answer); 17 (Metered nights on Docker: relay, ledgers, cost metrics; mock nights 1 and 3 pass)

**Status:** ready-for-agent

- [ ] The A/A run is due when the checkpoint has metrics, the night has no noise yet and `noise_margin.fixed` is unset; it runs as round-loop step 3 on the sandbox `cc-<night>-r<N>-noise` with eval id `<exp>-noise-r<N>`, and its ledger bypasses the replay cache
- [ ] `noise.json` holds `margin`, `expId`, `first`, `second` and `moves`; the `noise` row follows "Rows that are not experiments" and carries `score`; its program spend counts in the night's spend
- [ ] A failed A/A run is tried again next round; a move above `max` is measured again on the next kept checkpoint; at most 2 A/A runs per night (unit tests on the when-due function)
- [ ] Every keep decision uses the margin from ticket 4 with the stored base and the experiment's fresh share; `decision_reason` shows the clauses that apply; `min` applies before any A/A run and after a failed one
- [ ] The reviewer's prompt includes the A/A pair
- [ ] Night 2, with the dev server and the worker up: `npm run run-night -- --config configs/datenorm-smoke.yaml --mock` prints `done` with `stop_reason` `max_rounds`, and `done.json` has `rounds: 2`; round 1 is kept, a row with `kind: noise` and round 2 follows it in `results.jsonl`, and `nights/<id>/noise.json` exists
- [ ] `capitals-smoke --mock` and the plateau night of ticket 17 still pass; capitals keeps nothing and runs no A/A
