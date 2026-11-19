# 38: App: metric tables, chart, heatmap, experiment and export

**What to build:** The rest of the night page: per-stage metric tables, a convergence chart, a heatmap of per-family accuracy, the selected experiment with its diff, and export.

**Spec sections:**
- "Features": **Worker API and app** (per-stage metric tables, a convergence chart, a heatmap of per-family accuracy, the selected experiment with its diff, and export)
- "Features": **Export**
- "Interfaces the build must honour" > "Worker API": the report and export

**Not yet:** nothing.

**Blocked by:** 31 (Multi-stage night: night 7 passes); 36 (Export); 37 (App: nights list, status and controls)

**Status:** ready-for-agent

- [ ] Metric tables group a night's metrics by stage (`<stage>.…`), with the standard metrics apart; a single-stage night shows one table
- [ ] The convergence chart shows the night's scores round by round, the kept checkpoint's among them
- [ ] The heatmap shows per-family accuracy from the dev reports; a scenario whose reports have no families shows none
- [ ] Selecting an experiment shows its row, decision and reason, its note and its diff
- [ ] Export from the page downloads the kept commit, or sends it to a directory or a remote through the API, showing the API's refusals
- [ ] Tests render these views against the files of a mock `datenorm-smoke` night and a mock `graphrag-smoke` night
- [ ] `npm run build:app`, `npm run typecheck` and `npm test` pass
