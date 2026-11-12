# 40: App

**What to build:** `npm run dev` serves a Next.js app on `127.0.0.1` where an operator watches and steers nights: a list of nights, and a page per night with its status, controls, tiles, the live experiment, metric tables, a convergence chart, a heatmap, the selected experiment's diff, and export. The app is only a client of the worker API; the browser never holds the worker token.

**Spec sections:**
- "Interfaces" > "App": all of it
- "Components": the app row
- "Deployment and environment": `CODECLIMB_WORKER_URL`, `CODECLIMB_WORKER_TOKEN`; the app binds loopback; the app is a separate app from the graphs, so Pi's native dependencies stay out of its bundle
- "What you get, what you build": the `dev` and `build:app` scripts; the `next`, `react`, `react-dom` rows
- "Every number in one place": the "app / CLI" polling row

**Not yet:** nothing is deferred. Nights start only from the CLI: the app has no start control.

**Blocked by:** 34, 39

**Status:** ready-for-agent

- [ ] Every page reads the worker API through a server route that adds the worker token; no browser request goes to the worker API directly, and the token appears in no client bundle
- [ ] Nights (`/`): every night with status, round, best primary value against its threshold and spend against budget, refreshed every 10 s
- [ ] Night (`/nights/<id>`): polled every 5 s, with report data refetched when a row lands
- [ ] Controls: Stop; Resume while paused, with the pause's reason; a Continue form (direction, rounds) once the night ended; Export of a kept commit as a git repository download
- [ ] Tiles: kept primary value, test (one per stage on a multi-stage scenario), round, spend with its breakdown, elapsed against the deadline; the current round's experiment with phase, elapsed, tokens, coder and program-call spend
- [ ] Per-stage tables of the headline metrics with their `ci95` for each kept commit and for test; a convergence chart with a metric selector and a table view; a heatmap of `acc_*` metrics for the kept lineage or all experiments, shown only where a scenario reports them
- [ ] The selected experiment shows metrics, cost, hypothesis and its diff against its parent
- [ ] Light and dark themes
- [ ] `npm run build:app` succeeds and the app's bundle pulls in no Pi, LangGraph or Docker code
- [ ] Unit tests cover the view-model functions (tiles, chart series, heatmap rows) on the rows of a finished mock night
- [ ] With `npm run api` running over a finished mock `datenorm-smoke` night and a finished mock `graphrag-smoke` night, the nights list and both night pages answer an HTTP fetch with status 200 and show the night's id, status `finished` and its rounds
- [ ] `npm run typecheck` and `npm test` pass
