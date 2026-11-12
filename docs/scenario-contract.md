# Scenario contract and the graphrag scenario

Agreed design, 2026-11-05. `scenarios/graphrag` began as a copy of scrabble's `datasets/graphrag` (commit `61cf63e1`); it belongs to codeclimb and is not synced back. It is now a 22-article cut of that dataset, tracked in git with its corpus and gold.

## Why the contract changes

datenorm is one program answering one query at a time, scored per item, with k-fold rotation of `train.jsonl`. graphrag differs on every axis:

- **Splits are fixed and time-ordered** (train, dev, test). Folds leak: a later document's gold reuses earlier documents' canonical names, so time-ordered folds hand earlier folds their answer key.
- **Three stages, each scored on gold input** (extraction, graph building, retrieval), each with at most three headline metrics; the smaller retrieval kinds are diagnostics. Retrieval must never be averaged across query kinds.
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
| Q6 | One experiment per round. Its weighted score decides the keep: each threshold metric's share of its threshold, capped at 1, weighted by the config's `weights`. It must beat the checkpoint's stored dev score by more than the measured noise, with no error, no empty predictions, `gates` passed and no held-out names in the diff. The reviewer decides nothing: it reviews every experiment, and its feedback goes to the next round, which restarts from the checkpoint. |
| Q7 | `thresholds` become floors on named headline metrics across stages (`extraction.mention_f1: 0.8`). A night stops when the kept commit's dev score passes all of them. `plateau`, `max_rounds`, `deadline`, `budget`, `tokens` stay. The 5-run noise measurement is removed; `ci95` and raw counts replace σ. |
| Q8, Q11 | The program calls models through the metering proxy, which forwards to OpenRouter directly (not through Pi), passing `response_format`, `seed` and embeddings through. The key stays on the host; every call is metered and capped by `allowed_models` and the night's budget (`budget_usd.night`). `timeouts.eval_min`: 30. |
| Q9, Q22 | After each experiment, before evaluation: a few-shot manifest (`fewshot.json`, train `doc_uri`s and query ids) must name train items only, and the repo must contain no dev/test `doc_uri` or query id. Either failure marks the branch `error`. Dev-only entity names found in the repo are reported to the reviewer, not failed. |
| Q10 | Every scenario has `corpus/`, `gold/` (with `splits.json`), `evaluators/`, `scripts/`, `spec/agent/`, `spec/evaluator/` and a `scenario.yaml` (stages and the agent's command per stage, the `inputs`/`score`/`summary` commands, the bundle export command, headline metrics with margins, Python dependencies). datenorm and capitals move to this layout; the old one is removed. |
| Q12, Q16 | `allowed_models` is a flat list; the coder decides which model serves which purpose: `openrouter/deepseek/deepseek-v4.1-flash`, `openrouter/typesafe/jev-1.14`, `openrouter/qwen/qwen3-embedding-4b`, `openrouter/qwen/qwen3-reranker-8b`. |
| Q13 | The reviewer reads `spec/evaluator/evaluate.md` and the README's Scoring section as its protocol, plus the `diagnostics` in `scenario.yaml`: regexes of the metrics that explain the headlines and never decide a keep. |
| Q14 | The baseline image installs the scenario's fixed `requirements.txt`; no `pip install` at eval time. The starter repo is the reference architecture of `spec/agent/task.md` wired end to end behind `python -m graphrag <stage> --root --inputs --out [--graph]`: extraction calls the chat model per section with the ontology as its prompt, graph building merges on name and alias keys, retrieval loads the gold graph into Ladybug and returns the anchors' neighbourhood. It imports only the image's packages. Amended 2026-11-09 from a stub CLI writing empty predictions, so the coder's first round is an extraction change, not plumbing. |
| Q15 | The night page shows a per-stage headline table (one column per headline metric with its `ci95`), a retrieval kind × metric heatmap, a convergence chart with a metric selector, and one test KPI per stage. |
| Q17 | No sync with scrabble. |
| Q19 | Superseded by the weighted score (Q6). `headline` in `scenario.yaml` lists the metrics each round reports; the per-metric margins and `override_limit` are gone. A loss in one threshold metric now costs the score as much as a gain elsewhere earns it. |
| Q20 | One evaluation sandbox per evaluation (Inngest caps a sandbox at 50 min). |
| Q21 | The checkpoint is not re-run: "below the parent" compares with the scores of its own evaluation, which saves one dev evaluation per round. Margins are the only protection against a lucky run. |
| Q23 | Accepted risk: the full gold graph (test included) enters the eval sandbox for retrieval, which has open egress on Inngest. It never reaches a coder or the reviewer. |

## Facts behind the picks

- `typesafe/jev-1.14`: $0.042/M in, $0/M out, 262k context. A decisions model: chat refuses it, and it takes `{state, questions}` on OpenRouter's alpha `/api/alpha/decisions` endpoint, whose shape may change. The proxy serves it at `POST /v1/decisions`. Absent from `/api/v1/models`; only `/api/v1/models/typesafe/jev-1.14/endpoints` lists it, so the model check uses the endpoints API. Cost comes from each response's `usage.cost`.
- Ranking uses embeddings plus `openrouter/qwen/qwen3-reranker-8b`, through the proxy's `POST /v1/rerank`.

## Repository check

`check` in `scenario.yaml` is an optional host command. After an experiment commits, `{repo}` holds its files and the command writes `{"errors": [], "notes": []}` to `{report}`. Errors keep the branch from being evaluated (its row is `error`, and the reviewer sees why); notes go to the reviewer. graphrag's `scripts/check_repo.py` implements Q9/Q22. It finds copied ids, not paraphrases or encoded ones: the reviewer still reads the diff.

## Text scan

`scan` in `scenario.yaml` is an optional host command. `{text}` is a file and the command writes `{"found": [...]}` to `{report}`, the held-out names it found as the text has them. It runs on all that reaches a coder and isn't the reviewer's own reading: the reviewer's keep reason, feedback and hypotheses, the errors of failed branches, each line of the round history and each rejected diff under `/spec/history`. The reviewer gets one rewrite of what it wrote; what survives, and any match elsewhere, becomes `[hidden]`. graphrag's `scripts/scan_text.py` uses the lists of `check_repo.py` plus the dev and test queries. It finds copies, not paraphrases.

## Lessons across nights

`lessons` in `scenario.yaml` is optional: the path, relative to the scenario dir, of the lessons.md inside the agent's spec. It is the only memory between nights, a scratchpad kept current rather than a log. A night's notes and reviews die with its bundle; lessons.md is how they reach the next night. When a night finishes or stops, `run-night` sends `codeclimb/night.finished`, and `distill-lessons` (one at a time per scenario) has the reviewer's model read the night's rounds past its last applied proposal: the notes under `/spec/history/notes` and the reviews, never `done.json`, a test evaluation or the review prompts.

The model sees lessons.md with its bullets numbered and returns ops on them: `add` a lesson, `edit` one (new text, a move to another heading, or both), `drop` one. A night that only repeats a lesson changes nothing; a lesson the night refines is edited; two that say one thing are merged by an edit and a drop; one the night shows wrong is dropped or edited, never left beside its opposite. Code applies the ops, so a lesson no op names stays byte for byte, and writes the file in its one layout (wrapped at 100 columns, an empty section left out).

Gates on what a coder reads: a lesson or heading passes `scan`, carries no decimal or percentage, and stays under 500 characters; the file holds at most 30 lessons and 200 lines; an `add` whose content words mostly match a lesson already there is a near-duplicate and is rejected unless the model marks it `distinct`; a heading the spec cites as (`lessons.md`, Heading) keeps at least one lesson; a new heading needs `new_section`. Rejected ops get one rewrite. When the night's ops would take the file past 200 lines, the model gets up to two prune rounds on the file renumbered, drops and shortening edits only, and cuts the lessons a later coder gains least from; a proposal still over 200 lines is never applied. Each op's reason, which no coder reads, may cite numbers and has held-out names masked; it is the evidence trail, kept in the proposal, and git history of lessons.md keeps the rest. A failure one night showed goes under "Failed once, not yet confirmed" until a later night repeats it: the model's call, since nothing counts nights.

The night config's `lessons` picks what happens: `propose` writes `lessons.md`, `changes.md` (each op beside the lesson it changes) and `proposal.json` to `runs-inngest/<results dir>/lessons/<night>-r<round>/`; `apply` (the default when the scenario declares lessons) also writes the scenario's lessons.md, unless it changed since the proposal or the result is over the line cap; `off` skips it. Apply never commits: `git diff` on lessons.md and each proposal's `changes.md` are the review, and `git restore` undoes one. A mock night never applies. `npm run lessons -- distill|apply` does the same by hand; a hand edit of lessons.md is fine as long as only `- ` bullets sit under its `## ` headings (a night's distill fails on anything else), and `format [--check]` puts it back in layout. `night.json` records the sha256 of the lessons.md each night's coders read.

