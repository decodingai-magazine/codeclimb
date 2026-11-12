# 23: Lost connection mid-turn; mock night 6 passes

**What to build:** A coder turn that ends on a failed model call that is not a credit error is a stop like any other: the send-back rules apply, so the session carries on once calls succeed again. `--mock-offline N` imitates the lost connection on a mock night.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "Mock mode", "CLI", "End of an experiment", "Send-backs, reserve and wrap-up", "Events"

**Blocked by:** 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes); 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `--mock-offline` without `--mock` is refused before any event is sent; the number travels in the start event as `mock_offline`
- [ ] The coder's model calls number 2 to N+1 of the night's first experiment are answered as an assistant message with stop reason `error` and the error text `fetch failed`; every other call is answered as "Mock mode" scripts it (unit test on the response factory)
- [ ] A turn ended by such a message is handled by the send-back rules: it is neither `agent_error` nor a credit stop (unit tests with a fake session)
- [ ] Night 6, with the dev server and the worker up: `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` passes every check ticket 20 lists for night 2, and `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them; `npm run typecheck` and `npm test` pass
