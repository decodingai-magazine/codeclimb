# 13: Evaluator, unmetered

**What to build:** One evaluation of one commit on one split, as step bodies: its own sandbox, the reset, the commit's environment, then per stage the inputs on the host, the run in the sandbox, the download of the outputs and the score on the host. It returns aggregates only (ok, metrics, error, timings, the sandbox instance id) and leaves everything else under `evals/<eval>/`. A program crash is an outcome with `ok: false`, not a failed step.

**Spec sections:**
- "Evaluator": the steps 1, 2, 4 and 5 and "Outcomes"
- "Scenario contract": the stage table
- "Data and files" > "Files a night writes": the `evals/<eval>/` row
- "Every number in one place": the evaluator rows

**Not yet:** the meter token, the meter variables and the path check after a run (ticket 22), so cost metrics are all 0 and no `meter.jsonl` is written; credit stops (ticket 29).

**Blocked by:** 03 (Host commands, placeholders and masking); 04 (Stage reports and standard metrics); 07 (Experiment repository); 08 (Sandbox interface and Docker backend); 09 (Step wrapper, abort signal and live registry)

**Status:** ready-for-agent

- [ ] The reset kills every process but the sandbox's keep-alive, wipes `/repo`, `/work`, `/eval`, `/tmp` (sparing the process-id files) and the home cache, and clones the commit into `/repo`; running it twice gives the same state
- [ ] A commit with a `uv.lock` gets its environment in `/repo/.venv` within 3 minutes; a failure fails the evaluation with a `uv.lock: …` error
- [ ] Per stage: inputs are written on the host to `evals/<eval>/<stage>/inputs.jsonl` and uploaded with the stage's `files`; the run uses cwd `/repo`, the `eval_min` timeout, `/repo/.venv/bin` first on the path, and sends its output to `run.log`, which is saved on the host after a clean exit too
- [ ] Outputs are downloaded to `evals/<eval>/<stage>/outputs/` with the run's files at the top level
- [ ] On dev a clean run with no output ends the evaluation as failed; on test every stage runs
- [ ] The score uses `details` on dev when the stage has it, else `score`; the report is flattened with ticket 04's metrics
- [ ] A timeout, a non-zero exit, a bad timings file or a scorer failure gives `ok: false` with an error holding the run log's last 2,000 characters; an `inputs` failure or an infrastructure failure throws
- [ ] `ok` is true only when the primary metric is a number; `metrics.json` is written; the sandbox is destroyed in a step of its own, also after a failed evaluation
- [ ] A retried step finds its sandbox by name and reuses it after the reset
- [ ] Integration test on Docker: the `datenorm` starter evaluated on `dev` gives `ok: true` with accuracy 0.125; a commit whose program exits non-zero gives `ok: false`; no container is left
- [ ] `npm run typecheck` and `npm test` pass
