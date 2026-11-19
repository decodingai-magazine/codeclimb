# 39: Final acceptance: the seven mock nights and the fixed contracts

**What to build:** The done signal. On a freshly started dev server and worker, the seven nights of "Goal and done signal" run one after the other, each under a fresh night id, and each passes every check listed for it. Anything that fails is fixed in the code that owns it, and the suite runs again from night 1. Then the fixed contracts and the numbers are audited. No new feature is built and no paid call is made.

**Spec sections** (`specs/inngest/spec.md`): "Goal and done signal", "Architecture", "Interfaces the build must honour", "Numbers", "Dependencies"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes); 22 (Crash recovery: the night carries on after a worker kill; mock night 5 passes); 23 (Lost connection mid-turn; mock night 6 passes); 24 (Pause for credits and resume); 25 (Repair: one fix attempt for a commit that failed before scoring); 26 (Continue: more rounds on an ended night, with an operator's direction); 27 (Lessons file: operations, gates and format); 28 (Lessons distillation: what a night learned reaches the next night); 29 (Multi-stage mock night: graphrag-smoke, mock night 7, passes its checks); 30 (Seed: a new night that starts from an ended night's kept commit); 31 (Rescore: a kept commit is scored again when the scoring changed); 32 (Worker API: read nights, stop, resume, continue); 33 (Export: a kept commit as files, as a git repository, or pushed to a remote); 34 (App: the nights list and a live night with its controls); 35 (App: metrics per stage, convergence chart, experiment diffs and export); 36 (Tracing and the scores mirror); 37 (Proxy backends: OpenRouter and Pi's model layer); 38 (Web research for the coder, behind the guard)

**Status:** ready-for-agent

- [ ] On a fresh checkout `npm ci --ignore-scripts`, `npm run typecheck`, `npm test` and `npm run build` pass, within the times of "Numbers"; `npm test` needs no service up
- [ ] The preconditions of "Goal and done signal" hold before night 1: Docker runs, both images are built, `uv` is on the path, the worker runs the code under test, `docker ps` shows no `cc-` container
- [ ] Nights 1, 2, 3 and 6 pass C1 to C14 and their added checks
- [ ] Night 4 passes its added checks, with its first `run-night` left following
- [ ] Night 5 passes its added checks, the night's `done.json` within 480 s of the restarted worker answering
- [ ] Night 7 passes every check the spec lists for it
- [ ] After the suite no `cc-` container is left, and every night under `runs-inngest/mock/` has a `done.json` or a `stop.json`
- [ ] Every npm script of "Given inputs and tools" does its job; none is still a placeholder; every package of "Dependencies" is at its exact version, and every package outside the table is pinned exactly and named in the report
- [ ] Every row of "Numbers" is traced to one place in the code and matches
- [ ] The isolation invariants of "Architecture" hold: no gold, evaluator or provider key in any sandbox of the suite's nights; no test data in any coder's, reviewer's or lesson's input; decisions read evaluation metrics only
- [ ] The literal strings "You stopped with" and "change no more code" each appear in exactly one message builder
- [ ] `scenarios/`, `configs/`, `docker/` and `.env.example` are byte-identical to what the checkout was given
