# 28: Continue

**What to build:** `npm run run-night -- continue --config <yaml> [--night ID]` adds rounds to an ended night, one with a `done.json` or a `stop.json`, under the same id. It is a new variation: rounds number on from the last recorded round, from the kept commit (the round-0 commit when it kept nothing), carrying the last review, the history, the notes and the rejected diffs, an optional operator direction, a fresh deadline and a budget that does not compound. It ends with its own test evaluation.

**Spec sections:**
- "Features": **Continue, seed, rescore** (continue)
- "Architecture": the terms (variation)
- "Interfaces the build must honour" > "CLI": the `continue` row; `--rounds` "adds rounds on a continue; a continue keeps a mock night a mock"
- "Runtime and tools": "a continue starts clean"

**Not yet:** the rescore round (ticket 33); continue from the worker API (ticket 34).

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check); 22 (Stop command and cleanup: night 4 passes)

**Status:** ready-for-agent

- [ ] `continue` without `--night` picks the newest ended night of the config's results directory; a night with neither `done.json` nor `stop.json`, or an unknown one, is refused with exit 2
- [ ] The new variation starts from the kept commit, or the round-0 commit when nothing was kept, with that checkpoint's dev metrics; its first round is the last recorded round + 1
- [ ] Its coders find the earlier history, notes and rejected diffs under `/spec/history/`; the first coder gets the last review's hypothesis; `--direction TEXT` reaches every coder of the variation
- [ ] The variation has a fresh deadline and its own counters; `--rounds N` adds N rounds; the night's dollar cap does not compound across variations
- [ ] An ended night with `stop.json` can be continued; the new variation ends with its own `test-r<N>` evaluation and its own `done.json` or `stop.json`, and a `run-night` following it prints `done` or `stopped` for the variation, not for the earlier one; no `eval_id` is written twice
- [ ] A continue of a mock night is a mock night, with no `--mock` flag
- [ ] `--no-wait` exits after the start
- [ ] On `datenorm-smoke --mock`: a finished night continued with `--rounds 1` adds round 3 from round 1's kept commit, a `test-r3` row and a new `done.json` with `rounds: 3`; `validate-results` passes
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
