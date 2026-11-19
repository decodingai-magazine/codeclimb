# 35: App: metrics per stage, convergence chart, experiment diffs and export

**What to build:** The night's page explains the night: the kept and test metrics per stage, a convergence chart over the rounds, each experiment's metrics and diff, and an export button that downloads the kept commit.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Worker API and app; Export), "Worker API", "Scenario contract"

**Blocked by:** 33 (Export: a kept commit as files, as a git repository, or pushed to a remote); 34 (App: the nights list and a live night with its controls)

**Status:** ready-for-agent

- [ ] Kept and test metrics are shown per stage, a multi-stage scenario's under each stage's name
- [ ] A convergence chart shows how the score moved over the rounds
- [ ] Selecting an experiment shows its metrics and its diff
- [ ] The export button downloads a kept commit through the worker API's export endpoint
- [ ] The functions that shape metrics per stage and the chart's series have unit tests on report fixtures, one of them multi-stage
- [ ] Check against a `datenorm-smoke --mock` night: the chart shows two rounds, the round-1 experiment's diff shows `MOCK.md`, and the downloaded archive unpacks to a git repository
