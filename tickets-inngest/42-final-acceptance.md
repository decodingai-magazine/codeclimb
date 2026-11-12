# 42: Final acceptance: the whole spec, checked once more

**What to build:** With every feature in, run the done-signal check again and audit the fixed external contracts, the constants and the known gaps. Anything that drifted while later tickets landed is fixed here. No new feature is built.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Goal and done signal", "What you get, what you build", "Every number in one place", "Known gaps", "Suggested build order"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json); 22 (Crash and resume: a retried coder or evaluator step picks up its work); 23 (Pause for credits and resume); 24 (Repair: one fix attempt for a commit that failed before scoring); 25 (Continue: more rounds on an ended night, with an operator's direction); 26 (Lessons file: format, operations and gates); 27 (Lessons distillation: what a night learned reaches the next night); 28 (Multi-stage mock night: graphrag-smoke passes its checks); 29 (Seed: a new night that starts from an ended night's kept commit); 30 (Rescore: a kept commit is scored again when the scoring changed); 31 (Worker API: read nights, stop, resume, continue); 32 (Export: a kept commit as files, as a git repository, or pushed to a remote); 33 (App: scaffold, worker-API route, Nights list, Inngest scaffold); 34 (App: the Night page with status, controls, tiles and the live experiment); 35 (App: metric tables, convergence chart, heatmap, experiment detail and export); 36 (Tracing and the scores mirror); 37 (Proxy backends: OpenRouter and Pi); 38 (Web research for the coder, behind the guard); 39 (Cloud mode: the worker and the CLI against Inngest Cloud); 40 (Inngest Sandboxes backend); 41 (Public proxy path for Inngest Sandboxes: tunnels and the reachability probe)

**Status:** ready-for-agent

- [ ] `npm ci --ignore-scripts`, `npm run typecheck`, `npm test` and `npm run build` pass on a fresh checkout
- [ ] The done-signal check passes on all three mock nights, one after the other: `capitals-smoke` and `datenorm-smoke` on every row of the first table (ticket 20), `graphrag-smoke` on every check of ticket 28
- [ ] Every npm script the spec fixes does its job (none is still a placeholder); `package.json` holds the spec's dependencies at their exact versions, and every unlisted package is pinned exactly and listed in the report
- [ ] Every constant in "Every number in one place" is traced to one place in the code and matches; mismatches are fixed
- [ ] The four items "Known gaps" lists as asked beyond the reference are present and tested: mock nights found under `runs/mock/`, the failure handler's `stop.json` without `night.json`, the Docker bridge address on Linux, the retry-safe pause end. The four items it lists as kept are unchanged
- [ ] The Inngest SDK appears only in function definitions, the Inngest sandbox backend, the worker's connection and where events are sent; step bodies are framework-free
- [ ] A grep over the source finds the literal strings `You stopped with` and `change no more code` in exactly one message builder each
- [ ] `scenarios/`, `configs/` and the given image definitions are byte-identical to what the environment supplied
- [ ] No check here contacts Inngest Cloud or makes a paid call: the cloud nights are ticket 43 and are reported as not run until the operator gives the go-ahead
