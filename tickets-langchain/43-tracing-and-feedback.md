# 43: Tracing and feedback

**What to build:** With `LANGSMITH_TRACING` on, each coder session, each evaluation and each review appears in LangSmith as a trace of its own, found by filtering on `night_id`, with spans for assistant messages, tool calls, sandbox operations, program operations and metered calls. Each successful dev evaluation's metrics are mirrored as feedback on its experiment's trace root. With tracing off, or with no key, the spans are no-ops and nothing is sent.

**Spec sections:**
- "Interfaces" > "Tracing": all of it
- "Durable runtime on LangGraph": requirements rows "Scores mirror" and "Traces"; the rule that importing the graph module has no side effect beyond registering the tracer
- "Platform facts": the LangSmith row of the library table
- "Deployment and environment": the `LANGSMITH_*` variables
- "What you get, what you build": the `langsmith` and `@opentelemetry/api` rows

**Not yet:** nothing is deferred. No OpenTelemetry SDK package is added.

**Blocked by:** 22 (Metered nights: mock nights 1 and 3 pass); 25 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] Step bodies call only `@opentelemetry/api`; the tracer provider is CodeClimb's own, registered when the graph module loads, and writes each span as a LangSmith trace run through `RunTree`
- [ ] With no `LANGSMITH_API_KEY`, or with `LANGSMITH_TRACING=false`, no provider is registered and no LangSmith call is made
- [ ] Spans: one chat span per assistant message (model, tokens, cache, finish reason, cost); one per tool call; one per sandbox exec, read and write; one per program operation of an evaluation; one per metered call under its evaluation
- [ ] Each coder session opens a root named after the experiment; each evaluation, whatever its kind (dev, noise, test), and each review opens a root named after its own id; every root carries `night_id` and, where it has one, `exp_id` as metadata
- [ ] A rerun step opens a new root; a step that needs another step's root gets its run id as plain data in its input
- [ ] After a successful dev evaluation, the primary and headline metrics (every metric when the scenario has no headlines) are sent as feedback on the experiment's root, one per metric from the sorted names, with a `feedbackId` derived from the evaluation id and the metric; a failed feedback call is swallowed; no decision reads feedback
- [ ] Unit tests with a faked LangSmith client cover the span tree of a scripted session, the root metadata, the stable feedback ids, and the no-op mode
- [ ] The three mock nights of ticket 25 still pass with `LANGSMITH_TRACING=false`; with tracing on, a `datenorm-smoke --mock` night finishes and each experiment's root is found in the project by its `night_id`
- [ ] `npm run typecheck` and `npm test` pass