## Open

- **`eval_min` limits a slow branch.** On Cloud at 16 minutes per stage, one branch's extraction timed out (`stage extraction: run timed out`, row `error`). The program's own speed is the coder's to fix; the reviewer now reads why a branch's eval failed.

- **Inngest sandboxes can't use a local `image`.** Their base image is Nix-built with no pip and no `libstdc++`, so numpy can't load there. `inngest_image` in `scenario.yaml` names the same image built for `linux/amd64` and published to the workspace (`docker save`, then `create-build`, upload, `commit-build`). A new `requirements.txt` needs a new tag.
- **`timeouts.eval_min` applies per stage**, so one graphrag candidate may take 3 × `eval_min`. `checkSandboxLimits` holds that product to Inngest's 50-minute cap, so `eval_min` is 16 at most there.

## Build order (one commit each)

1. Generic scenario contract: `scenario.yaml`, fixed splits, host-side stage runner, bundle export to `/spec`. datenorm converted and checked with a Docker night (still the old keep rule, thresholds read on dev).
2. graphrag on the contract: vendored key, requirements image, starter wired end to end (Q14); plumbing checked on train inputs.
3. OpenRouter proxy backend: direct forwarding, `response_format`, `seed`, embeddings, endpoints-API catalog check.
4. Reviewer-decided keep: guardrails, `evaluate.md` protocol, dev details, per-metric floors, noise runs removed.
5. Few-shot enforcement: manifest and id leak scan.
6. Report: per-stage tables, per-kind heatmap.
7. A short graphrag night on Docker, then on Inngest Cloud.
