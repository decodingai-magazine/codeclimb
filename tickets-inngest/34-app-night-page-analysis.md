# 34: App: metric tables, convergence chart, heatmap, experiment detail and export

**What to build:** Below the controls, the Night page shows per-stage tables of the headline metrics for each kept commit and for test, a convergence chart with a metric selector and a table view, a heatmap of per-family accuracy metrics where the scenario reports them, the selected experiment's detail with its diff, and an Export action.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "App", "Worker API", "Export"

**Blocked by:** 31 (Export: a kept commit as files, as a git repository, or pushed to a remote); 33 (App: the Night page with status, controls, tiles and the live experiment)

**Status:** ready-for-agent

- [ ] Per-stage tables list the headline metrics with their `ci95` for each kept commit and for test
- [ ] The convergence chart plots a selectable metric over the rounds and has a table view of the same data
- [ ] The heatmap shows `acc_*` metrics per family, for the kept lineage or for all experiments, and is absent when the scenario reports none
- [ ] Selecting an experiment shows its metrics, cost, hypothesis and its diff against its parent, read from the report endpoint
- [ ] Export downloads a kept commit as a git repository through the export endpoint
- [ ] View-model functions (headline rows per stage, chart series, heatmap matrix, lineage filter) have unit tests on report fixtures, including a multi-stage fixture with `ci95` values
- [ ] Check against the `datenorm-smoke --mock` night: the chart shows two rounds, the round-1 experiment's diff shows `MOCK.md`, and the downloaded archive unpacks to a git repository
