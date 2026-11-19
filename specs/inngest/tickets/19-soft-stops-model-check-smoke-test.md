# 19: Every soft stop, the model check and the smoke test; mock night 3 passes

**What to build:** A night stops softly for every reason the spec names, checked between rounds so a round always finishes, and each soft stop ends with the checkpoint scored on test once. Before a night starts the CLI checks the models, and before money goes into a round the smoke test checks that the models and the metered path are reachable. Both checks are skipped in mock mode. Mock night 3 (the plateau night) passes its own checks.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Soft stops; Smoke test; Loop), "Result row", "Night config", "CLI", "Architecture", "Mock mode", "Numbers"

**Blocked by:** 17 (Metered nights on Docker: mock night 1's metering passes); 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes)

**Status:** ready-for-agent

- [ ] The night keeps its spend, its coder and reviewer tokens (against `max_tokens`, when set) and its rounds in a row without a keep; at the start of each round it runs the stop checks of ticket 04 in their order, and `thresholds` at the end of each round
- [ ] Every soft stop (`max_rounds`, `deadline`, `budget`, `tokens`, `plateau`, `outage`, `thresholds`) leads to the test evaluation, the `test` row and `done.json` with that `stop_reason`
- [ ] The CLI checks the night's models before the night starts and exits non-zero, starting nothing, when one is not reachable with the credentials at hand (unit tests against fakes)
- [ ] The smoke test runs after the stop check of each round: the models and, on a metered night, the metered path; a failure is tried again, 7 tries 5 minutes apart, then the night stops with `outage` (unit test with a fake clock)
- [ ] With `--mock`, the model check and the smoke test are skipped
- [ ] With the dev server and the worker up, night 3, `npm run run-night -- --config configs/e2e/plateau.yaml --mock`, prints `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; there is a `test` row; no `cc-<id>` container is left, running or stopped
- [ ] End to end on mock nights with test-only config copies: a deadline that passes during round 1 ends with `stop_reason` `deadline`; a `datenorm-smoke` copy whose threshold round 1 reaches ends with `thresholds`
- [ ] `budget` and `tokens` are covered by unit tests through the night's stop check with fabricated counters
- [ ] Nights 1 and 2 still pass the checks of tickets 17 and 18
