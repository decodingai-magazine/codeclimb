---
status: accepted
---

# One mode: the `langgraphjs up` Agent Server, with its own Postgres and Redis

Supersedes ADR 0001. CodeClimb's Agent Server is now the self-hosted server that `langgraphjs up` builds and starts in Docker on the operator's machine, with its own Postgres and Redis. The dev server is removed, not kept as a second mode. Sandboxes stay local Docker containers (ADR 0004), now created from the server container through the host's Docker socket. Decided 2026-11-12 in issue #26, after the go/no-go spike #27.

## Why

The dev server keeps its state in memory, writes it to disk only after 3 quiet seconds, and ignores a run's `durability` option. Two consequences:

- a kill loses every step finished since the last quiet stretch. A mock night has no quiet stretch, so a kill in round 2 could replay the night from its start. CodeClimb's idempotent writes made that replay safe, but it cost time, repeated model calls and a dependency on the watchdog
- a kill within 3 s of a night's start loses the night's thread, and the watchdog then stops the night as `failed`

The operator wants durability from the runtime itself: once a step finishes, it stays finished across a crash.

## What the switch fixes

- every server run CodeClimb starts passes `durability: "sync"`, and the graph checkpoints live in Postgres. In the spike, a mock datenorm night killed mid-round 2 finished by itself after `up` again: every `eval_id` once, round 1's `code-state.json` unchanged, and no round 1 sandbox created again. It resumed from its last stored step instead of replaying the night
- threads are in Postgres, so a kill no longer loses one (none was lost in the spike; the watchdog's no-thread rule stays as a guard)

## What it does not fix

- an interrupted step reruns from its start. `sync` stores a result asynchronously, within about a second: a kill 6 ms after a step finished lost that step too. The idempotent-write rules are still needed
- the proxy's ledgers and replay cache and the live registry are in the server process's memory and are lost on a crash
- a killed run is picked up only by the server's runs sweeper, about 2 minutes after `up`
- a task that fails out of its retries still fails the server run, so the step wrapper still returns a step's final failure as data

## Considered options

- **Keep the dev server** (ADR 0001). Simplest, but its durability is the problem above.
- **Both modes behind a switch.** Doubles what must be built and tested.
- **`langgraphjs up` with an external Postgres.** Nothing needs a shared database; `up` starts its own.
- **The hosted Agent Server (LangSmith Deployment).** Still rejected for ADR 0001's reason: a night's state is on disk and in process memory, and a hosted deployment has neither a persistent disk nor a home for the proxy.
- **`langgraphjs up` only** (chosen). The spike found no blocker: the image runs CodeClimb's TypeScript from source, starts with only a LangSmith key, and reaches Docker through the host's socket.

## Consequences

- the server needs `LANGSMITH_API_KEY` to boot: mock nights and CI need a key
- a code change needs a new image (`npm run server` again, or `up --watch`). Either recreates the server container, which to a running night is a kill
- the server image adds `git` and a Docker CLI to the base image; a compose override mounts the Docker socket, the checkout (at its host path) and Pi's `auth.json`, and puts the server container on `cc-meter`
- the metering proxy binds every interface in the server container on a fixed port, and the shared relay forwards to the server container by name on `cc-meter`. The relay serves one server at a time
- the server listens on `127.0.0.1:8123`
- the spec's platform facts were re-measured on this server; those measured only on the dev server are marked as such until ticket #31 confirms them
