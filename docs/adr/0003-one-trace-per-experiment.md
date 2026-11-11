---
status: accepted
---

# One trace per experiment, not one per night

LangSmith caps a trace at 25,000 runs. CodeClimb records one span per assistant message, tool call, sandbox operation and metered model call, and a night has about 72 experiments, so one trace per night would pass the cap. Each experiment's coder session therefore opens its own trace root, and so does each evaluation and each review; every root is tagged with the night id, and its spans go under it. The server run's own trace holds only the steps. Scores are mirrored as feedback on the experiment's root.

Checked on 2026-11-11 (`langsmith` 0.12.0): a root opened inside a step of a traced server run is a separate trace, and feedback posted twice with one feedback id is stored once, with the later score.

## Consequences

- A night is found in LangSmith by filtering on the night id, not by opening one trace.
- Spans do not need to nest under LangGraph's own trace runs, so the deprecated `initializeOTEL` helper and its OpenTelemetry SDK packages are not needed. Step bodies still call the OpenTelemetry API; a small tracer of CodeClimb's own writes each span as a LangSmith trace run.
- Roots are never shared between steps: a step that needs another step's root gets its run id as plain data.
