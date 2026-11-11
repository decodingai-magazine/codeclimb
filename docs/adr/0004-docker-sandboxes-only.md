---
status: accepted
---

# Docker sandboxes only; no LangSmith Sandboxes backend

The first design ran sandboxes on LangSmith Sandboxes in prod, to match the Inngest twin's remote sandboxes. We dropped that backend: Docker on the operator's machine is the only one. The reasons: avoid any sandbox cost, keep the build simple, and CodeClimb here is an educational build with no production use. LangSmith Sandboxes were also switched off for our organization (the API answered "Sandbox feature is not enabled for this organization"), so the backend could not be checked. Decided 2026-11-11.

## Consequences

- LangSmith is used for tracing and feedback only.
- Snapshots, tunnels for the metering proxy and the sandbox platform checks are gone.
- Sandboxes are the same size on both stacks' local runs, so latency-type metrics compare without a correction.
- The stack comparison no longer measures the price of remote sandboxes on this stack.
