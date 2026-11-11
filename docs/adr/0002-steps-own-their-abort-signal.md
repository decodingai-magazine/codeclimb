---
status: accepted
---

# Steps own their abort signal; LangGraph's `timeout` is not used

A step with LangGraph's `timeout` option never sees a cancel of its server run: its signal stays unaborted, it runs to its end, the night runs one more step, and only then does the night's code see the cancel. A step without `timeout` gets the abort at once. Measured on `@langchain/langgraph` 1.7.3, on both the dev server and the `langgraph up` server (2026-11-11). A coder step runs for up to an hour, so a cancel that waits for it is not a cancel.

So no step uses `timeout`. Each step builds one abort signal from three sources: the server run's signal, its own backstop timer, and the live registry entry that the stop operation aborts. Retry rules test for CodeClimb's own timeout error, not `NodeTimeoutError`.

## Considered options

- **LangGraph `timeout` plus a poll on `stop.json`**: keeps the platform primitive, but a cancel from Studio or the API writes no `stop.json`, so it goes unnoticed until the step ends.
- **One signal per step, built by CodeClimb** (chosen).

## Consequences

- Revisit when the pinned LangGraph version changes: if a timed step starts receiving the run's signal, the platform `timeout` can come back.
- A cancelled run is reported as `interrupted` by the server while its step may still be running, so the stop operation never assumes the step has stopped.
- The two servers word the abort differently (`interrupt` on the dev server, `Client connection prematurely closed.` on `langgraph up`), so code tests the signal, never the error text.
