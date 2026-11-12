# 37: Tracing and the scores mirror

**What to build:** Spans are built by hand on Pi's event stream with the OpenTelemetry API, which does nothing without a provider. On the worker the extended-traces middleware and the `@inngest/otel` preload nest them under the running step. Each successful dev evaluation also mirrors its primary and headline metrics as native scores on the experiment child's run. Nothing here is ever read by a decision.

**Spec sections** (`specs/inngest/spec.md`): "Tracing", "Durable runtime on Inngest", "Files a night writes"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] Spans: one chat span per assistant message (model, tokens, cache, finish reason, cost), one per tool call, one per sandbox exec, read and write, one per program operation of an evaluation, one per metered call under its evaluation (unit tests with an in-memory span exporter and a scripted event stream)
- [ ] Without a provider every tracing call is a no-op and unit tests of other modules need no setup
- [ ] The Inngest client carries the extended-traces and score middlewares; only `worker` preloads `@inngest/otel`
- [ ] Scores: in the evaluator child, one step per metric, named from the sorted metric names, targeting the experiment child's run id that the child returns and the parent passes on; the primary and headline metrics, or every metric when the scenario has no headlines; only for a successful evaluation; a failed score call is swallowed (unit tests with a fake step and score client)
- [ ] No decision path imports or reads traces or scores
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
