# 13: Notes, history, rejected diffs and the trajectory

**What to build:** What a night learns stays with it. Each experiment gets a note (the coder's notes, later the reviewer's verdict), each round a history line, and each round that kept nothing its whole diff. They are masked and written into the bundle's `history/`, where every later coder finds them under `/spec/history/`. The coder of a round reads the trajectory of all earlier rounds, cut from the oldest end when it outgrows its budget.

**Spec sections:**
- "Features": **Notes, history, rejected diffs**
- "Interfaces the build must honour" > "Files a night writes": `bundle/` (`history/notes/r<N>-e<n>.md`, `history/r<N>.diff`); the note format
- "Architecture": isolation invariants ("only train reaches a coder"; "nothing from test reaches a coder"; scanned before a coder reads it)
- "Goal and done signal": C9 (the coder part)

**Not yet:** the reviewer part of a note (ticket 14); the repair's note rule (ticket 27).

**Blocked by:** 12 (Tracer night: `datenorm-smoke` on mock models)

**Status:** ready-for-agent

- [ ] After each experiment, `bundle/history/notes/r<N>-e<n>.md` holds the heading `## r<N>-e<n> · <decision>: <reason>` and a `### Coder, before the evaluation` part from the coder's `/tmp/notes.md`
- [ ] Each round adds one history line; each round that kept nothing writes its whole diff to `bundle/history/r<N>.diff`
- [ ] Everything written to `history/` is masked with the scenario's scan first; nothing from a test evaluation is ever written there
- [ ] The next coder's sandbox has the notes, the history and the rejected diffs under `/spec/history/`
- [ ] The coder's prompt holds the trajectory of every earlier round; when it outgrows its budget the oldest rounds are cut first (unit test)
- [ ] On `datenorm-smoke --mock`: a note per experiment with a `mock note` coder part, and round 2's coder sandbox holds round 1's note
- [ ] `npm run typecheck` and `npm test` pass
