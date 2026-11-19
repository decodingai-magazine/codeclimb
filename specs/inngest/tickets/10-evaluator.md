# 10: Evaluator: one commit scored on dev or test in its own sandbox

**What to build:** One commit is evaluated on dev or test in a sandbox of its own, stage by stage: inputs written on the host, the program run in the sandbox, outputs scored on the host. It comes back as metrics, latency included, or as an `error` outcome with the run log's tail. Metering comes in ticket 17.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Evaluator; Standard metrics), "Architecture", "Scenario contract", "Files a night writes", "Ids and names"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, report metrics, scoring hash); 03 (Night config, night ids and the runs folder); 06 (Experiment repository: experiments.git, starter commit, experiment refs); 07 (Sandbox interface and the Docker backend)

**Status:** ready-for-agent

- [ ] Each evaluation has its own sandbox `cc-<eval id>`, never a coder's, from the scenario's image plus the commit; the commit's `uv.lock` environment is in `/repo/.venv`; the sandbox is destroyed after the evaluation, also after a failed one
- [ ] Per stage, in order: the `{split}` input written on the host by `inputs`; the stage's `files` uploaded; `run` in the sandbox with cwd `/repo`, `{inputs}` = `/eval/<stage>/inputs.jsonl`, `{out}` = `/eval/<stage>/out` and the `eval_min` timeout; the outputs downloaded and scored on the host by `score`, or by `details` on dev when the stage has it
- [ ] `{split}` is `dev` or `test`, never `train`; only the inputs and the stage's `files` enter the sandbox
- [ ] Files land under `evals/<eval>/`: `<stage>/inputs.jsonl`, `<stage>/run.log`, `<stage>/outputs/`, `<stage>/report.json`, and `metrics.json` only when every stage was scored
- [ ] A program crash, a timeout, a scorer failure or, on dev, a stage that wrote no output is an `error` outcome, not scored, carrying the run log's tail; an evaluation counts only if it reports the primary metric; test always runs every stage (unit tests with a fake sandbox, plus a Docker test of a crashing program)
- [ ] Latency metrics come from `timings.jsonl` lines `{op, id?, ms, warmup?}`: `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s` and `latency_total_s` (unit tests on fixtures)
- [ ] Docker test: the `datenorm` starter evaluated on dev with the `datenorm-smoke` config gives `accuracy` 0.125 and `output_bytes` above 0; evaluated on test it runs every stage
