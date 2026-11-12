# 29: Pause for credits and resume

**What to build:** Running out of credits pauses a night instead of failing it. The experiment, evaluation or review that hit the credit error returns a credit stop; the night writes `pause.json` and waits in an interrupt with no sandbox running. `npm run run-night -- resume --night <id>` ends the pause and only what stopped reruns.

**Spec sections:**
- "Experiment lifecycle" > "Pause for credits": all of it
- "Experiment lifecycle" > "Ids": the `-resume<n>` identities
- "Interfaces" > "Control operations": the `resume` row
- "Durable runtime on LangGraph": requirements row "Pause and resume"; "only the night interrupts"
- "Coder" > "End of an experiment": the `credits` stop and the `paused` state; "Crash and resume": after a pause for credits
- "Evaluator" > "Outcomes": a credit stop gives no score
- "Reviewer" > "Handling": a credit error pauses the night
- "CLI": `run-night resume` and its refusals; what following prints at a pause
- "CLI" > "Mock mode": `mock_credit`
- "Data and files" > "Files a night writes": `pause.json`, `pauses.jsonl`, `pausesApplied`, `variation`
- "Platform facts": the fact on `interrupt()` replay

**Not yet:** the real providers' credit signals reaching the proxy (ticket 42): here a program's credit stop comes from `mock_credit`. A lessons run never pauses (ticket 34). The pause timeout and the variation backstop (ticket 30).

**Blocked by:** 22 (Metered nights: mock nights 1 and 3 pass); 25 (Check table: mock nights 1 to 3 as one repeatable check); 26 (Stop operation and cleanup; mock night 4 passes); 27 (Crash resume; mock night 5 passes)

**Status:** ready-for-agent

- [ ] The credit test matches every phrase the spec lists and not a 429; it runs on every assistant message end and on a thrown error
- [ ] A coder commits its partial work and returns the stop, leaving `stop` and `paused` in `code-state.json` with no `finishedAt`; an evaluation ends its stage at the first credit call and reports no score; a review just stops
- [ ] The night writes `pause.json` in a step, then calls `interrupt()` in its own code between steps with `{ pause, at, stops }`; pause numbers run on across variations
- [ ] Resume reads the pause number from the thread's pending interrupt and creates a server run with `{ resume: { pause: n } }`; a resume with another number is answered with another interrupt
- [ ] `run-night resume` is refused for a night with a `stop.json` or a `done.json`, that is not paused, or whose pause was resumed already
- [ ] Ending a pause logs it to `pauses.jsonl` once, deletes `pause.json`, and adds the paused time to the deadline once (`pausesApplied`); running that step twice changes nothing more (unit test); a night stopped while paused stays stopped
- [ ] After a resume: the coder carries on in the same Pi session on a new sandbox built from a git bundle holding the paused commit and the round's parent, with its clock set once; the evaluation reruns from scratch under the same `eval_id` on a `-resume<n>` sandbox; the review runs again; rerun work uses new step names ending `-resume<n>`
- [ ] Stop works while paused
- [ ] Mock nights with `mock_credit` in the start input, once each for `coder`, `reviewer` and `program`: the night pauses, `pause.json` names the stop, following prints how to resume; after `run-night resume` it finishes with `done.json`, no `pause.json`, one entry in `pauses.jsonl`, every `eval_id` once, and no `cc-<id>` container
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
