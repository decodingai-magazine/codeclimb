# 28: Lost connection mid-turn; mock night 6 passes

**What to build:** A coder turn that ends on a failed model call that is not a credit error is a stop like any other: the send-back rules apply, so the session carries on once calls succeed again. `--mock-offline N` imitates the lost connection on a mock night.

**Spec sections:**
- "CLI" > "Mock mode": the `--mock-offline N` bullet
- "CLI": the flag in the `run-night` command; it is valid only with `--mock`
- "Coder" > "End of an experiment": the bullet on a turn that ends on a failed model call; `agent_error` is only for a prompt call that threw
- "Interfaces" > "Control operations": `mock_offline` in the start input
- "Goal and done signal": night 6

**Not yet:** credit errors (ticket 29).

**Blocked by:** 23 (Noise run; mock night 2 passes in full); 25 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `--mock-offline` without `--mock` is a usage error (exit 2); the number travels in the start input
- [ ] The coder's model calls number 2 to N+1 of the night's first experiment are answered as an assistant message with stop reason `error` and the error text `fetch failed`; every other call is answered as usual
- [ ] A turn ended by such a message is handled by the send-back rules, not as `agent_error`
- [ ] `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` passes every check ticket 23 lists for night 2, and `exps/<id>-r1-e0/session/` holds at least one assistant message with stop reason `error`, followed by assistant messages without one
- [ ] `npm run typecheck` and `npm test` pass
