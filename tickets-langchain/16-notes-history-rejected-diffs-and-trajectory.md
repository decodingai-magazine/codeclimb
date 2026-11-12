# 16: Notes, history, rejected diffs and trajectory

**What to build:** A night remembers its rounds. Each experiment leaves a note in the bundle's `history/`, each round that kept nothing and changed code leaves its diff there, and each round adds one masked history line to the night's state. The coder of round N reads a trajectory of rounds 1 to N−1 in its prompt and finds the notes and diffs under `/spec/history/`.

**Spec sections:**
- "Memory within and across nights" > "Notes, trajectory and rejected diffs"
- "Experiment lifecycle" > "Round loop": step 11, in its stated order
- "Coder" > "Prompt": the `<trajectory>` and `<failures>` rows
- "Every number in one place": the memory rows

**Not yet:** the reviewer's verdict in a note and the feedback in a trajectory (ticket 17): both parts are empty until then. The `<start>` note of a seeded night (ticket 36).

**Blocked by:** 03 (Host commands, placeholders and masking); 15 (Tracer night: `datenorm-smoke` on mock models)

**Status:** ready-for-agent

- [ ] A note is written per experiment at `history/notes/r<N>-e<n>.md` with the heading `## r<N>-e<n> · <decision>: <reason>` (reason cut to 300 characters) and the coder part, whether or not the round is kept
- [ ] The rejected diff `history/r<N>.diff` is written whole, against the checkpoint, for every round that kept nothing and changed code
- [ ] The history line has the form `- r<N>: <hypothesis> → <moves> (<decision>: <reason>)` with the moves the spec lists; it lives in the night's state, not in a file, and a replayed round adds it once
- [ ] Notes, diffs and history lines are masked with `scan` before they are written or stored
- [ ] The trajectory lists rounds oldest first with the latest marked, within 48,000 characters; past the budget the oldest rounds lose their feedback, then their coder parts, then everything but the history line; the latest round stays whole
- [ ] The next round's coder gets the trajectory and the rejected diffs' paths in its prompt, and the masked failures of an experiment that was never scored
- [ ] The learn step runs in the spec's order
- [ ] Unit tests cover the note, the history line and the trajectory budget
- [ ] On `datenorm-smoke --mock`: `bundle/history/notes/r<round>-e<n>.md` exists per experiment with a `mock note` coder part; round 2 keeps nothing, so `bundle/history/r2.diff` exists
- [ ] `npm run typecheck` and `npm test` pass
