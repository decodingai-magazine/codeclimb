# 20: Check table: mock nights 1 to 3 as one repeatable check

**What to build:** The gate. Nights 1 to 3 of "Goal and done signal" run one after the other, each under a fresh night id, and pass every common check (C1 to C14) and night 3's added checks. The check is repeatable, so every later ticket that touches the loop runs it again.

**Spec sections** (`specs/inngest/spec.md`): "Goal and done signal", "Numbers"

**Blocked by:** 13 (Notes, trajectory and rejected diffs: memory within a night); 14 (Send-backs, reserve and wrap-up); 18 (Noise run: the A/A evaluation and the measured margin; mock night 2 passes); 19 (Every soft stop, the model check and the smoke test; mock night 3 passes)

**Status:** ready-for-agent

- [ ] A documented, repeatable check, whose preconditions and checks are the ones "Goal and done signal" and `E2E.md` state, runs nights 1, 2 and 3 on the dev server with Docker sandboxes and mock models, and fails naming the check that does not hold
- [ ] Nights 1 and 2 pass C1 to C14; night 2 ends on `max_rounds` after exactly 2 rounds
- [ ] Night 3 passes C1 to C14 with `stop_reason` `plateau`, `done.json` with `rounds: 1`, a `test` row and no `cc-<id>` container, running or stopped
- [ ] Each night prints `done` within 300 s of its start and reaches round 1 within 120 s
- [ ] The check passes twice in a row, with fresh night ids and the shared `experiments.git` and `results.jsonl`
- [ ] `npm run typecheck` and `npm test` pass
