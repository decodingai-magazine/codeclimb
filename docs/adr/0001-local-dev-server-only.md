---
status: accepted
---

# One mode: LangGraph's dev server on the operator's machine

CodeClimb on the LangChain stack runs in one mode. The Agent Server is the LangGraph dev server (`langgraph dev`) on the operator's machine, and sandboxes are local Docker containers (ADR 0004). There is no cloud mode and no production server. Decided 2026-11-11.

## Considered options

- **LangSmith Deployment** (the hosted Agent Server), the original migration plan's cloud mode. Rejected: every piece of a night's state lives on the server's disk (`runs/`, `experiments.git`, the scenarios' `lessons.md`) or in its process memory (the metering proxy's ledgers and cache, the live registry of running agents). A hosted deployment has no persistent disk, and the proxy would need a home outside it.
- **`langgraph up`** (the server image with Postgres and Redis, on the operator's machine). It gives a real database, a save before the next step and a sweeper that reruns lost runs; we measured all three. Rejected: its container has no Docker, so with Docker as the only backend it would need the host's Docker socket (not tried), and a second mode doubles what must be built and tested.
- **The dev server only** (chosen): the simplest build, at no cost. CodeClimb here is an educational build.

## Consequences

- Durability is the dev server's. Its state is in memory and reaches disk 3 s after its last write. A kill loses the steps saved since then; a kill within 3 s of a night's start loses the night's thread, and the night is then stopped as failed.
- The stack comparison is local and like for like: the Inngest dev server against the LangGraph dev server, Docker sandboxes on both, on one machine. Inngest Cloud is not compared.
