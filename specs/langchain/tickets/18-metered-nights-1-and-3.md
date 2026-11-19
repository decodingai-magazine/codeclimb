# 18: Metered nights: nights 1 and 3 pass

**What to build:** A night with `allowed_models` is metered. Its sandboxes hold no provider key; a program reaches a model only through the proxy, with the base URL and a token in its environment. The path from sandbox to proxy is checked before it is used, so a broken path is an outage and never a score. A coder has its own dev ledger capped by the experiment's budget; an evaluation's ledger is the source of its cost metrics. `capitals-smoke --mock` (night 1) and `e2e/plateau.yaml --mock` (night 3) pass.

**Spec sections:**
- "Goal and done signal": nights 1 and 3, C1 to C14 and night 3's added checks
- "Features": **Metering**; **Evaluator** (cost and call counts from the proxy's ledger); **Coder** (ends on its budget cap)
- "Interfaces the build must honour" > "Metering proxy": the program side bullet
- "Interfaces the build must honour" > "Files a night writes": `meter-dev.jsonl`, `meter.jsonl`
- "Interfaces the build must honour" > "Night config": `allowed_models` ("empty = unmetered"), `budget_usd`
- "Interfaces the build must honour" > "Result row": `coder_usd`, `dev_usd`, `program_usd`

**Not yet:** the smoke test's use of the path check (ticket 20); real upstreams (ticket 40).

**Blocked by:** 14 (Reviewer); 15 (Send-backs, reserve and wrap-up); 17 (Metering proxy)

**Status:** ready-for-agent

- [ ] On a metered night, every sandbox that may call a model has `OPENAI_BASE_URL` and `OPENAI_API_KEY`, and the same values as `CODECLIMB_LLM_BASE_URL` and `CODECLIMB_LLM_API_KEY`; the base URL ends in `/v1` and is reachable from the sandbox; no provider key is in the sandbox
- [ ] Before a sandbox's first metered call, the path from it to the proxy is checked; a broken path fails the step as an infrastructure failure, never as a score
- [ ] An unmetered night (`allowed_models: []`) gives its sandboxes no proxy token and writes no ledger
- [ ] The coder's dev ledger is `exps/<exp>/meter-dev.jsonl`, capped by `budget_usd.experiment` less the coder's own spend; the coder's experiment ends on its budget cap; the reserve of ticket 15 counts the budget too
- [ ] Each evaluation's ledger is `evals/<eval>/meter.jsonl`; its cost and call metrics are in `metrics.json` and the row; `program_usd`, `coder_usd` and `dev_usd` are on the row
- [ ] Night 1, `capitals-smoke --mock`: C1 to C14 hold; `evals/*/meter.jsonl` lists the program's calls, none with `error`; it scores 0 and keeps nothing
- [ ] Night 3, `e2e/plateau.yaml --mock`: C1 to C14 hold; `run-night` prints `done` with `stop_reason` `plateau`; `done.json` has `rounds: 1`; a `test` row exists; no `cc-<id>` container is left
- [ ] `npm run typecheck` and `npm test` pass
