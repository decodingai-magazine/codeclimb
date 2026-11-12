# 17: Reviewer

**What to build:** Every round ends with a review: a Pi session with no tools reads the experiment, the checkpoint and the evidence, and writes `feedback`, `hypothesis` and `verdict`. The next round's coder gets the feedback in its trajectory and the hypothesis as the one to test; the verdict completes the experiment's note. A failed review never kills the night.

**Spec sections:**
- "Reviewer": all of it (what it reads, the evidence caps table, what it writes, the system prompt's rules, "Handling")
- "Experiment lifecycle" > "Round loop": steps 9 and 10, and the paragraph on the hypothesis a round tests
- "Evaluator" > "Standard metrics": which metrics the reviewer is told, and `min_efficiency_gain`
- "CLI" > "Mock mode": the reviewer's scripted reply
- "Data and files": `reviews/r<N>.json`, `r<N>.prompt.md`; the row fields `reviewer_usd` and `t_review`
- "Every number in one place": the reviewer rows

**Not yet:** the A/A pair in the prompt (ticket 23 supplies it); repository-check notes (ticket 19); a credit error pausing the night (ticket 29).

**Blocked by:** 16 (Notes, history, rejected diffs and trajectory)

**Status:** ready-for-agent

- [ ] The session is in memory, has no tools, runs on `reviewer_model` with `reviewer_thinking` and its own system prompt carrying the spec's rules
- [ ] The prompt holds what the spec lists, with the metric selection rule (thresholds, gates and headlines always; the rest as diagnostics, or every scorer metric without headlines)
- [ ] Each evidence cap behaves as its table row says: per-item errors, the run log (dropped lines, flagged lines first, whole lines), the diff, the checkpoint source, the unchanged stages by output hash
- [ ] An `unchanged` experiment is reviewed with the checkpoint's scores, the note that nothing was tested and the coder's closing message
- [ ] The reply is read from its first opening brace to its last closing brace; `feedback` must be a string and `hypothesis` non-empty; a missing `verdict` is allowed; one retry asking for JSON only, then the review fails
- [ ] The three fields go through `scan`; a find triggers one rewrite request; what survives is masked
- [ ] `reviews/r<N>.prompt.md` is written before the call and `reviews/r<N>.json` after, with the keys the spec lists
- [ ] A failed review keeps the last feedback and hypothesis, leaves the verdict empty, and the night goes on
- [ ] The round's row carries the review's cost and time; the review runs in the last round and for a reverted experiment too
- [ ] The note gets its `### Reviewer, after the evaluation` part; the trajectory reads feedback from the review files
- [ ] Unit tests cover the caps, the reply parsing and the leak loop
- [ ] On `datenorm-smoke --mock`: `reviews/r<n>.json` exists for every round with `feedback: mock feedback`; each note has a `mock verdict` reviewer part; round 2's commit message carries `mock hypothesis`
- [ ] `npm run typecheck` and `npm test` pass
