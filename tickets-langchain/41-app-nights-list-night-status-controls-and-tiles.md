# 41: App: nights list, night status, controls and tiles

**What to build:** `npm run dev` serves a Next.js app on `127.0.0.1` where an operator watches and steers nights: a list of every night, and a page per night with its status, the Stop, Resume and Continue controls, the tiles and the current round's experiment. The app is only a client of the worker API; the browser never holds the worker token.

**Spec sections:**
- "Interfaces" > "App": the intro, the Nights bullet, and of the Night page: status and controls, the Continue form, the tiles, the current round's experiment
- "Components": the app row
- "Deployment and environment": `CODECLIMB_WORKER_URL`, `CODECLIMB_WORKER_TOKEN`; the app binds loopback; the app is a separate app from the graphs, so Pi's native dependencies stay out of its bundle
- "What you get, what you build": the `dev` and `build:app` scripts; the `next`, `react`, `react-dom` rows
- "Every number in one place": the "app / CLI" polling row

**Not yet:** the metric tables, the chart, the heatmap, the selected experiment and Export (ticket 42). Nights start only from the CLI: the app has no start control.

**Blocked by:** 35 (Graphrag mock night; mock night 7 passes); 38 (Worker API)

**Status:** ready-for-agent

- [ ] Every page reads the worker API through a server route that adds the worker token; no browser request goes to the worker API directly, and the token appears in no client bundle
- [ ] Nights (`/`): every night with status, round, best primary value against its threshold and spend against budget, refreshed every 10 s
- [ ] Night (`/nights/<id>`): polled every 5 s; it shows the status, Stop, Resume while paused with the pause's reason, and a Continue form (direction, rounds) once the night ended
- [ ] Tiles: kept primary value, test (one per stage on a multi-stage scenario), round, spend with its breakdown (agents, program runs), elapsed against the deadline
- [ ] The current round's experiment: phase, elapsed, tokens, coder and program-call spend
- [ ] Light and dark themes
- [ ] `npm run dev` binds `127.0.0.1`; `npm run build:app` succeeds and the app's bundle pulls in no Pi, LangGraph or Docker code
- [ ] Unit tests cover the functions that turn the API's answers into list rows and tiles, on the rows of a finished mock night
- [ ] With `npm run api` running over a finished mock `datenorm-smoke` night and a finished mock `graphrag-smoke` night, the nights list and both night pages answer an HTTP fetch with status 200 and show the night's id, status `finished` and its rounds; the graphrag page has one test tile per stage
- [ ] Through the app's server routes, with `npm run api` and the server running, on mock models: Stop on a night that is still running ends it and the page shows `stopped`; the Continue form adds a round to a finished night
- [ ] `npm run typecheck` and `npm test` pass
