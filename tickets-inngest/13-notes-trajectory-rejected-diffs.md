# 13: Notes, trajectory and rejected diffs: memory within a night

**What to build:** Each experiment leaves a note in the bundle's `history/`, each round a masked history line in the parent's state, and each round that kept nothing but changed code a rejected diff. Round N's coder and reviewer read the trajectory of rounds 1 to N−1 within a character budget. Everything a coder reads from the evaluation side is masked with `scan` first.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Memory within and across nights", "Notes, trajectory and rejected diffs", "Round loop", "Prompt", "Components"

**Blocked by:** 12 (Reviewer: feedback, hypothesis and verdict every round)

**Status:** ready-for-agent

- [ ] The note file `history/notes/r<N>-e<n>.md` has the heading, the coder part and the reviewer part as specified, is masked before it is written, and is kept whether or not the round is kept
- [ ] The history line has the form `- r<N>: <hypothesis> → <moves> (<decision>: <reason>)` with the moves and reason rules, the error reason cut to its last 300 characters (unit tests)
- [ ] The log and the history live in the parent's state and are not files; the masked lines travel to the coder in the child's input; the reviewer's lines are built from the log, unmasked; a step retry can't append an entry twice
- [ ] `history/r<N>.diff` is saved whole against the checkpoint for every round that kept nothing and changed code
- [ ] The trajectory lists rounds oldest first with the latest marked; past 48,000 characters the oldest rounds lose feedback, then coder parts, then everything but the history line, and the latest round stays whole (unit tests)
- [ ] The "Learn" order of "Round loop" step 11 is implemented in that order
- [ ] The coder's `<trajectory>` section names the rejected diffs' paths under `/spec/history/`; the reviewer reads the trajectory too
- [ ] End-to-end, mock, dev server: after `datenorm-smoke --mock`, `bundle/history/notes/r1-e0.md` and `r2-e0.md` exist, each with a `mock note` coder part and a `mock verdict` reviewer part, and round 2's coder session prompt contains round 1's history line
