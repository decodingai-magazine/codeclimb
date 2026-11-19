# 36: Tracing and the scores mirror

**What to build:** Model calls, tool calls, sandbox commands and metered calls become OpenTelemetry spans under the night's work, and dev metrics are mirrored as scores in the runtime's dashboard. For debugging only: no decision reads them.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Tracing), "Runtime and tools", "Dependencies"

**Blocked by:** 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] Each model call, tool call, sandbox command and metered call is a span, nested under the night's work that made it (unit tests with an in-memory span exporter)
- [ ] Without a trace provider, tracing does nothing and other modules' unit tests need no setup
- [ ] A dev evaluation's metrics are mirrored as scores in the runtime's dashboard (unit tests with a fake)
- [ ] No decision reads a span or a score
- [ ] On a mock night with the dev server and the worker up, the dev server shows the night's spans and scores
- [ ] Nights 1 to 3 still pass the check of ticket 20
