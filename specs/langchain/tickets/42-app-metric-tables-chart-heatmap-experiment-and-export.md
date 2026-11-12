# 42: App: metric tables, chart, heatmap, experiment and export

**What to build:** The night page shows how the night converged: per-stage tables of the headline metrics, a convergence chart, a heatmap of per-family accuracy, the selected experiment with its diff against its parent, and a download of a kept commit as a git repository.

**Spec sections:**
- "Interfaces" > "App": of the Night page: the per-stage tables, the convergence chart, the heatmap, the selected experiment, Export; report data refetched when a row lands
- "Interfaces" > "Worker API": the report and the export download, as the app consumes them

**Not yet:** nothing is deferred.

**Blocked by:** 40 (Export); 41 (App: nights list, night status, controls and tiles)

**Status:** ready-for-agent

- [ ] Report data is refetched when a row lands, not on every poll
- [ ] Per-stage tables of the headline metrics with their `ci95` for each kept commit and for test
- [ ] A convergence chart with a metric selector, and a table view of the same data
- [ ] A heatmap of the `acc_*` metrics, for the kept lineage or for all experiments, shown only where a scenario reports them
- [ ] The selected experiment shows its metrics, cost, hypothesis and its diff against its parent
- [ ] Export downloads a kept commit as a git repository, through a server route that adds the worker token
- [ ] Both themes hold for the new views; `npm run build:app` still succeeds
- [ ] Unit tests cover the functions that build the table rows, the chart series and the heatmap rows, on the rows of a finished mock night and on fabricated rows with `acc_*` metrics
- [ ] With `npm run api` running over a finished mock `graphrag-smoke` night, its night page answers 200 and holds a table per stage; the export route for a kept commit of a finished mock `datenorm-smoke` night returns a `.tar.gz` whose repository holds `MOCK.md`
- [ ] `npm run typecheck` and `npm test` pass
