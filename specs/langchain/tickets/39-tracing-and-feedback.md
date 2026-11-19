# 39: Tracing and feedback

**What to build:** With `LANGSMITH_TRACING=true`, LangSmith traces each experiment, evaluation and review, findable by night id, and holds each successful dev evaluation's headline scores as feedback on its experiment. Nothing reads it back. With tracing off none of it runs.

**Spec sections:**
- "Features": **Tracing**
- "Runtime and tools": the LangSmith bullet
- "Interfaces the build must honour" > "Environment": `LANGSMITH_TRACING`, `LANGSMITH_PROJECT`, `LANGSMITH_ENDPOINT`, `LANGSMITH_WORKSPACE_ID`
- "Interfaces the build must honour" > "Scenario contract": `headline`

**Not yet:** nothing.

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] With tracing on, every experiment, evaluation and review of a night is traced into `LANGSMITH_PROJECT` at `LANGSMITH_ENDPOINT` (and `LANGSMITH_WORKSPACE_ID` when set), each carrying the night id so a search by it finds them
- [ ] A successful dev evaluation adds its headline scores as feedback on its experiment's trace; a failed one adds none
- [ ] CodeClimb never reads traces or feedback back; no decision depends on them
- [ ] With `LANGSMITH_TRACING=false` nothing is sent: no trace, no feedback, no call to the endpoint (test against a local stub endpoint that counts requests)
- [ ] A tracing failure never fails a step or the night
- [ ] Tests run a mock night against a local stub LangSmith endpoint with tracing on and assert the traces, the night id and the feedback
- [ ] The gate of ticket 21 still passes with tracing off
- [ ] `npm run typecheck` and `npm test` pass
