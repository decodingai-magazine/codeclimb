# 10: Evaluator: an unmetered evaluation with latency metrics

**What to build:** Given a commit and a split, an evaluation creates its own sandbox, resets it, builds the commit's environment, and for each stage writes inputs on the host, runs the program in the sandbox, downloads the outputs and scores them on the host. It returns aggregates only; per-item data stays on disk. A program failure is an outcome with `ok: false`, never a thrown error. Metering is added in ticket 18.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Evaluator", "Standard metrics", "Stage reports become metrics", "Files a night writes", "Ids"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, scoring hashes, report flattening); 03 (Night config: parse, defaults, validation, night ids, results paths); 06 (Experiment repository: experiments.git, starter commit, refs, git bundles); 07 (Sandbox interface and the Docker backend)

**Status:** ready-for-agent

- [ ] The reset kills everything but the sandbox's init, the guest agent and the keep-alive command, wipes `/repo`, `/work`, `/eval`, `/tmp` (sparing the process-id files) and the home cache, and clones the commit; running it twice gives the same state (Docker test)
- [ ] A commit with a `uv.lock` gets its environment rebuilt in `/repo/.venv` (frozen, no dev group, system packages importable) within 3 minutes; a failure fails the evaluation with a `uv.lock: …` error
- [ ] Per stage the order of "Evaluator" step 4 holds: inputs, uploads (inputs and the stage's `files`, a directory whole), the run with `eval_min` timeout and `/repo/.venv/bin` first on the path, `run.log` saved also after a clean exit, outputs tarred and downloaded, the empty-stage stop on dev only, timings parsed, `details` on dev when the stage has it else `score`, flattening
- [ ] Files land as "Files a night writes" lists them under `evals/<eval>/`; `metrics.json` only when every stage was scored
- [ ] Latency metrics from `timings.jsonl` follow "Standard metrics": the op pattern, warm-up records ignored, linear-interpolation percentiles at 3 decimals, totals at 6 decimals; a bad timings file fails the evaluation (unit tests)
- [ ] Outcomes: program crash, timeout, bad timings, scorer failure and an empty dev stage give `ok: false` with the run log's last 2,000 characters; an `inputs` failure throws; `ok` means the primary metric is a number (unit tests with a fake sandbox, plus one Docker test of a crashing program)
- [ ] A retried evaluation finds its sandbox by name and reuses it after the reset; destroying the sandbox is a separate call that also runs after a failed evaluation
- [ ] Docker test: the `datenorm` starter commit evaluated on dev with the `datenorm-smoke` config returns accuracy 0.125 and `output_bytes` above 0; evaluated on test it runs every stage
