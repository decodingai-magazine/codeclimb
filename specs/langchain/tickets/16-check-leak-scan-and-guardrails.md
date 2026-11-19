# 16: Check, leak scan and guardrails

**What to build:** After the coder commits, the scenario's `check` reads the commit on the host and its `scan` reads the diff's added lines for held-out names. Check errors block the evaluation and the experiment is `not scored`; two or more held-out names in the added lines block the keep. `check.json` records both.

**Spec sections:**
- "Architecture": the data flow of an experiment ("The scenario's check and leak scan then run on the host")
- "Features": **Keep rule** (the guardrails)
- "Interfaces the build must honour" > "Scenario contract": `check`, `scan`
- "Interfaces the build must honour" > "Decisions": the check-errors and guardrail rows
- "Interfaces the build must honour" > "Files a night writes": `check.json` (`errors`, `notes`, `held_out_names`, `failed`)
- "Numbers": held-out names in a diff that block a keep

**Not yet:** the repair of a commit that failed its check (ticket 27).

**Blocked by:** 12 (Tracer night: `datenorm-smoke` on mock models)

**Status:** ready-for-agent

- [ ] For a scenario with `check`, each experiment's commit is checked on the host after the coder's sandbox is gone; `exps/<exp>/check.json` holds `errors`, `notes`, `held_out_names` and `failed`
- [ ] Check errors skip the evaluation; the row is `error`, `not scored`, with the primary metric at 0 and nothing else
- [ ] For a scenario with `scan`, the diff's added lines are scanned; two or more held-out names make the experiment `revert` with `blocked: <guardrails>`, even when its score would keep it
- [ ] A gate whose metric is missing or above its cap blocks the keep the same way
- [ ] With a temporary copy of `datenorm` that declares a failing `check` (outside `scenarios/`), a mock night records `not scored` rows and a valid `check.json`; with one whose `scan` reports two names for the mock diff, round 1 is `blocked`
- [ ] `datenorm-smoke --mock` still passes the checks of ticket 12
- [ ] `npm run typecheck` and `npm test` pass
