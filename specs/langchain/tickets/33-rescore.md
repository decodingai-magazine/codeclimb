# 33: Rescore

**What to build:** When the scenario's scoring files changed since the kept commit was scored, old scores can't be compared. A continued or a seeded night then runs one extra round first that scores the kept commit again on dev and measures the noise again, and the night goes on from those scores.

**Spec sections:**
- "Features": **Continue, seed, rescore** (rescore)
- "Interfaces the build must honour" > "Scenario contract": "scoring hashes"
- "Interfaces the build must honour" > "Result row": `parent_id` null on rescore rows

**Not yet:** nothing.

**Blocked by:** 28 (Continue); 32 (Seed)

**Status:** ready-for-agent

- [ ] A continue or a seed compares the scenario's current scoring hashes with the ones in the ended night's `night.json`; equal hashes add no round
- [ ] Changed hashes add one rescore round before any experiment: the kept commit is evaluated on dev again, its row has `parent_id` null, the checkpoint takes the new dev metrics, and the noise is measured again into `noise.json`
- [ ] The new variation's `night.json` records the new hashes
- [ ] On mock models with a temporary `datenorm` copy whose scorer is edited between two nights (outside `scenarios/`): a continue and a seed each run the rescore round first; with the scorer unchanged neither does
- [ ] `validate-results` passes on the rows; no `eval_id` is written twice
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
