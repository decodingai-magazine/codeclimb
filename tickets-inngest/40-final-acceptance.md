# 40: Final acceptance: the free end-to-end suite and the fixed contracts

**What to build:** The done signal. With a freshly started dev server and worker, the seven mock nights of the spec run one after the other and each passes every check the spec lists for it. Anything that fails is fixed in the code that owns it, and the whole suite is run again from night 1. Then the fixed external contracts, the constants and the known gaps are audited. No new feature is built. Night 8 (real models, paid) is ticket 41: it needs the operator's go-ahead for that run.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "What you get, what you build", "Cleanup", "Every number in one place", "Known gaps", "Suggested build order"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes); 22 (Crash and resume: a retried coder or evaluator step picks up its work; mock night 5 passes); 23 (Lost connection mid-turn; mock night 6 passes); 24 (Pause for credits and resume); 25 (Repair: one fix attempt for a commit that failed before scoring); 26 (Continue: more rounds on an ended night, with an operator's direction); 27 (Lessons file: format, operations and gates); 28 (Lessons distillation: what a night learned reaches the next night); 29 (Multi-stage mock night: graphrag-smoke, mock night 7, passes its checks); 30 (Seed: a new night that starts from an ended night's kept commit); 31 (Rescore: a kept commit is scored again when the scoring changed); 32 (Worker API: read nights, stop, resume, continue); 33 (Export: a kept commit as files, as a git repository, or pushed to a remote); 34 (App: scaffold, worker-API route, Nights list, Inngest scaffold); 35 (App: the Night page with status, controls, tiles and the live experiment); 36 (App: metric tables, convergence chart, heatmap, experiment detail and export); 37 (Tracing and the scores mirror); 38 (Proxy backends: OpenRouter and Pi); 39 (Web research for the coder, behind the guard)

**Status:** ready-for-agent

- [ ] `npm ci --ignore-scripts`, `npm run typecheck`, `npm test` and `npm run build` pass on a fresh checkout
- [ ] Night 1, `capitals-smoke --mock`: every row of the first table holds
- [ ] Night 2, `datenorm-smoke --mock`: every row of the first table holds; it ends on `max_rounds` after exactly 2 rounds
- [ ] Night 3, `configs/e2e/plateau.yaml --mock`: every row of the first table that is not named for another config, with `stop_reason` `plateau`; `rounds: 1`, a `test` row, no container
- [ ] Night 4, night 2 with `--no-wait` then `run-night stop` once `exps/<id>-r1-e0/` exists: within 30 s of the stop, `stop.json` with `reason: manual`, no `done.json`, no `test` row, no container; a `run-night` that follows the night prints `stopped`
- [ ] Night 5, night 2 with `--no-wait`, the worker killed once `exps/<id>-r2-e0/` exists, then `npm run worker` (run again if the night finished before the kill): the night finishes by itself; every `eval_id` once; round 1's `code-state.json` unchanged; no `cc-<id>-r1-` sandbox created after the kill
- [ ] Night 6, `datenorm-smoke --mock --mock-offline 6`: every row of the first table, plus the error message followed by clean ones in round 1's session
- [ ] Night 7, `npm run build:image:graphrag` then `graphrag-smoke --mock`: every check the spec lists for it (ticket 29), the lessons files within a minute of `done` included
- [ ] After the suite `docker ps` shows no `cc-<id>` sandbox container, and no night under `runs/mock/` is left without a `done.json` or a `stop.json`
- [ ] Every npm script the spec fixes does its job (none is still a placeholder); `package.json` holds the spec's dependencies at their exact versions, and every unlisted package is pinned exactly and listed in the report
- [ ] Every constant in "Every number in one place" is traced to one place in the code and matches; mismatches are fixed
- [ ] The four items "Known gaps" lists as asked beyond the reference are present and tested: mock nights found under `runs/mock/`, the failure handler's `stop.json` without `night.json`, the Docker bridge address on Linux, the retry-safe pause end. The four items it lists as kept are unchanged
- [ ] The Inngest SDK appears only in function definitions, the worker's connection and where events are sent; step bodies are framework-free
- [ ] A grep over the source finds the literal strings `You stopped with` and `change no more code` in exactly one message builder each
- [ ] `scenarios/`, `configs/` and the given image definitions are byte-identical to what the environment supplied
- [ ] No check here makes a paid call
