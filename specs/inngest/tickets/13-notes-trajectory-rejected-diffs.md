# 13: Notes, trajectory and rejected diffs: memory within a night

**What to build:** Each later coder and reviewer reads what earlier rounds tried and why they lost. Every experiment leaves a note (the coder's part, then the reviewer's verdict), every round a history line, every round that kept nothing its diff. They are masked for held-out names and travel in the bundle, within a size budget that drops the oldest detail first.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Notes, trajectory and rejected diffs; Loop), "Architecture", "Files a night writes"

**Blocked by:** 12 (Reviewer: feedback, hypothesis and verdict every round)

**Status:** ready-for-agent

- [ ] Every experiment leaves `bundle/history/notes/r<N>-e<n>.md`: the coder's part from its `/tmp/notes.md`, then the reviewer's verdict once the round is reviewed; the note is kept whether or not the round kept anything
- [ ] Every round adds a history line to the night so far, after the review, as the round order of "Architecture" places it
- [ ] Every round that kept nothing saves its diff as `bundle/history/r<N>.diff`
- [ ] Notes, history lines and diffs are masked for held-out names with the scenario's `scan` before they are written (unit test with a fake scan)
- [ ] The next coder finds them under `/spec/history/`; the reviewer reads the night so far too
- [ ] Past the size budget, whose value the build chooses, the oldest detail is dropped first (unit tests)
- [ ] With the dev server and the worker up, after `datenorm-smoke --mock`: `bundle/history/notes/r1-e0.md` and `r2-e0.md` exist, each with a `mock note` coder part and a `mock verdict` reviewer part (C9), and round 2's coder prompt holds round 1's history line
