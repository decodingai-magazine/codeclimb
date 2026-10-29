# codeclimb

Next.js app with [Inngest](https://www.inngest.com) background functions.

## Local development

Requires Node.js 20+. Follows the [Inngest local development guide](https://www.inngest.com/docs/local-development).

```bash
npm install
```

Run the Inngest Dev Server and the app in two terminals:

```bash
# Terminal 1: Inngest Dev Server (UI at http://localhost:8288)
npm run dev:inngest

# Terminal 2: Next.js app (http://localhost:3000)
INNGEST_DEV=1 npm run dev
```

- `INNGEST_DEV=1` puts the Inngest SDK in local mode. Without it, the v4 SDK runs in cloud mode and fails because it has no Inngest Cloud signing key. To skip the prefix, add `INNGEST_DEV=1` to `.env.local`.
- The Dev Server reads `inngest.json`, which points it at `http://localhost:3000/api/inngest` and turns off auto-discovery.
- `dev:inngest` passes both `--ignore-scripts=false` and `--allow-scripts=inngest-cli` to `npx`. The CLI downloads its binary in a postinstall script, and npm 12 needs `--allow-scripts` to run it.

Open http://localhost:8288. **Apps** should list `codeclimb` and **Functions** should list `hello-world`.

### Trigger the hello world function

From the app, via `inngest.send()`:

```bash
curl -X POST http://localhost:3000/api/hello -d '{"name": "codeclimb"}'
```

Or from the Dev Server UI: open **Functions**, pick `hello-world`, select **Invoke** and send:

```json
{ "data": { "name": "codeclimb" } }
```

Then open **Runs** to see the steps and output.

### Debug the endpoint

```bash
curl -s http://localhost:3000/api/inngest
```

In local mode this returns `"mode": "dev"` and `"function_count": 1`.

### Agent access (MCP)

The Dev Server exposes an MCP endpoint at `http://127.0.0.1:8288/mcp` for listing functions, sending events and checking runs from a coding agent.

## CodeClimb loop

CodeClimb is an optimization loop. Pi coding agents write a program inside sandboxes, and the loop keeps the best change each round until the program meets evaluation thresholds. This iteration has a few limits:

- It runs only on the **local Inngest dev server** with **Docker sandboxes**.
- The coders and the reviewer are **models driven by Pi**: GitHub Copilot, Anthropic (API key), OpenCode Zen or OpenCode Go. The bundled configs use Copilot Haiku.
- It uses small built-in scenarios: `datenorm`, which normalizes messy date strings to ISO dates, and `capitals`, whose program calls a model, to exercise cost metering.

### Authenticate Pi

Pi runs in the worker on the host, never in a sandbox, so credentials stay on the host. Each model in `models` and `reviewer_model` is `<provider>/<id>`, and its provider needs credentials:

| Provider | `<provider>` | Credentials | Example model |
|---|---|---|---|
| GitHub Copilot | `github-copilot` | `npx pi`, then `/login github-copilot`; or `COPILOT_GITHUB_TOKEN` | `github-copilot/claude-haiku-5.5` |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY`; or `npx pi`, then `/login anthropic` → API key | `anthropic/claude-haiku-5-5` |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY`; or `npx pi`, then `/login opencode` | `opencode/kimi-k3` |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY`; or `npx pi`, then `/login opencode-go` | `opencode-go/kimi-k3` |

- `/login` writes `~/.pi/agent/auth.json`. Set `CODECLIMB_PI_AUTH_PATH` to use another file.
- Put env keys in `.env.local` (gitignored). `npm run worker`, `npm run run-night` and the smoke script load it, and variables already set in the shell win. Zen and Go share one `OPENCODE_API_KEY`.
- The same model has different ids per provider: Copilot uses dots (`claude-haiku-5.5`), Anthropic and OpenCode use dashes (`claude-haiku-5-5`). `npx pi --list-models <search>` lists the ids of every provider that has credentials.
- `reviewer_model` is compared to `models` as a string. `anthropic/claude-haiku-5-5` as the reviewer and `github-copilot/claude-haiku-5.5` as a coder pass validation, but they are the same model critiquing its own work.
- `run-night` checks before it starts that every model exists, has credentials and is on the account's plan. The worker checks again with its own environment and fails the night's `check-models` step if a model is not ready; `run-night` then keeps following, so read the error in the dev server UI and press Ctrl-C. The check finds missing keys, not wrong ones: a bad key fails the first model call as `agent_error`.
- `coder_usd` and the `budget_usd` caps use Pi's catalog prices for every provider. They are real spend for an Anthropic API key or Zen credits, and an estimate for the Copilot and Go subscriptions.

Check one model end to end with `npx tsx scripts/smoke-pi-sandbox.ts anthropic/claude-haiku-5-5` (needs Docker and the `autocode-base` image).

### Run a night

Prerequisites:

- Docker is running.
- Pi has credentials for every model in the config (see [Authenticate Pi](#authenticate-pi)).
- The Inngest dev server is running (`npm run dev:inngest`).

```bash
npm run build:baseline                 # docker image autocode-base (python 3.14 + git + spec bundle)
npm run worker                         # terminal 2: connect() worker (orchestrator + Pi)
npm run run-night -- --config configs/datenorm-smoke.yaml   # starts the night and follows results.jsonl
npm run run-night -- stop --night <night_id>                # soft cancel: aborts Pi, destroys sandboxes
npm run validate-results -- runs/datenorm-smoke/results.jsonl
npm test                               # unit tests (keep rule, overfit test, stops, schema)
```

A night runs these steps:

1. **Rounds.** Each round starts one `run-experiment` child per model in `models`, all in parallel, via `step.invoke`.
2. **Experiment.** Each child gives Pi a fresh sandbox built from the baseline plus the kept commit. Pi works until it is done or hits a timeout or `$` cap. The orchestrator then commits `/repo` as one commit.
3. **Evaluation.** Once every coder has stopped, one `run-evaluator` child evaluates the round's candidates one after another in a single sandbox: the parent and each committed branch, in an order that rotates by round. Before each candidate it kills every leftover process, wipes `/repo`, `/work`, `/tmp` and `/eval`, and clones the candidate. `run_cmd` runs the program on the questions, and `score_cmd` scores the outputs on the host. So every candidate of a round is timed on the same machine with nothing else running.
4. **Keep rule.** The parent keeps the best branch that passes the gates if its primary metric gains at least `max(min_gain, 2σ)`. With latency or cost optimized, see [Standard metrics](#standard-metrics-latency-and-cost) for the tie-break and the efficiency keep.
5. **Noise floor.** On the first night, the first kept commit is evaluated 5 times in one evaluator to measure σ of the primary metric and of each optimized standard metric.
6. **Review.** A reviewer model, which is none of the coders, writes feedback and one hypothesis per branch for the next round.
7. **Validation.** Once the kept commit's re-score passes the thresholds, it is validated on a held-out fold. If it overfits, the next fold becomes the validation fold.
8. **Test.** After any stop, the final kept commit is scored on test once.

Validation, test and the noise runs each get their own evaluator too. A worker restart onto this code cannot replay a night started by an older worker, so let running nights finish or stop them first.

All output lands under `dirname(results_path)`:

| Path | Content |
|---|---|
| `results.jsonl` | One row per experiment and per extra eval. `npm run validate-results -- --schema` prints the schema. `reviewer_usd` is the round's review cost, repeated on every row of that round as the spec says, so don't sum it across rows. `done.json` has the night's real spend. |
| `experiments.git` | Bare repo with one commit per experiment, pinned by `refs/exp/<exp_id>`. |
| `nights/<id>/night.json` | Resolved config, start time and deadline, and metric-script hashes. |
| `nights/<id>/done.json` | Stop reason, kept commit and test metrics. |
| `nights/<id>/reviews/r<N>.json` | The reviewer's feedback and hypotheses for round N. |
| `report.html` | Interactive report over every night in `results.jsonl`, rebuilt after each round and at the end of a night. |
| `nights/<id>/exps/<exp_id>/session/*.jsonl` | Pi session transcripts, reopened to resume after a crash. |
| `nights/<id>/evals/<eval_id>/` | Items with gold (host only), raw outputs, the runner's `timings.jsonl`, `meter.jsonl` (the program's model calls) and `metrics.json`. |

### Standard metrics: latency and cost

Every scenario gets the same two metrics, measured outside the code the coders write, on top of its own metrics:

- **Latency** is the program's own time: the hidden runner times each operation it sends the program. It leaves out sandbox setup, clone, scoring and teardown. The runner writes `timings.jsonl` next to its outputs, one line per operation: `{"op": "query", "id": "...", "ms": 12.3, "warmup": true}`. Warm-up records count toward nothing. That gives `latency_<op>_p50_ms`, `latency_<op>_p95_ms`, `latency_<op>_total_s` and `latency_total_s`.
- **Cost** is only the program's model calls, metered by the proxy below: `cost_usd`, `cost_per_item_usd`, `cost_<op>_usd` and `model_calls`. They are 0 for a program that calls no model. Coder and reviewer spend stays in `coder_usd` and `reviewer_usd`, outside optimization, and counts toward `budget_usd.night` as before.

Both are always measured and appear in `results.jsonl`, the report and the Inngest trace. Each night's config chooses whether they are optimized:

```yaml
standard_metrics:
  latency: true                      # default true
  cost: true                         # default true
  latency_metric: latency_total_s    # default
  cost_metric: cost_per_item_usd     # default
  min_efficiency_gain: 0.10          # relative cut a change needs, on top of beating 2σ
```

An optimized metric (lower is better) changes the keep rule in two places. Gates you set on any metric apply either way.

- **Tie-break.** Among branches that gain on the primary metric and are within 2σ of the best one, the cheaper, then faster one is kept.
- **Efficiency keep.** When no branch gains on the primary, a branch is kept if its primary stays within 2σ of both the parent and the night's best kept score, it cuts an optimized metric by more than `max(min_efficiency_gain × parent, 2σ)`, and it raises no other optimized metric by as much.

Latency is compared only between evals that ran on the same evaluator instance. The coder and reviewer prompts name the optimized metrics, and the hypothesis log shows their change next to the primary's. A metric that is not optimized stays out of the prompts unless a gate names it.

#### Metering proxy

A program may call models only when `allowed_models` lists some, and only through the metering proxy in the worker. Keys never enter a sandbox.

- **Network.** Metered evaluators join `cc-meter`, an internal Docker network with no route anywhere. Its only other member is `cc-meter-relay`, a small Python TCP relay that also sits on the default bridge and forwards to the proxy on the host. Coder sandboxes stay on `--network none`. The relay runs on the scenario's baseline image, so that image needs `python3`. The worker leaves `cc-meter-relay` and `cc-meter` in place between nights and recreates the relay when its proxy port changes.
- **Program side.** The runner's environment has `OPENAI_BASE_URL` and `OPENAI_API_KEY` (and `CODECLIMB_LLM_BASE_URL` / `CODECLIMB_LLM_API_KEY`). The key is a token valid for this eval only and revoked when its run ends. The program uses `POST $OPENAI_BASE_URL/chat/completions` with a model from `allowed_models`, such as `github-copilot/claude-haiku-4.5`, or `/embeddings`. Chat goes through Pi, with the same credentials and catalog prices as the coders. The runner calls `POST $CODECLIMB_LLM_BASE_URL/_op` with `{"op": "query"}` to attribute later calls to an operation.
- **Limits.** `budget_usd.eval` caps one eval's model spend (default: `budget_usd.experiment`). It is checked before each call, so the call that crosses it still runs. Errors: `401` bad or revoked token, `403` model not allowed, `402` budget spent, `400` unsupported request, `502` upstream failure (what a failed call cost is still charged).
- **Not supported yet.** Streaming, tools and non-text content in chat. Embeddings only for `openai/text-embedding-3-small` and `-large`, priced from a table in `codeclimb/meter/backends.ts`. Embeddings are unit-tested against a fake upstream only. Operation attribution assumes the runner sends operations one at a time. Coders cannot call models while they develop.
- **Linux.** The proxy binds `127.0.0.1`, which Docker Desktop reaches through `host.docker.internal`. On Linux, set `CODECLIMB_PROXY_HOST` to the `docker0` address, such as `172.17.0.1`. `CODECLIMB_PROXY_PORT` pins the port, which is random by default.

```bash
npm run build:baseline && npm run build:baseline:capitals
npm run run-night -- --config configs/capitals-smoke.yaml   # one round; the program calls github-copilot/claude-haiku-4.5
```

### Harder scenario: `datenorm-hard`

`datenorm` is fully specified, so one round solves it. `datenorm-hard` is built to need several rounds:

- **Breadth.** It adds 6 families: `holiday`, `nth_weekday`, `yearless`, `multi_date`, `fuzzy` and `week_date`. They make up about half the items.
- **Interference.** `invalid` gets traps aimed at loose fixes, such as `Augustine 23, 1990`, `part no. W37-5` and `Easter plans`.
- **A vague spec.** `SPEC.md` says *which kinds* of input appear but not the conventions behind the gold answers. Examples are which year `Nov 30` means, which of two dates counts, and how loose month matching may be. `METRICS.md` explains each family name, so a per-family accuracy number tells the loop where to look. The coder and reviewer prompts tell the agents to treat open choices as hypotheses to A/B across branches. `HIDDEN_RULES.md` lists the gold conventions.

```bash
npm run build:baseline:hard      # image autocode-base-hard (its own /spec)
npm run run-night -- --config configs/datenorm-hard-calibrate.yaml   # 1 branch × 1 round: see how far round 1 gets
npm run run-night -- --config configs/datenorm-hard.yaml             # threshold accuracy 0.90, up to 10 rounds
```

### Report and export

Each night rewrites `report.html` next to `results.jsonl` after every round. It is one self-contained file in the Decoding AI design system and opens offline. It covers every night in the results file:

- **All Nights:** stop reason, rounds, kept accuracy, validation, test, spend and wall time per night.
- **How the Night Converged:** every branch's score per round, the kept step line, the threshold, and the final validation and test scores. Click a point to select that experiment.
- **Metric Families:** a heatmap of the share of items wrong per family, along the kept lineage or across all experiments, with ▲/▼ where a kept commit moved a family.
- **Experiments:** every experiment grouped by round, with its hypothesis, score, change from its parent, keep or revert, and cost. The extra evaluations and the reviewer's feedback each round follow.
- **Detail and export:** the selected experiment's metrics and diff against its parent, and an export panel. The night's best kept commit is selected by default.

```bash
npm run report -- --config configs/datenorm-hard.yaml           # rebuild runs/datenorm-hard/report.html
npm run report -- --config configs/datenorm-hard.yaml --serve   # http://127.0.0.1:7420 with a working Export button
```

Opened from disk, the export panel's button copies the matching CLI command instead. The same export from the terminal:

```bash
npm run export -- --config configs/datenorm-hard.yaml --exp best --to-dir ../datenorm-solution                  # plain files
npm run export -- --config configs/datenorm-hard.yaml --exp hard2-r6-b2 --to-dir ../datenorm-repo --with-history # git repo with the kept lineage
npm run export -- --config configs/datenorm-hard.yaml --exp best --to-remote git@github.com:you/repo.git [--branch main]
```

- `--exp best` is the kept commit of the most recently finished night.
- A folder export refuses a non-empty folder unless `--force` is passed. `--with-history` needs an empty or new folder.
- A remote export pushes the experiment's lineage (starter → each kept parent → the experiment) to `codeclimb/<exp_id>`, or to `--branch`. It never force-pushes, so git rejects a push onto a branch that has diverged.
- Remotes are limited to `https`, `ssh`, `git` and local paths. Option-like arguments and `ext::`/`fd::` transports are refused, and git never prompts for credentials.
- `--serve` binds to 127.0.0.1 only. It answers only requests addressed to that host and port. Exports need a per-run token that is embedded in the served page.

### Layout

| Path | Purpose |
|---|---|
| `inngest/codeclimb/functions.ts` | `run-night` (thin parent), `run-experiment` and `run-eval` (invoked children), and the cleanup handlers |
| `scripts/worker.ts` | `connect()` worker with its own app id `codeclimb-worker`, which keeps Pi out of the Next bundle |
| `scripts/run-night.ts` | `run-night --config <yaml>` CLI |
| `codeclimb/` | Config, keep rule and statistics, git, eval, coder, reviewer, results schema, tracing |
| `codeclimb/sandbox/` | `SandboxBackend` interface, Docker backend, and git-bundle transfer |
| `codeclimb/report/` | Report data, the HTML renderer, the page's CSS and JS, and the two logo lockups |
| `codeclimb/export.ts` | Export an experiment to a folder or a git remote, with the argument checks |
| `scripts/report.ts`, `scripts/export.ts` | `report` (write or `--serve`) and `export` CLIs |
| `codeclimb/pi/` | Isolated Pi sessions and the read/write/edit/bash adapters that run inside the sandbox |
| `scenarios/datenorm/` | Spec bundle (`spec/`, the only thing the agent sees), hidden `dataset/`, `metrics/run.py` + `score.py`, and the `Dockerfile` |
| `scenarios/datenorm-hard/` | A vaguer spec and 6 more families on top of `datenorm`. It reuses the `datenorm` generators, runner and scorer. `HIDDEN_RULES.md` is the answer key and is never put in the image |
| `configs/` | `datenorm-smoke.yaml` (2 rounds × 3 branches), `datenorm.yaml` (a full night), `datenorm-hard.yaml` (up to 10 rounds × 3 branches) and `datenorm-hard-calibrate.yaml` (1 branch × 1 round) |

### Deviations from the spec in this iteration

- **Models:** GitHub Copilot through Pi's `github-copilot` provider, not OpenCode Go.
  - Coders are `claude-haiku-5.5` ×3 and the reviewer is `claude-haiku-4.5`, so the reviewer is not one of the coders.
  - `coder_usd` is Pi's `message_end` cost at list prices. Copilot bills by subscription, so this is a comparable dollar figure, not an actual charge.
- **Local only:**
  - The Inngest dev server, `connect()` worker and Docker backend are used.
  - `sandbox: inngest` (Inngest Sandboxes, Cloud Pro+) throws "not implemented".
  - `step.score` and extended traces are wired up but only show in the dev server.
- **No metering proxy:** `datenorm` is standard-library Python with no model calls.
  - Sandboxes run with `--network none`, which is stricter than the spec's egress allowlist.
  - `program_usd` is 0 and `allowed_models` is unused.
  - On a deterministic program, the noise floor measures σ ≈ 0.
- **Extra config keys:**
  - `run_files`: host files copied to `/eval/` in the eval sandbox.
  - `hidden_fields`: dataset fields never sent to a sandbox, in addition to `gold` and `fold`.
  - `baseline`: the image name.
- **Extra row fields:** `kind` (experiment | rescore | noise | validation | test), `eval_id` (a unique row key) and `night_id`.
  - Extra eval rows use `decision: keep` when the eval succeeded and `error` when it failed.
  - Validation rows use `keep` for no overfit and `revert` for overfit.
- **Pi's base prompt** includes a `<docs>` block pointing at Pi's own docs on the host. Nothing from AGENTS.md, skills, extensions or `~/.pi` is loaded.

### Known behaviour worth knowing

- **The starter is scored 0, as the spec says.** The `datenorm` stub answers `null` for everything, so it really scores 0.125 (the `invalid` family). A round-1 commit that changes nothing still clears `min_gain` and gets kept. This happens when every experiment hits its `$` cap early. The alternative is one real eval of the starter at night init.
- **Haiku 5.5 solves `datenorm` in round 1,** scoring 0.98–1.0 on the optimization folds. `configs/datenorm.yaml` (threshold 0.99) will usually stop after one round and one validation. For a longer climb, use `datenorm-hard`.
- **`datenorm-hard` climbs over many rounds.** Calibration (1 branch × 1 round) scored 0.736. The full night `hard1` (3 branches, `max_rounds: 6`, threshold 0.95, about 8 min, $0.26) kept a commit in 5 of 6 rounds:

  | Round | Kept accuracy | What moved |
  |---|---|---|
  | 1 | 0.800 | |
  | 2 | none kept | all branches at 0.804, below `min_gain` |
  | 3 | 0.836 | `holiday` 0.37 → 0.67 |
  | 4 | 0.848 | `relative` 0.54 → 0.77 |
  | 5 | 0.872 | `week_date` 0.59 → 0.86 |
  | 6 | 0.896 | `yearless` 0.64 → 0.91 |

  - The yearless convention was found by A/B across branches. "Nearest past" lost in round 4, "current year" brought no gain in round 5, and "next occurrence" won in round 6.
  - Test scored 0.83. It has only 7 items per old family, and no validation ran because the thresholds were never met.
  - The night ended on `max_rounds` below its 0.95 threshold, so the config now uses 0.90 and allows up to 10 rounds.
  - With 0.90, night `hard2` (about 10 min, $0.31) stopped on `thresholds` after 6 rounds. It went 0.804 → 0.872 (r2, `holiday` and `multi_date`) → 0.884 (r4, `relative`) → 0.936 (r6, `week_date` and `yearless`). Rounds 3 and 5 kept nothing. Validation on the held-out fold scored 0.930, so the overfit gap was 0.006 and the commit was kept. Test scored 0.896.
- **A killed worker resumes after about 2 minutes,** once Inngest's lease expires and the step retries. The retried step reopens the Pi session JSONL on the still-running sandbox.

### Verified locally (dev server + Docker)

| Check | Config change | Result |
|---|---|---|
| Thresholds + validation stop | `datenorm-smoke` with threshold 0.97 | Round 1 → noise ×5 → validation (gap 0.017 < 2 SE) → test, `stop_reason: thresholds` |
| `max_rounds` + worker crash | `datenorm-smoke`, worker `kill -9` in round 2 | Steps resumed the Pi sessions on the same sandboxes; round 2 → test, `stop_reason: max_rounds` |
| `$` cap | `budget_usd {experiment: 0.003, night: 0.02}` | Pi aborted per experiment; `stop_reason: budget` after round 1 |
| Deadline | `deadline: 30s`, threshold 1.01 | `stop_reason: deadline` after round 1 |
| Overfit rotation | `overfit_gap: -1`, `max_validations: 2` | Fold 0 → fold 1, re-score on the new optimization folds, `stop_reason: max_validations` |
| Night stop | `run-night stop` mid round 1 | Parent and children `CANCELLED`, Pi aborted, sandboxes destroyed |

Across all of these, `results.jsonl` validated against the schema and no `cc-*` containers were left behind.

## Project layout

| Path | Purpose |
|---|---|
| `inngest/client.ts` | Inngest client (`id: "codeclimb"`) |
| `inngest/functions.ts` | `hello-world` function, triggered by `test/hello.world` |
| `app/api/inngest/route.ts` | Serve endpoint the Dev Server syncs and calls |
| `app/api/hello/route.ts` | Sends a `test/hello.world` event |
| `inngest.json` | Dev Server config |
