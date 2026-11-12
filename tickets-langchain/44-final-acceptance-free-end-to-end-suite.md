# 44: Final acceptance: the free end-to-end suite and the fixed contracts

**What to build:** The done signal. On a fresh `npm run server`, with `LANGSMITH_TRACING=false`, the seven mock nights of the spec run one after the other and each passes every check the spec lists for it. Anything that fails is fixed in the code that owns it, and the whole suite is run again from night 1. Then the fixed external contracts, the constants and the known gaps are audited. No new feature is built.

**Spec sections:**
- "Goal and done signal": the seven nights, the check table for nights 1, 2, 3 and 6, and the table for nights 3 to 7
- "Durable runtime on LangGraph" > "Cleanup": a stopped or failed night always ends with a `stop.json`
- "Open points for the build": night 5's timing margin
- "Known gaps": one night per server; the relay test of `npm test` and a running night; the requirements it lists as part of this spec and the items it lists as kept
- "What you get, what you build": the fixed npm scripts, the dependency table, the given inputs
- "Every number in one place": all of it

**Not yet:** night 8 (real models, paid) is ticket 45: it needs the operator's go-ahead for that run. No check here makes a paid call.

**Blocked by:** 01 (Scaffold and Agent Server boot); 02 (Scenario and night config loading); 03 (Host commands, placeholders and masking); 04 (Stage reports and standard metrics); 05 (Weighted score, keep rule, noise margin and stop checks); 06 (Result rows and `validate-results`); 07 (Experiment repository); 08 (Sandbox interface and Docker backend); 09 (Step wrapper, abort signal and live registry); 10 (Pi sessions: mock models and sandbox tools); 11 (Coder prompt); 12 (Coder experiment: code step and commit); 13 (Evaluator, unmetered); 14 (Threads and the start operation); 15 (Tracer night: `datenorm-smoke` on mock models); 16 (Notes, history, rejected diffs and trajectory); 17 (Reviewer); 18 (Send-backs, reserve and wrap-up); 19 (Check, leak scan and guardrails); 20 (Metering proxy: ledgers, routes, refusals, replay); 21 (Relay and path to the proxy); 22 (Metered nights: mock nights 1 and 3 pass); 23 (Noise run; mock night 2 passes in full); 24 (Model checks, every soft stop, smoke test and outage); 25 (Check table: mock nights 1 to 3 as one repeatable check); 26 (Stop operation and cleanup; mock night 4 passes); 27 (Crash resume; mock night 5 passes); 28 (Lost connection mid-turn; mock night 6 passes); 29 (Pause for credits and resume); 30 (Pause timeout and variation backstop); 31 (Repair); 32 (Continue); 33 (Lessons file, operations and gates); 34 (Lessons distillation: graph, trigger and CLI); 35 (Graphrag mock night; mock night 7 passes); 36 (Seed and rescore); 37 (Worker API); 38 (Watchdog); 39 (Export); 40 (App); 41 (Tracing and feedback); 42 (Proxy backends: OpenRouter and Pi); 43 (Real-model coder sessions and the web research guard)

**Status:** ready-for-agent

- [ ] `npm ci --ignore-scripts`, `npm run typecheck` and `npm test` pass on a clean checkout, with no night running during `npm test`
- [ ] Night 1, `capitals-smoke --mock`: every row of the check table holds
- [ ] Night 2, `datenorm-smoke --mock`: every row of the check table holds; it ends on `max_rounds` after exactly 2 rounds
- [ ] Night 3, `configs/e2e/plateau.yaml --mock`: `done` with `stop_reason` `plateau`, `rounds: 1`, a `test` row, no container
- [ ] Night 4, night 2 with `--no-wait` then `run-night stop` while round 1 runs: `stopped`, `stop.json` with `reason: manual`, no `done.json`, no `test` row, no container
- [ ] Night 5, night 2 with `--no-wait`, the server container killed once `exps/<id>-r2-e0/` exists, then `npm run server`: the night finishes by itself; every `eval_id` once; round 1's `code-state.json` unchanged; no `cc-<id>-r1-` sandbox created after the kill
- [ ] Night 6, `datenorm-smoke --mock --mock-offline 6`: every row of the check table, plus the error message followed by clean ones in round 1's session
- [ ] Night 7, `npm run build:image:graphrag` then `graphrag-smoke --mock`: every check of its row, the lessons proposal within a minute of `done` included
- [ ] After the suite `docker ps` shows no `cc-` sandbox container, and no night under `runs-langchain/mock/` is left without a `done.json` or a `stop.json`
- [ ] `npm run build:app` succeeds
- [ ] Every constant in "Every number in one place" is traced to one place in the code and matches; mismatches are fixed
- [ ] The four requirements "Known gaps" lists as part of this spec are present and tested: mock nights found under `runs-langchain/mock/`, the failure path's `stop.json` without `night.json`, the Linux bridge address, the retry-safe pause end. The three items it lists as kept are unchanged
- [ ] LangGraph appears only in the graph definitions, the step wrapper and the control operations; step bodies are framework-free
- [ ] A grep over the source finds the literal strings `You stopped with` and `change no more code` in exactly one message builder each
- [ ] `scenarios/`, `configs/` and the two Dockerfiles are byte-identical to what the environment supplied
- [ ] The fixed npm scripts all exist and do their job (none is still a placeholder): `server`, `server:logs`, `server:stop`, `api`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:dataset:hard`, `export`, `lessons`, `dev`, `build:app`, `typecheck`, `test`
