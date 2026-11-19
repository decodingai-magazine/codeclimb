# 26: Pause for credits, resume and the pause timeout

**What to build:** Running out of credits pauses a night instead of failing it. A credit error from a program call, the coder or the reviewer becomes a credit stop: the coder commits its partial work, the evaluation reports no score, the review just stops, and only the night waits, with no sandbox running, behind a `pause.json`. `npm run run-night -- resume --night <id>` ends the pause and reruns only what stopped. A pause nobody ends times out after 3 days and stops the night.

**Spec sections:**
- "Features": **Pause for credits**; **Coder** (ends "on a credit stop"); **Evaluator**; **Reviewer**
- "Architecture": the terms (resume, credit stop)
- "Interfaces the build must honour" > "CLI": the `resume` row; "`resume` only ends a pause, once"
- "Interfaces the build must honour" > "Mock mode": `CODECLIMB_MOCK_CREDIT`
- "Interfaces the build must honour" > "Metering proxy": refusals ("a credit stop")
- "Interfaces the build must honour" > "Files a night writes": `pause.json`, `pauses.jsonl`
- "Interfaces the build must honour" > "Environment": `CODECLIMB_PAUSE_TIMEOUT_S`, `CODECLIMB_MOCK_CREDIT`
- "Runtime and tools": the Agent Server "suspends a night for a pause until a human resumes it"
- "Numbers": pause timeout

**Not yet:** the real providers' credit signals reaching the proxy (ticket 40); resume from the worker API (ticket 34).

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check); 22 (Stop command and cleanup: night 4 passes); 24 (Crash resume: night 5 passes)

**Status:** ready-for-agent

- [ ] A credit error (an HTTP 402 or the provider's out-of-credits answer) is told apart from other failures and from rate limits; from the coder it ends the experiment with a credit stop in `code-state.json` after committing the partial work; from a program call the proxy refuses the token's later calls and the evaluation reports no score; from the reviewer the review stops
- [ ] After a credit stop the night writes `pause.json` (the current pause and who stopped it), removes its sandboxes and waits; `run-night` following the night says it is paused and how to resume
- [ ] `run-night resume --night <id>` ends the pause and follows the night (`--no-wait` exits after the resume); it is refused for a night that is not paused, has a `stop.json` or a `done.json`, or whose pause was already ended; ending a pause twice changes nothing more
- [ ] After a resume only what stopped reruns: the coder carries on in the same Pi session from its commit, the evaluation runs again from scratch under the same `eval_id`, the review runs again
- [ ] Ending a pause deletes `pause.json`, appends one line to `pauses.jsonl` with how long it lasted, and the paused time counts against no deadline or counter
- [ ] A stop while paused stops the night; a paused night creates no sandbox
- [ ] A pause not ended within 3 days stops the night with `stop.json` `reason` `failed`; `CODECLIMB_PAUSE_TIMEOUT_S`, set in `.env`, reaches the Agent Server once `npm run server` runs again, and shortens it
- [ ] With `CODECLIMB_MOCK_CREDIT` (read by the `run-night` that starts the night, from its shell or `.env`) set to `coder:<n>`, `reviewer:<n>` and `program:<n>`, once each on a mock night: call `n` of that kind fails once with a 402, the night pauses with `pause.json` naming the stop; after `run-night resume` it finishes with `done.json`, no `pause.json`, one line in `pauses.jsonl`, every `eval_id` once and no `cc-<id>` container
- [ ] A mock night with `CODECLIMB_MOCK_CREDIT` and `CODECLIMB_PAUSE_TIMEOUT_S` of a few seconds stops on the pause timeout with no sandbox left
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
