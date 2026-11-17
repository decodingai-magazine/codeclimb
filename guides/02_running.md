# Running CodeClimb

After this guide you can start the Agent Server, then start, follow, stop, pause, resume, continue, seed and export a night, and watch it in the dashboard. Every scenario needs [01_setup.md](01_setup.md) done first.

Scenarios follow the order a night runs in: services up, a night started, watched, ended, then reused. Everything runs on your machine: this branch has no cloud mode and no remote sandboxes.

## Agent Server

Needs: [01_setup.md](01_setup.md), with `LANGSMITH_API_KEY` in `.env`. Every night needs it running.

Entry points: `src/cli/server.ts` (the `server` scripts), `langgraph.json` (the graphs `night`, `stop` and `lessons`), `src/graphs/night.ts` (the loop), `docker/langgraph-up.compose.yaml` (mounts, networks, environment).

```bash
npm run server
```

It runs `langgraphjs up` ([LangGraph CLI](https://docs.langchain.com/langsmith/cli), [`up` vs `dev`](https://docs.langchain.com/langsmith/local-dev-testing)): it builds the server image from the checkout (about 45 s cold, 35 s after a change) and starts three containers, the server, its Postgres and its Redis. Its last line is:

```txt
server: http://127.0.0.1:8123 (container <project>-langgraph-api-1); logs: npm run server:logs; stop: npm run server:stop
```

Check it, follow its logs, stop it:

```bash
curl -s http://127.0.0.1:8123/ok
```

```bash
npm run server:logs
```

```bash
npm run server:stop
```

`/ok` answers `{"ok":true,...}`. `server:stop` runs `docker compose down` without `-v`, so Postgres keeps every thread and a killed night can still resume.

- **One night at a time.** One server runs one night; metered nights need one server per machine, since the `cc-meter-relay` container is shared.
- **Loopback only.** The server's port is published on `127.0.0.1:8123`; `server` stops the stack if it finds it bound wider.
- **macOS.** `server` holds `caffeinate -i` for as long as the server container runs.
- **Studio.** Traces of the server's runs open in LangGraph Studio at `https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:8123`.

> [!WARNING]
> A code change reaches the server only through `npm run server` again, which recreates the container: to a running night that is a kill. Let running nights finish, or stop them, first.

## Mock night

Needs: `## Agent Server`, and `codeclimb-python` built ([01_setup.md#sandbox-image](01_setup.md#sandbox-image)). Free: scripted models, no provider called, no provider credentials.

Entry points: `src/cli/run-night.ts`; mock mode in `src/pi/models.ts`.

```bash
npm run run-night -- --config configs/datenorm-smoke.yaml --mock
```

Prints `started night <id> (thread <uuid>); results: <dir>`, one line per row, and, about 10 s later, `done` with the night's `done.json`: `"stop_reason": "max_rounds"`, `"rounds": 2`, `"spend_usd": 0` (measured on `9567643`):

```txt
r1 experiment dev r1-e0 accuracy=0.125 keep $0.0000 mock change, no real work
r2 noise dev r1-e0 accuracy=0.125 keep $0.0000 A/A run: the checkpoint evaluated again on dev, with no replayed model calls
r2 experiment dev r2-e0 accuracy=0.125 revert $0.0000 mock hypothesis
r2 test test r1-e0 accuracy=0.125 keep $0.0000
```

- **Real:** the Agent Server, LangGraph steps, sandboxes, Pi sessions and their tools, commits, evals, the metering proxy, keep rules and reports.
- **Scripted:** the coder appends a line to `MOCK.md` with bash, the reviewer keeps nothing, and the program's model calls get a canned answer at no cost.
- **Results** land in `runs-langchain/mock/<results_path>`, away from real reports. Metrics mean nothing.

Give a night a fixed id with `--night-id ID`; an id used before is refused. `--mock-offline N` makes N of the first coder's model calls fail, as a lost connection. `capitals-smoke` with `--mock` exercises the metering proxy:

```bash
npm run run-night -- --config configs/capitals-smoke.yaml --mock
```

## Smoke night on real models

Needs: `## Agent Server`, Pi logged in to `github-copilot` ([01_setup.md#pi-model-providers](01_setup.md#pi-model-providers)). Spends up to $0.50 of Copilot subscription credit (an estimate).

Entry points: `src/cli/run-night.ts`, `src/coder/coder.ts`, `src/review/reviewer.ts`.

```bash
npm run run-night -- --config configs/datenorm-smoke.yaml
```

`run-night` checks every model first and exits with `run-night: <ref>: no <provider> credentials; ...` when one is missing. Other flags: `--no-wait` starts the night without following, `--rounds N` overrides `max_rounds`, `--seed` (below). Ctrl-C prints `detached; night <id> keeps running`.

## Check results

Needs: a night that wrote `results.jsonl`. Entry points: `src/cli/validate-results.ts`, `src/results.ts` (the schema).

```bash
npm run validate-results -- runs-langchain/mock/datenorm-smoke/results.jsonl
```

Prints `ok: <N> rows` (`ok: 4 rows` after one mock night), or `<bad> of <N> rows invalid` and exits 1. Print the row schema:

```bash
npm run validate-results -- --schema
```

## Worker API and watchdog

Needs: `## Agent Server`. The dashboard reads it, and its watchdog recovers nights a crash left behind (every 60 s). Entry points: `src/cli/api.ts`, `src/api/server.ts`, `src/api/watchdog.ts`.

```bash
npm run api
```

Prints `api: http://127.0.0.1:7421/api (Agent Server http://127.0.0.1:8123; watchdog every 60 s)`. A busy port is a startup error: two APIs would run two watchdogs over the same nights. Endpoints: [03_how_it_works.md#worker-api](03_how_it_works.md#worker-api).

## Stop a night

Needs: a running night. Entry points: `src/cli/run-night.ts`, `src/control.ts`, `src/graphs/stop.ts`.

```bash
npm run run-night -- stop --night <night_id>
```

Prints `stopped` and the night's `stop.json` (`reason: manual`). The `stop` graph cancels the night's server runs, aborts Pi and the running steps, and sweeps the night's sandboxes. A stopped night has no test score.

## Pause and resume

Needs: a night paused out of credits. Entry points: `src/night/pause.ts`, `src/graphs/pause.ts`.

A night pauses instead of failing when a provider is out of credits; otherwise a program that gets a 402 on every call would score as a low F1, and the reviewer and keep rule would act on it.

- **What is detected.** A 402, a key limit or a quota error from a program call or a coder or reviewer turn. A 429 rate limit is not a credit error: Pi retries it.
- **How it waits.** The night calls LangGraph's [`interrupt()`](https://docs.langchain.com/oss/javascript/langgraph/interrupts) between steps, so a pause costs nothing while it waits. `run-night` prints `paused in round <N> (<where>); resume with: npm run run-night -- resume --night <id>`; `nights/<id>/pause.json` says the same.
- **What is kept.** A coder commits its partial work and resumes the same Pi session. Finished steps stay; only the stopped ones rerun.
- **Limits.** A pause lasts 3 days (a delayed run of `stop` on the night's timer thread), then the night stops. Stop works while paused.

Add credits, then:

```bash
npm run run-night -- resume --night <night_id>
```

Prints `resumed pause <N> of night <night_id>` and follows the night. The night page's **Resume** button does the same. Paused time doesn't count against the deadline.

## Dashboard

Needs: `## Worker API and watchdog`. Watches, stops, resumes, continues and exports nights; it never starts them, never runs Pi or sandboxes.

Entry points: `web/app/` (pages), `web/app/api/worker/[...path]/route.ts` (proxy to the worker API, adds the token server side).

```bash
npm run dev
```

Serves http://127.0.0.1:3000 (loopback only, no login). The production build:

```bash
npm run build:app
```

- **Nights** (`/`): every night with status, round, best primary value against its threshold, spend against budget; refreshed every 10 s.
- **Night** (`/nights/<id>`): status, **Stop**, **Resume** while paused, a **Continue** form once the night ended, tiles (kept value, test, round, spend, elapsed), the current experiment every 5 s, per-stage metric tables, the convergence chart and metric-family heatmap, each experiment's metrics, hypothesis and diff, and **Export** of kept commits as a git repository.

## datenorm-hard

Needs: `## Agent Server`. Entry point: `scenarios/datenorm-hard/` (it reuses the `datenorm` generators).

`datenorm` is fully specified, so one round solves it. `datenorm-hard` is built to need several:

- **Breadth.** 6 more families (`holiday`, `nth_weekday`, `yearless`, `multi_date`, `fuzzy`, `week_date`), about half the items.
- **Interference.** `invalid` gets traps aimed at loose fixes, such as `Augustine 23, 1990`, `part no. W37-5` and `Easter plans`.
- **A vague spec.** `SPEC.md` says which kinds of input appear, not the conventions behind the gold. `METRICS.md` explains each family, so per-family accuracy tells the loop where to look. `HIDDEN_RULES.md` is the answer key and never reaches a sandbox.

```bash
npm run build:dataset:hard
```

No config ships for it: copy `configs/datenorm.yaml`, point `scenario:` at `scenarios/datenorm-hard`, then run `npm run run-night -- --config <your copy>`. Rebuild plain datenorm's gold with:

```bash
npm run build:dataset
```

## graphrag

Needs: `## Agent Server`, `codeclimb-graphrag` built ([01_setup.md#sandbox-image](01_setup.md#sandbox-image)). The server image runs its host commands through its own `uv`. Entry point: `scenarios/graphrag/scenario.yaml`; gold and metrics: [scenarios/graphrag/README.md](../scenarios/graphrag/README.md).

A GraphRAG system over 22 Decoding AI articles, scored in three stages, each on gold input: extraction (mention and relation F1), graph building (B-cubed precision and recall) and retrieval (per query kind).

- **Host side.** The evaluators, `check` and `scan` run in the server container through `uv` with the scenario's `pyproject.toml` (`UV_PYTHON=3.14`).
- **Sandbox side.** The program is `python -m graphrag <stage> --root --inputs --out [--graph]` in the `codeclimb-graphrag` image.
- **Bundle.** The coder gets `spec/agent/`, the 6 train articles, train's gold graph, and train examples and inputs per stage.
- **Metrics.** Flattened with the stage in front: `extraction.mentions.f1`, `graph.b_cubed.recall`, `retrieval.by_kind.single_hop.metrics.edge_recall_at_k.mean`.

```bash
npm run run-night -- --config configs/graphrag-smoke.yaml
```

The full night is `configs/graphrag.yaml` (24 rounds, plateau after 9, $60 cap, Opus 5.5 coder and reviewer on `ANTHROPIC_API_KEY`, program models on `OPENROUTER_API_KEY`):

```bash
npm run run-night -- --config configs/graphrag.yaml
```

## Overfit end-to-end scenario

Needs: `## Agent Server`. Entry point: `scenarios/datenorm/scripts/build_overfit.py`. `configs/e2e/overfit.yaml` runs on a generated scenario:

```bash
npm run build:scenario:overfit
```

Writes `generated/datenorm-overfit` (gitignored). `configs/e2e/budget.yaml` and `plateau.yaml` check the budget and plateau stops. All three are shared with the [Inngest](https://inngest.link/dai-gh) stack on `main`.

## Continue a night

Needs: an ended night. Entry points: `src/night/variation.ts`, `src/control.ts`. Runs more rounds under the same id, as a new variation on a new thread.

```bash
npm run run-night -- continue --config configs/graphrag.yaml --direction "Work on multi-hop retrieval" --rounds 3
```

Prints `continued night <id> as variation <N> (thread <uuid>): rounds up to <M>`.

- `--night <id>` picks the night (default: the newest that ended under the config's `results_path`). `--rounds` adds to the rounds so far (default: the config's `max_rounds`). `--seed` is refused here. The night page has the same form.
- Rounds number on from the last one and start from the kept commit, with the last feedback and hypothesis. A direction goes to every new coder and reviewer and replaces the hypothesis.
- If the scenario's evaluators or gold changed since the last run, one extra round scores the kept commit again first.
- Each variation ends with its own test eval, so every continuation is another look at test: keep them few.

## Seed a new night

Needs: an ended night. Entry point: `src/night/variation.ts`. A new night (own id, budget and trajectory) that starts from an earlier night's kept commit instead of the starter.

```bash
npm run run-night -- --config configs/graphrag.yaml --seed best
```

- `--seed` takes a night id, `latest` (newest ended) or `best` (highest weighted dev score; test never counts). Prints `seed: night <id>`, with `(the scoring changed: a rescore round first)` when the evaluation changed since.
- Only the code and its dev scores carry over: the first round must beat them. What the earlier night learned arrives through the scenario's lessons.

## Lessons

Needs: an ended night on a scenario that declares `lessons` in `scenario.yaml`. Entry points: `src/cli/lessons.ts`, `src/lessons.ts`, `src/graphs/lessons.ts`. Lessons are the only memory between nights; the `lessons` graph distills them after each night, and this CLI does the same by hand.

```bash
npm run lessons -- distill --config configs/graphrag.yaml --night <night_id>
```

A paid model call (free for a mock night). Prints `<n> ops, <r> rejected, $<usd>; proposed: <dir>`, or `nothing new to distill from <night_id>`; `--apply` also writes the scenario's `lessons.md`.

```bash
npm run lessons -- apply --config configs/graphrag.yaml --night <night_id>
```

```bash
npm run lessons -- format --config configs/graphrag.yaml --check
```

Prints `<file> is in layout`, or exits 1 with `is out of layout`; drop `--check` to rewrite it.

## Export

Needs: a night with a kept commit. Entry points: `src/cli/export.ts`, `src/export.ts`. The night page's **Export** panel downloads one as a git repo `.tar.gz`; from the terminal:

```bash
npm run export -- --config configs/datenorm.yaml --exp best --to-dir ../datenorm-solution
```

```bash
npm run export -- --config configs/datenorm.yaml --exp <exp_id> --to-dir ../datenorm-repo --with-history
```

```bash
npm run export -- --config configs/datenorm.yaml --exp best --to-remote git@github.com:you/repo.git --branch main
```

- Prints `<exp_id> (<sha>) → <destination>` and the exported log.
- `--exp best` is the kept commit of the most recently finished night; `--results <jsonl>` replaces `--config`.
- A folder export refuses a non-empty folder unless `--force`; `--with-history` needs an empty or new folder.
- A remote export pushes the lineage (starter → each kept parent → the experiment) to `codeclimb/<exp_id>` or `--branch`. It never force-pushes.
- Remotes are limited to `https`, `ssh`, `git`, `file` and local paths; option-like arguments and `ext::`/`fd::` transports are refused, and git never prompts for credentials.

## End-to-end checks

Needs: `## Agent Server`. Entry point: `.claude/skills/codeclimb-e2e/SKILL.md`. Seven free nights on mock models (metered program, iteration cap, plateau cap, hard stop, kill and restart of the server container, lost connection, graphrag) and four paid ones with ceilings from $0.20 to $0.50. Run the free ones in order after any change to the loop, the graphs, sandboxes, Pi sessions, the proxy or the stops; run `npm run server` again first.

Next: [03_how_it_works.md](03_how_it_works.md)
