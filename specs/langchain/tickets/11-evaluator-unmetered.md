# 11: Evaluator, unmetered

**What to build:** One evaluation of a commit on its own sandbox, never the coder's: it sets up the commit's Python environment, then per stage in order writes the inputs on the host, uploads the stage's files, runs the program under `eval_min`, saves the run log, downloads the outputs and scores them on the host. The result is the evaluation's files and metrics, or an outcome with `ok: false` that says why.

**Spec sections:**
- "Features": **Evaluator**
- "Architecture": the data flow of an evaluation; isolation invariants on gold and on what reaches a coder
- "Interfaces the build must honour" > "Scenario contract": the stage field table; `{split}`; the sandbox paths of a stage; "Each stage adds `output_bytes`"
- "Interfaces the build must honour" > "Files a night writes": the `evals/<eval>/` row
- "Interfaces the build must honour" > "Ids": dev, noise and test evaluation ids; evaluation sandbox names

**Not yet:** metering and the cost metrics (ticket 18); the per-item `details` going to the reviewer (ticket 14); credit stops (ticket 26).

**Blocked by:** 03 (Host commands, the bundle and masking); 04 (Stage reports and standard metrics); 07 (Experiment repository); 08 (Sandboxes on Docker)

**Status:** ready-for-agent

- [ ] The evaluation's sandbox is `cc-<night>-r<N>-<kind>` for round N, or `cc-<night>-test-r<N>` for the test evaluation, and holds the commit in `/repo`; it is removed when the evaluation ends
- [ ] A `uv.lock` in the commit is synced into the sandbox's environment, with `/repo/.venv/bin` first on the path; without one the program runs on the image's Python
- [ ] Per stage: `inputs` writes `/eval/<stage>/inputs.jsonl` on the host and it is uploaded; each `files` entry is uploaded to its sandbox path; `run` runs in `/repo` with `{inputs}` and `{out}` set to `/eval/<stage>/inputs.jsonl` and `/eval/<stage>/out`, under `eval_min`, its log saved to `/eval/<stage>/run.log`; the outputs are downloaded and scored on the host by `score`, and by `details` on dev only
- [ ] `evals/<eval>/<stage>/` holds `inputs.jsonl`, `run.log`, `outputs/` and `report.json`; `evals/<eval>/metrics.json` holds the flattened metrics and the latency metrics from the stage's `timings.jsonl`
- [ ] A program crash, a timeout, a scorer failure or, on dev, an empty stage make an outcome with `ok: false` and the reason; an infrastructure failure is retried; test always runs every stage
- [ ] An evaluation counts only if it reports the config's `primary_metric`
- [ ] The scorer, the gold and the evaluators never enter the sandbox; only the files the stage names are uploaded
- [ ] A Docker test evaluates the `datenorm` starter on dev: `answer/` holds the four files and the metrics include `accuracy` 0.125 and the latency metrics
- [ ] `npm run typecheck` and `npm test` pass
