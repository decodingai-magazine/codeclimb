# 18: Metered nights on Docker: relay, meter variables, both ledgers, cost metrics

**What to build:** On a night with `allowed_models`, sandboxes join the `cc-meter` network and reach the proxy through the shared relay container. The coder's shell gets a dev ledger capped by the experiment's budget; each evaluation gets its own ledger capped by the night's budget left. The evaluation's calls land in `meter.jsonl` and become the cost metrics. The path is checked before work starts and after each stage's run, so an outage never becomes a score. An unmetered night gets no token and stays on the default bridge.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Metering proxy", "Evaluator", "Standard metrics", "Coder", "Prompt", "End of an experiment", "Known gaps"

**Blocked by:** 09 (Coder experiment: from the prompt to one commit); 10 (Evaluator: an unmetered evaluation with latency metrics); 11 (Tracer night: one mock round on the Inngest dev server); 16 (Metering proxy: ledgers, routes, refusals and backends)

**Status:** ready-for-agent

- [ ] The relay: container `cc-meter-relay` from the scenario's image on the default bridge with the `host.docker.internal` host-gateway alias, running a Python standard-library TCP forwarder from 8080 to the proxy's port, labelled `cc.meter=1` and `cc.meter.port=<port>`, with no managed label, attached to the plain network `cc-meter`; reused while it runs with the same port label, recreated otherwise, never swept; concurrent callers don't remove a relay another just started (Docker test with two concurrent callers)
- [ ] On Linux with `CODECLIMB_PROXY_HOST` unset the proxy binds the Docker bridge's gateway address automatically (the spec asks for this although the reference lacks it); the address selection is unit-tested
- [ ] The Docker "path is up" check (network and relay exist, relay runs, port label equals the proxy's port, else recreate) runs before a coder starts, before an evaluator opens and after each stage's run; after a run it comes before the exit code is read and throws on failure
- [ ] Metered sandboxes get `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `CODECLIMB_LLM_BASE_URL`, `CODECLIMB_LLM_API_KEY` pointing at `http://cc-meter-relay:8080/v1`, in the coder's bash and in each stage run only; no provider key and no host environment enters a sandbox
- [ ] Coder dev ledger `<exp>-dev`: a new token per Pi attempt, spend carried over, cap = what is left of `budget_usd.experiment`, written as `meter-dev.jsonl`, counted as `dev_usd`, never in cost metrics; the coder's budget stop reads `coder_usd + dev_usd`
- [ ] Evaluation ledger: opened after the environment build with cap = the night's budget left, closed in "Close" also on failure, written as `meter.jsonl`, summed into `program_usd` and the cost metrics; a credit stop ends the stage with no score and is returned as a credit stop
- [ ] The coder prompt carries the metered-night rules (endpoint variables, models, budget, the 402, the free replay after 5 seconds, models only through this endpoint) only on a metered night
- [ ] End-to-end, mock, dev server: `npm run run-night -- --config configs/capitals-smoke.yaml --mock` prints `done`; `evals/*/meter.jsonl` lists the program's calls, none with `error`; `done.json` has `spend_usd: 0`; the night keeps nothing; no `cc-<id>` container remains while `cc-meter-relay` may
- [ ] `datenorm-smoke --mock` still passes the checks of ticket 11 and gets no token
