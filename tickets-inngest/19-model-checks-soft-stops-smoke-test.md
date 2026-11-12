# 19: Model checks, every soft stop and the round-start smoke test

**What to build:** The loop gains the remaining soft stops (`deadline`, `budget`, `tokens`, `outage`; `plateau` came with ticket 17) with the counters they need, the model check at night start on the CLI and on the worker, and the smoke test at the start of each round. Any soft stop still ends with the test evaluation and `done.json`. Mock nights skip the model checks and the smoke test, so those are proven with fakes.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Stops", "Round loop", "Night config", "Mock mode", "Metering proxy", "Durable runtime on Inngest"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server); 17 (Metered nights on Docker: relay, ledgers, cost metrics; mock nights 1 and 3 pass); 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes)

**Status:** ready-for-agent

- [ ] The parent carries spend, tokens, per-round spends and tokens, rounds without a keep (since ticket 17) and the costliest evaluation, updated in the "Learn" step, and the stop check runs first in each round with the functions of ticket 4
- [ ] The model check runs on the CLI before the start event is sent, and again as the night's first step on the worker with the worker's credentials, where a failure is non-retriable; both are skipped with `--mock`
- [ ] The smoke test runs after the stop check: the model check plus, on a metered night, the proxy-path check; a failure is retried every 5 minutes, 6 more times, each wait a durable sleep; then the night stops with `outage` (unit test of the retry policy with a fake clock)
- [ ] Every soft stop leads to the test evaluation, the test row, the sweep and `done.json` with that `stop_reason`
- [ ] End-to-end, mock, dev server, with test-only copies (inside the checkout but outside `scenarios/` and `configs/`, gitignored, each with its own name and a `results_path` directly under `runs/`); the given configs stay unchanged: a deadline of a few seconds ends with `stop_reason: deadline`; a `datenorm-smoke` copy with a threshold at or below 0.125 ends with `thresholds` after round 1
- [ ] Unit tests cover `budget` and `tokens` through the loop's stop step with fabricated counters
- [ ] No criterion needs a paid call: provider and platform paths are tested against fakes
- [ ] The three mock nights of tickets 17 and 18 still pass
