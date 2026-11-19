# 21: Gate: nights 1 to 3 as one repeatable check

**What to build:** Nights 1, 2 and 3 of the done signal as one repeatable check: one command runs them one after the other on the running Agent Server, each with a fresh night id, and asserts every check the spec lists for them, C1 to C14 and night 3's added checks, failing with the check's name. Every later ticket that touches the loop reruns it. Nothing after this ticket starts until it passes.

**Spec sections:**
- "Goal and done signal": the preconditions, nights 1 to 3, C1 to C14, night 3's added checks
- "Numbers": the done signal rows that apply to nights 1 to 3

**Not yet:** nights 4 to 7 (tickets 22, 24, 25, 31); the full suite (ticket 42).

**Blocked by:** 16 (Check, leak scan and guardrails); 19 (Noise run: night 2 passes); 20 (Model checks, smoke test, outage and every soft stop)

**Status:** ready-for-agent

- [ ] The check refuses to start unless its preconditions hold: Docker running, `codeclimb-python` built, `/ok` answering, no `cc-` container present
- [ ] It runs `npm run run-night -- --config configs/capitals-smoke.yaml --mock`, then `configs/datenorm-smoke.yaml`, then `configs/e2e/plateau.yaml`, each with a fresh `--night-id`, each starting as soon as the previous `run-night` exits
- [ ] For each night it asserts C1 to C14 against that night's files, and for night 3 `stop_reason` `plateau`, `rounds: 1`, a `test` row and no `cc-<id>` container
- [ ] Each night finishes within 300 s from `run-night` to its exit, and `validate-results` within 300 s
- [ ] It passes with a `.env` holding only `LANGSMITH_API_KEY`, `LANGSMITH_ENDPOINT` and `LANGSMITH_TRACING=false`, and leaves no `cc-` container behind
- [ ] It is not part of `npm test`, which runs with no Agent Server
- [ ] The check passes twice in a row on the same server
- [ ] `npm run typecheck` and `npm test` pass
