# 34: App: the Night page with status, controls, tiles and the live experiment

**What to build:** `/nights/<id>` shows a night's status and lets the operator act on it: Stop while it runs, Resume with the pause's reason while paused, a Continue form once it ended. Tiles summarize the night, and a panel shows the current round's experiment live. The page polls every 5 seconds.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "App", "Worker API"

**Blocked by:** 33 (App: scaffold, worker-API route, Nights list, Inngest scaffold)

**Status:** ready-for-agent

- [ ] The page polls the live endpoint every 5 s and refetches the report when a new row lands
- [ ] Status is shown; Stop posts to the stop endpoint; Resume appears only while paused, with the pause's reason; the Continue form (direction, rounds ≥ 1) appears once the night ended and shows the 409 reason when refused
- [ ] Tiles: kept primary value, test (one per stage on a multi-stage scenario), round, spend with the agents / program-runs breakdown, elapsed against the deadline (view-model unit tests, including a multi-stage report fixture)
- [ ] The current round's experiment shows phase, elapsed, tokens, coder and program-call spend, and follows a repair when `e1` takes over
- [ ] Check against a mock night on the dev server: the page of a finished night shows its last experiment as `evaluated`; the phase function is unit-tested for `starting`, `coding` and `waiting for eval` on fabricated folders; pressing Stop on a night that is still running ends it and the page shows `stopped`; the Continue form adds a round to a finished night
- [ ] Works in light and dark themes
