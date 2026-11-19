# 32: Seed

**What to build:** `run-night --seed ID|latest|best` starts a new night from an ended night's kept commit. Only the code, its dev metrics and its noise carry over: the new night has its own id, bundle, history and counters, and its round-0 commit is `<night>-r0-seed`.

**Spec sections:**
- "Features": **Continue, seed, rescore** (seed)
- "Interfaces the build must honour" > "CLI": `--seed`
- "Interfaces the build must honour" > "Ids": the seed commit

**Not yet:** the rescore round when the scoring files changed (ticket 33).

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `--seed <id>` seeds from that ended night; `latest` from the newest ended night of the results directory; `best` from the ended night whose kept commit has the highest weighted dev score
- [ ] A seed that names an unknown night, a night that has not ended (no `done.json` and no `stop.json`) or a night whose checkpoint has no dev metrics (it kept nothing and was not seeded itself) is refused with exit 2
- [ ] The new night's round-0 commit is `<night>-r0-seed` at the seed night's kept commit; `night.json` names the seed night
- [ ] The checkpoint starts with the seed's dev metrics and weighted score, and the seed night's measured noise is this night's noise, so no A/A run is due for the seed commit; a seed night that measured none gets its A/A run in round 1
- [ ] Nothing else carries over: no notes, history, rejected diffs or reviews of the seed night reach the new night's coders
- [ ] On mock models: a `datenorm-smoke` night seeded from an ended `datenorm-smoke` night starts from its kept commit, passes `validate-results`, and ends with `done.json`
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
