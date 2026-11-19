# 23: Lost connection mid-turn; mock night 6 passes

**What to build:** `--mock-offline N` makes the coder's model calls 2 to N+1 of the night's first experiment fail as a lost connection. A turn that ends on a failed model call is a stop like any other, so the send-back rules carry the session on once model calls succeed again. Mock night 6 passes.

**Spec sections** (`specs/inngest/spec.md`): "Features" (End of an experiment; Send-backs, reserve and wrap-up), "Mock mode", "CLI", "Files a night writes", "Goal and done signal"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] With `--mock-offline N` the coder's model calls 2 to N+1 of the night's first experiment each fail as an assistant message with stop reason `error` and the text `fetch failed`; every other call is answered as "Mock mode" scripts it (unit test)
- [ ] A turn that ends on a failed model call is handled by the send-back rules; it is neither `agent_error` nor a credit stop (unit tests with a fake session)
- [ ] Night 6, with the dev server and the worker up: `npm run run-night -- --config configs/datenorm-smoke.yaml --mock --mock-offline 6` passes C1 to C14, and `exps/<id>-r1-e0/session/` holds an assistant message with stop reason `error`, followed by assistant messages without one
- [ ] Nights 1 to 3 still pass the check of ticket 20
