# 17: Metered nights on Docker: mock night 1's metering passes

**What to build:** A program in a Docker sandbox reaches models only through the metering proxy, in each stage run of an evaluation and in the coder's shell, on Docker Desktop and on a plain Linux Docker Engine. Each coder attempt and each evaluation gets its own token and ledger, and their spend and cost metrics land on the rows. A proxy path that is down fails the evaluation instead of scoring it. Mock night 1 (`capitals-smoke`) passes its metering checks.

**Spec sections** (`specs/inngest/spec.md`): "Metering proxy", "Features" (Metering proxy; Evaluator; Sandboxes; Standard metrics), "Scenario contract", "Services", "Environment", "Night config", "Result row"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server); 15 (Metering proxy: routes, tokens, refusals, ledgers and mock answers)

**Status:** ready-for-agent

- [ ] On a metered night (`allowed_models` not empty) a stage run and the coder's shell get `OPENAI_BASE_URL` / `OPENAI_API_KEY` and `CODECLIMB_LLM_BASE_URL` / `CODECLIMB_LLM_API_KEY`, the base URL ending in `/v1` and reaching the proxy; an unmetered night gives neither; no provider key enters a sandbox (Docker test)
- [ ] The metered path works with no variable set and with `CODECLIMB_PROXY_HOST` preset to the Docker bridge address, on Docker Desktop and on a plain Linux Docker Engine, and with `DOCKER_HOST` set (Docker tests on the host at hand; the address choice unit-tested for the other)
- [ ] A coder attempt gets its own token, with its allowed models and a `$` cap; its ledger is `exps/<exp>/meter-dev.jsonl` and its spend the row's `dev_usd`
- [ ] An evaluation gets its own token the same way; its ledger is `evals/<eval>/meter.jsonl`, its spend the row's `program_usd`, and the cost metrics are recorded on every scored row
- [ ] A path to the proxy that is down fails the evaluation instead of scoring it (Docker test)
- [ ] With the dev server and the worker up, night 1, `npm run run-night -- --config configs/capitals-smoke.yaml --mock`, prints `done` with `stop_reason` `max_rounds`; `evals/*/meter.jsonl` lists the program's calls, none with `error` (C13); `capitals-smoke` scores 0 and keeps nothing; `done.json` has `spend_usd: 0`; no `cc-<id>` container is left
- [ ] `datenorm-smoke --mock`, an unmetered night, still passes the checks of ticket 11
