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
- The coders are **GitHub Copilot Haiku models driven by Pi**.
- It uses a small built-in scenario, `datenorm`, which normalizes messy date strings to ISO dates.

### Run a night

Prerequisites:

- Docker is running.
- Pi is logged in to Copilot (`pi`, then `/login github-copilot`), which writes `~/.pi/agent/auth.json`. Alternatively, set `COPILOT_GITHUB_TOKEN`.
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
2. **Experiment.** Each child gives Pi a fresh sandbox built from the baseline plus the kept commit. Pi works until it is done or hits a timeout or `$` cap. The orchestrator then commits `/repo` as one commit, and `score_cmd` scores it on the host.
3. **Keep rule.** The parent keeps the best branch that passes the gates if its primary metric gains at least `max(min_gain, 2σ)`.
4. **Noise floor.** On the first night, the first kept commit is evaluated 5 times to measure σ.
5. **Review.** A reviewer model, which is none of the coders, writes feedback and one hypothesis per branch for the next round.
6. **Validation.** Once the kept commit's re-score passes the thresholds, it is validated on a held-out fold. If it overfits, the next fold becomes the validation fold.
7. **Test.** After any stop, the final kept commit is scored on test once.

All output lands under `dirname(results_path)`:

| Path | Content |
|---|---|
| `results.jsonl` | One row per experiment and per extra eval. `npm run validate-results -- --schema` prints the schema. |
| `experiments.git` | Bare repo with one commit per experiment, pinned by `refs/exp/<exp_id>`. |
| `nights/<id>/night.json` | Resolved config, start time and deadline, and metric-script hashes. |
| `nights/<id>/done.json` | Stop reason, kept commit and test metrics. |
| `nights/<id>/exps/<exp_id>/session/*.jsonl` | Pi session transcripts, reopened to resume after a crash. |
| `nights/<id>/evals/<eval_id>/` | Items with gold (host only), raw outputs and `metrics.json`. |

### Layout

| Path | Purpose |
|---|---|
| `inngest/codeclimb/functions.ts` | `run-night` (thin parent), `run-experiment` and `run-eval` (invoked children), and the cleanup handlers |
| `scripts/worker.ts` | `connect()` worker with its own app id `codeclimb-worker`, which keeps Pi out of the Next bundle |
| `scripts/run-night.ts` | `run-night --config <yaml>` CLI |
| `codeclimb/` | Config, keep rule and statistics, git, eval, coder, reviewer, results schema, tracing |
| `codeclimb/sandbox/` | `SandboxBackend` interface, Docker backend, and git-bundle transfer |
| `codeclimb/pi/` | Isolated Pi sessions and the read/write/edit/bash adapters that run inside the sandbox |
| `scenarios/datenorm/` | Spec bundle (`spec/`, the only thing the agent sees), hidden `dataset/`, `metrics/run.py` + `score.py`, and the `Dockerfile` |
| `configs/` | `datenorm-smoke.yaml` (2 rounds × 3 branches) and `datenorm.yaml` (a full night) |

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
- **Haiku 5.5 solves `datenorm` in round 1,** scoring 0.98–1.0 on the optimization folds. `configs/datenorm.yaml` (threshold 0.99) will usually stop after one round and one validation. A longer climb needs harder input families or a stricter threshold.
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
