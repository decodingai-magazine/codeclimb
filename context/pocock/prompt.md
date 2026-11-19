/implement the build tickets in `.scratch/codeclimb/issues/`, one ticket at a time, frontier first, until every ticket is done. Start with the lowest-numbered ticket whose blockers are all done.

How to work the tickets:
- The frontier: the open tickets (`**Status:** ready-for-agent`) whose `**Blocked by:**` tickets are all `**Status:** done`. Always take the lowest-numbered one.
- One `implement` call per ticket, every ticket, small ones too. This message is the first ticket's call. For each next ticket, your first action is a Skill tool call: `implement`, with the ticket's path as its argument. Do no work on a ticket outside its own `implement` call, and never work two tickets in one call.
- Each `implement` call ends the way the skill says, for its own ticket: `code-review` (the Skill tool) on the work, then the commit. Run `code-review` once per ticket, not once at the end.
- A ticket is closed when its acceptance criteria pass: then set its `**Status:**` line to `done` and commit the work and the ticket file together, with the message `<NN>: <ticket title>`. Never mark a ticket done whose criteria do not pass.
- Tickets are local files (`docs/agents/issue-tracker.md`). Never call `gh`, `glab` or any issue tracker or its API.
- `code-review` asks for a fixed point: use `/app`'s root commit (`git rev-list --max-parents=0 HEAD`).
- No human will answer. Where a skill says to ask the user, decide yourself, write the decision under `## Comments` in the ticket, and keep going.
- When every ticket is done, run `/app/E2E.md` and fix what fails until every check passes.

{{ instruction }}
