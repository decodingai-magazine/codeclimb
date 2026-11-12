# 09: Step wrapper, abort signal and live registry

**What to build:** The one place where a framework-free step body becomes a LangGraph `task()`. A graph author wraps a body, gives it a name, and gets: its result saved once and reused on replay, 3 attempts, a failure that reaches the entrypoint as a thrown error the entrypoint can catch without failing the server run, a backstop timer of CodeClimb's own, and one abort signal handed to the body. The live registry lets the stop operation abort every running step of a night.

**Spec sections:**
- "Durable runtime on LangGraph": the requirements table rows "Retry", "A failed step doesn't fail the night", "Backstop timeouts", "One abort signal per step"; "Rules the loop depends on"
- "Coder" > "Crash and resume": the live registry bullet
- "Platform facts": the library-behaviour table
- "Every number in one place": runtime rows "step attempts" and "backstop timers per attempt"

**Not yet:** any real step body; the stop operation that fires the registry (ticket 24). Step bodies stay free of LangGraph imports: this wrapper, the graph definitions and the control operations are the only places it appears.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A wrapped step is a `task()` named by the caller (the form `<experiment or evaluation id>/<step>` is supported) with `retry` of 3 attempts; no step uses the `timeout` option
- [ ] `retryOn` is false for CodeClimb's non-retriable error, for CodeClimb's timeout error and for an abort of the server run
- [ ] On its last attempt, or at once for a non-retriable error, the step returns its failure as data and the wrapper throws it in the entrypoint; a test entrypoint that catches it ends its run in success
- [ ] Each attempt gets one abort signal built from the server run's signal, its backstop timer and its live registry entry; the body receives it as an argument
- [ ] A backstop timer that fires aborts the signal and the step then fails with CodeClimb's timeout error, not retried
- [ ] An abort is recognized by `signal.aborted`, never by error text
- [ ] The live registry maps an experiment or evaluation id to an abort function and its night id; aborting a night aborts all its entries; an entry is removed when its step ends
- [ ] The attempt number is read through `getConfig()` and goes to logs only
- [ ] Tests run a throwaway entrypoint in process and cover: replay returns a saved result without running the body, retry then success, failure as data, non-retriable failure, backstop timeout, registry abort; `npm run typecheck` and `npm test` pass
