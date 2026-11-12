# 19: Check, leak scan and guardrails

**What to build:** Between the coder's commit and the evaluation, the experiment runs the scenario's `check` on the commit's files and `scan` on the lines the commit adds. `check` errors block the evaluation; two or more held-out names in the added lines block a keep; notes and a single found name go to the reviewer. The result is saved as `exps/<exp>/check.json`.

**Spec sections:**
- "Experiment lifecycle" > "Round loop": step 5, and the skip conditions of step 6
- "Scenario contract" > "How a scenario is loaded": the `check` and `scan` rows (the shape of `check.json`)
- "Decision and calibration" > "Keep rule": the held-out-name guardrail and the `not scored` outcome
- "Reviewer": repository-check notes and guardrails in what it reads
- "Open points for the build": the failing `scan` in the check step

**Not yet:** repairing a commit with `check` errors (ticket 27): until then such a round ends as `error`.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] `check` runs on a temporary checkout of the commit; `scan` runs on the lines the commit adds over the commit its sandbox started from
- [ ] Both are skipped with no commit and when the commit's files equal the checkpoint's
- [ ] `check.json` holds `errors`, `notes`, `held_out_names` (the count of distinct names) and `failed` when the command itself failed; it is written when the scenario has `check` or `scan`
- [ ] `check` errors, or a `check` command that itself fails, skip the evaluation; the row is `error` with reason `not scored` and the masked errors reach the next coder's `<failures>`
- [ ] 2 or more distinct held-out names give `revert` with `blocked: …`; exactly 1 is a note to the reviewer and blocks nothing
- [ ] The step runs on the host inside the experiment, before the evaluator's sandbox exists
- [ ] Tests drive the step with temporary scenarios whose `check` and `scan` report errors, notes and names; `datenorm-smoke --mock` still prints `done`
- [ ] `npm run typecheck` and `npm test` pass
