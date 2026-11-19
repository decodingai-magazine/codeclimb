# 19: Noise run: night 2 passes

**What to build:** At the start of the first round whose checkpoint has dev metrics, the night evaluates that checkpoint a second time with no replayed calls (the A/A run) and takes the weighted move between the two runs as the noise. The noise margin of ticket 05 then comes from it. `datenorm-smoke --mock` (night 2) passes every check.

**Spec sections:**
- "Goal and done signal": night 2, C1 to C14 (C11 in full)
- "Features": **Noise margin**
- "Interfaces the build must honour" > "Ids": the noise run id; its sandbox
- "Interfaces the build must honour" > "Result row": noise rows ("carry the checkpoint's `exp_id` and `commit`"; `parent_id` null)
- "Interfaces the build must honour" > "Files a night writes": `noise.json`
- "Interfaces the build must honour" > "Night config": `noise_margin`
- "Numbers": A/A runs per variation

**Not yet:** the noise inherited by a seed (ticket 32) and measured again on a rescore (ticket 33).

**Blocked by:** 18 (Metered nights: nights 1 and 3 pass)

**Status:** ready-for-agent

- [ ] The A/A run starts the first round whose checkpoint has dev metrics, before that round's experiment; it is `<exp>-noise-r<N>` with N the round it runs in, on its own sandbox, with replay off
- [ ] Its row has `kind: noise`, the checkpoint's `exp_id` and `commit`, `parent_id` null, and `decision` `keep` when the evaluation succeeded, else `error`
- [ ] `noise.json` holds the noise margin and the two A/A runs it came from
- [ ] A failed A/A run is run again at the start of the next round; one whose move is above `noise_margin.max` is run again on the next kept checkpoint; at most two A/A runs per variation; with no usable measurement the margin stays within its floor and cap
- [ ] With `noise_margin.fixed` set no A/A run happens and the fixed value stands in for the move
- [ ] Night 2, `datenorm-smoke --mock`: C1 to C14 hold; round 1 is kept, a `noise` row follows in round 2 and `noise.json` exists, the review hands its hypothesis to round 2, and the night ends on `max_rounds` after exactly 2 rounds
- [ ] Nights 1 and 3 still pass
- [ ] `npm run typecheck` and `npm test` pass
