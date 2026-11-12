# 43: Free end-to-end suite

**What to build:** The done signal. On a fresh `npm run server`, with `LANGSMITH_TRACING=false`, the seven mock nights of the spec run one after the other and each passes every check the spec lists for it. Anything that fails is fixed in the code that owns it, and the whole suite is run again from night 1.

**Spec sections:**
- "Goal and done signal": the seven nights, the check table for nights 1, 2 and 6, and the table for nights 3 to 7
- "Durable runtime on LangGraph" > "Cleanup": a stopped or failed night always ends with a `stop.json`
- "Open points for the build": night 5's timing margin
- "Known gaps": one night per server; the relay test of `npm test` and a running night

**Not yet:** nights 8 to 11 (real models, paid) are not run: each needs the operator's go-ahead for that run.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42

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
- [ ] The fixed npm scripts all exist: `server`, `server:logs`, `server:stop`, `api`, `run-night`, `validate-results`, `build:image`, `build:image:graphrag`, `build:dataset`, `build:dataset:hard`, `build:scenario:overfit`, `export`, `lessons`, `dev`, `build:app`, `typecheck`, `test`
