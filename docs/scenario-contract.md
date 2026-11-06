# Scenario contract and the graphrag scenario

Agreed design, 2026-11-05. `scenarios/graphrag` is a copy of scrabble's `datasets/graphrag` (commit `61cf63e1`); from here on it belongs to codeclimb and is not synced back. Its `corpus/` and `gold/` stay out of git, because this repository is public: they exist only on machines that hold a local copy.

## Why the contract changes

datenorm is one program answering one query at a time, scored per item, with k-fold rotation of `train.jsonl`. graphrag differs on every axis:

- **Splits are fixed and time-ordered** (train, dev, test). Folds leak: a later document's gold reuses earlier documents' canonical names, so time-ordered folds hand earlier folds their answer key.
- **Three stages, each scored on gold input** (extraction, graph building, retrieval), each with several headline metrics. Retrieval must never be averaged across query kinds.
- **The evaluators are the dataset's own Python CLIs** (`inputs`, `score`, `summary`), not text.
- **The program is a batch CLI per stage** that calls models (`<cmd> <stage> --root --inputs --out [--graph]`).

## Decisions

| # | Decision |
|---|---|
| Q1 | One night optimizes the whole system: all three stages are scored every round. |
| Q2 | Fixed train/dev/test replaces folds for every scenario. Dev is scored every round, test once at the end. The held-out-fold validation and overfit rotation are removed; the test-minus-dev gap is reported. datenorm and capitals are converted. |
| Q3 | The dataset's evaluators run unmodified on the host. On the host `<stage>.py inputs --split dev` builds the stage input; the eval sandbox gets the input, a root holding only `corpus/` and, for retrieval, the gold graph; it runs the agent's stage command; `<stage>.py score` runs on the host. Evaluators run through `uv` with a scenario-local `pyproject`. pulse's `_normalize` is vendored into `scripts/`. |
| Q4 | Coder sandboxes get the agent bundle from `scripts/export_agent.py` at `/spec`: `spec/agent/`, the train articles, train's gold graph, train examples and inputs per stage. Built at night start; the night fails if its leak check fails. Few-shot examples may come from train only. |
| Q5 | The reviewer gets the full dev report, per-item errors included (`--details`). Coders get guidance through the reviewer only. Test is never detailed. |
| Q6 | One experiment per round. The reviewer keeps or reverts it, with a reason, if it passes mechanical guardrails: no error, no empty predictions, `gates`, and no hard regression (Q19). It reads each headline metric equally, against the checkpoint's stored dev scores. It also reviews what it can't keep: its feedback goes to the next round, which restarts from the checkpoint. |
| Q7 | `thresholds` become floors on named headline metrics across stages (`extraction.mention_f1: 0.8`). A night stops when the kept commit's dev score passes all of them. `plateau`, `max_rounds`, `deadline`, `budget`, `tokens` stay. The 5-run noise measurement is removed; `ci95` and raw counts replace σ. |
| Q8, Q11 | The program calls models through the metering proxy, which forwards to OpenRouter directly (not through Pi), passing `response_format`, `seed` and embeddings through. The key stays on the host; every call is metered and capped by `allowed_models` and `budget_usd.eval` (2). `timeouts.eval_min`: 30. |
| Q9, Q22 | After each experiment, before evaluation: a few-shot manifest (`fewshot.json`, train `doc_uri`s and query ids) must name train items only, and the repo must contain no dev/test `doc_uri` or query id. Either failure marks the branch `error`. Dev-only entity names found in the repo are reported to the reviewer, not failed. |
| Q10 | Every scenario has `corpus/`, `gold/` (with `splits.json`), `evaluators/`, `scripts/`, `spec/agent/`, `spec/evaluator/` and a `scenario.yaml` (stages and the agent's command per stage, the `inputs`/`score`/`summary` commands, the bundle export command, headline metrics with margins, Python dependencies). datenorm and capitals move to this layout; the old one is removed. |
| Q12, Q16 | `allowed_models` is a flat list; the coder decides which model serves which purpose: `openrouter/deepseek/deepseek-v4.1-flash`, `openrouter/typesafe/jev-1.14`, `openrouter/qwen/qwen3-embedding-4b`, `openrouter/qwen/qwen3-reranker-8b`. |
| Q13 | The reviewer reads `spec/evaluator/evaluate.md` and the README's Scoring section as its protocol, plus the `diagnostics` in `scenario.yaml`: regexes of the metrics that explain the headlines and never decide a keep. |
| Q14 | The baseline image installs the scenario's fixed `requirements.txt`; no `pip install` at eval time. The starter repo is a stub CLI, `python -m graphrag <stage> --root --inputs --out [--graph]`, writing empty predictions. |
| Q15 | The night page shows a per-stage headline table (one column per headline metric with its `ci95`), a retrieval kind × metric heatmap, a convergence chart with a metric selector, and one test KPI per stage. |
| Q17 | No sync with scrabble. |
| Q19 | Hard-regression margins per headline metric, in `scenario.yaml`: extraction F1s 0.02, graph B-cubed recall 0.02, graph B-cubed precision 0 (any drop fails), retrieval its own `ci95`. |
| Q20 | One evaluation sandbox per evaluation (Inngest caps a sandbox at 50 min). |
| Q21 | The checkpoint is not re-run: "below the parent" compares with the scores of its own evaluation, which saves one dev evaluation per round. Margins are the only protection against a lucky run. |
| Q23 | Accepted risk: the full gold graph (test included) enters the eval sandbox for retrieval, which has open egress on Inngest. It never reaches a coder or the reviewer. |

## Facts behind the picks

- `typesafe/jev-1.14`: $0.042/M in, $0/M out, 262k context. A decisions model: chat refuses it, and it takes `{state, questions}` on OpenRouter's alpha `/api/alpha/decisions` endpoint, whose shape may change. The proxy serves it at `POST /v1/decisions`. Absent from `/api/v1/models`; only `/api/v1/models/typesafe/jev-1.14/endpoints` lists it, so the model check uses the endpoints API. Cost comes from each response's `usage.cost`.
- Ranking uses embeddings plus `openrouter/qwen/qwen3-reranker-8b`, through the proxy's `POST /v1/rerank`.

## Repository check

`check` in `scenario.yaml` is an optional host command. After an experiment commits, `{repo}` holds its files and the command writes `{"errors": [], "notes": []}` to `{report}`. Errors keep the branch from being evaluated (its row is `error`, and the reviewer sees why); notes go to the reviewer. graphrag's `scripts/check_repo.py` implements Q9/Q22. It finds copied ids, not paraphrases or encoded ones: the reviewer still reads the diff.

## Text scan

`scan` in `scenario.yaml` is an optional host command. `{text}` is a file and the command writes `{"found": [...]}` to `{report}`, the held-out names it found as the text has them. It runs on all that reaches a coder and isn't the reviewer's own reading: the reviewer's feedback and hypotheses, and the errors of failed branches. The reviewer gets one rewrite of what it wrote; what survives, and any match in an error, becomes `[hidden]`. graphrag's `scripts/scan_text.py` uses the lists of `check_repo.py` plus the dev and test queries. It finds copies, not paraphrases.

## Open

- **`eval_min` limits a slow branch.** On Cloud at 16 minutes per stage, one branch's extraction timed out (`stage extraction: run timed out`, row `error`). The program's own speed is the coder's to fix; the reviewer now reads why a branch's eval failed.

- **The night page shows Q15; `report.html` doesn't.** The static report still shows one primary metric, and no stage tables.

- **Inngest sandboxes can't use a local `image`.** Their base image is Nix-built with no pip and no `libstdc++`, so numpy can't load there. `inngest_image` in `scenario.yaml` names the same image built for `linux/amd64` and published to the workspace (`docker save`, then `create-build`, upload, `commit-build`). A new `requirements.txt` needs a new tag.
- **`timeouts.eval_min` applies per stage**, so one graphrag candidate may take 3 × `eval_min`. `checkSandboxLimits` holds that product to Inngest's 50-minute cap, so `eval_min` is 16 at most there.

## Build order (one commit each)

1. Generic scenario contract: `scenario.yaml`, fixed splits, host-side stage runner, bundle export to `/spec`. datenorm converted and checked with a Docker night (still the old keep rule, thresholds read on dev).
2. graphrag on the contract: vendored key, requirements image, stub CLI; plumbing checked on train inputs.
3. OpenRouter proxy backend: direct forwarding, `response_format`, `seed`, embeddings, endpoints-API catalog check.
4. Reviewer-decided keep: guardrails, `evaluate.md` protocol, dev details, per-metric floors, noise runs removed.
5. Few-shot enforcement: manifest and id leak scan.
6. Report: per-stage tables, per-kind heatmap.
7. A short graphrag night on Docker, then on Inngest Cloud.
