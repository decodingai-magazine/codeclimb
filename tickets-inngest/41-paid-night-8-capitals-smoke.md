# 41: Paid night 8: capitals-smoke on real models, with the operator's go-ahead

**What to build:** Nothing new. The finished build runs the one paid end-to-end night of the done signal, `capitals-smoke` on real models, with the dev server and the worker up. It spends money, so it runs only when the operator says so for that run, after its ceiling was named. Anything the night shows broken is fixed in the ticket that owns it, and the night is run again with a new go-ahead.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "Night config", "What you get, what you build", "Files a night writes", "Result row", "Cleanup"

**Blocked by:** 40 (Final acceptance: the free end-to-end suite and the fixed contracts)

**Status:** ready-for-human

- [ ] Before the night the operator gives the go-ahead for that run, after being told its command and its ceiling. Without a go-ahead the night is reported as not run, never as passed; one go-ahead covers one run
- [ ] The night writes to `runs-inngest/<results folder>/`, with no `mock` in the path, and the ceiling is checked against `done.json`'s `spend_usd`
- [ ] Night 8, ceiling $0.50: `npm run run-night -- --config configs/capitals-smoke.yaml` prints `done`; there is a `test` row; `spend_usd` is above 0 and at most 0.50; `meter.jsonl` shows real calls
- [ ] The night also ends with `done.json` and no `stop.json`, passes `validate-results`, and leaves no `cc-<id>` container
- [ ] A short report says: go-ahead given or not, ran or not run, its `spend_usd` against its ceiling, passed or failed, and what was fixed
