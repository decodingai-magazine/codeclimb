# Evaluating the GraphRAG system

You are the third party who scores a system a coding agent built. The agent worked from a bundle
(`scripts/export_agent.py`): `spec/agent/`, the 4 train documents and their gold. It never saw dev
or test. Read `spec/agent/` first: it is everything the agent was given, and you hold it to that.
You may read everything else: `gold/`, the dataset `README.md` (Scoring has every matching rule and
known limit), and the agent's full work: code, transcripts, submissions.

You run the same protocol on two parts; only the part and what goes back differ:

| part | documents | queries | merge decisions | when | you read | what the agent gets back |
|---|---|---|---|---|---|---|
| train | 4 (2025-10-07 to 2025-11-18) | 19 | 4 | beside test, at the end | totals | nothing: it is the agent's own material |
| dev | 8 (2025-12-23 to 2026-05-05) | 41 | 8 | after each submission | totals and per-item errors | your feedback and each metric's change |
| test | 8 (2026-05-19 to 2026-09-10) | 61 | 7 | once, on the final submission | totals only | nothing until the final verdict |

Keep the two held-out parts apart:

- **Dev is the feedback part.** Run it after every submission, read its per-item errors, and turn
  them into feedback that names kinds of error, never a dev item, query, entity or document.
- **Test is the verdict part.** Run it once, on the frozen final submission. Never pass
  `--details`, never open its predictions or reports item by item, and never let a test number
  reach the agent or the feedback of any earlier round.
- **No crossing.** Nothing about test decides a keep or shapes feedback; dev numbers never stand in
  for test in the verdict. The final report sets train, dev and test side by side from one commit.

Retrieval always runs on `gold/graph.json`: the engine loads the gold graph, so retrieval numbers
measure retrieval alone and compare across systems; the agent's own graph is scored only by the
graph stage.

## Protocol

Run from this directory; `uv run` uses its `pyproject.toml`.

1. **Freeze.** Take the submission at one commit. Nothing changes after this step.
2. **Generate predictions** for the part, yourself, with the frozen system (`spec/agent/train.md`,
   What you submit). Never reuse the agent's prediction files.

   ```bash
   uv run python evaluators/<stage>.py inputs --split <part> --out runs/<commit>/<stage>/in-<part>.jsonl
   <agent command> <stage> --root runs/<commit>/root --inputs runs/<commit>/<stage>/in-<part>.jsonl --out runs/<commit>/<stage>/<part>.jsonl
   ```

   `runs/<commit>/root` holds a copy of `corpus/` and nothing else (`mkdir -p runs/<commit>/root &&
   cp -R corpus runs/<commit>/root/`), and the commands run from the agent's own checkout, never from
   this directory, so the system can't reach `gold/` through its root. Retrieval alone also takes
   `--graph gold/graph.json`, always the full gold graph.

   Graph inputs take `--mode gold-history` (the official mode; add an `end-to-end` run beside it
   if the agent asks). For test, also generate dev and train with the same commit, so the final
   report sets the three side by side from one system.
3. **Score once per stage.**

   ```bash
   uv run python evaluators/summary.py --stage <stage> --predictions-dir runs/<commit>/<stage> --out runs/<commit>/<stage>.summary.json
   ```

   `summary.py` needs `dev.jsonl` and scores `train.jsonl` and `test.jsonl` when present. Add
   `--mode` for graph and `--unranked` when the submission says its lists carry no order.
4. **On dev, read the report and write feedback.** The summary plus each stage's per-item errors:

   ```bash
   uv run python evaluators/<stage>.py score --split dev --predictions runs/<commit>/<stage>/dev.jsonl --out runs/<commit>/<stage>.dev-details.json --details
   ```

   Describe kinds of error. Send no dev item, gold file or test number.
5. **On test, never pass `--details`** (the CLIs refuse). Test totals are the result; the errors
   behind them stay unread, so test stays usable for the next system.

## Reading the report

For each `headline` metric:

- **`dev` against a second run.** For the final submission, generate dev twice; the two should
  match up to model nondeterminism. A clear gap means the system isn't reproducible: find out why
  before trusting anything else.
- **`train` is not evidence.** It is the few-shot material, so it scores high by construction. A
  train score far above dev says the system copies its examples rather than generalizing.
- **`gap` = test minus dev.** Every submission was shaped by dev reports, so some fit to dev is
  expected. For retrieval, a drop outside `dev_ci95` means the system was fit to dev; for
  extraction and graph, read a drop of more than a few points the same way. Test is later in time
  than dev, so a small drop on the graph stage is expected as new entities arrive.
- **Graph:** read `b_cubed.precision` and `b_cubed.recall` apart (a wrong merge is worse than a wrong
  split), and only the recall above `baselines.history_only.recall` measures merging. Dev holds 8
  merge decisions (about 12 points of `merge_decisions.rate` each), test 7 (about 14).
- **Retrieval:** per kind, never averaged across kinds. Read each kind's `subgraph_precision` beside
  its recall: recall bought by returning the neighbourhood shows up there. The `hard` difficulty is
  the structure tier: report it apart.

Precision of the numbers: dev has 2 to 11 queries per kind (`single_hop` 11, `temporal` 7,
`intersection` 7, `multi_hop` 5, `aggregation` 5, `comparison` 4, `unanswerable` 2); test has 2 to 15 queries per kind (`multi_hop` 15, `single_hop` 11,
`intersection` 11, `temporal` 8, `aggregation` 7, `comparison` 7, `unanswerable` 2). A
pass/fail metric near 0.5 has a 95% interval of about ±25 points at 15 rows and ±35 at 8. Read the
`ci95` the report gives; two systems whose intervals overlap are not separated.

## Checks on the agent's work

Each is a pass or a fail with the evidence (a path, a command, a transcript line):

- **Worked from its bundle only.** No path outside the bundle in its code, configs or transcripts:
  not this directory, `gold/`, `evaluators/`, `spec/evaluator/` or `README.md`.
- **The system reads only its arguments.** Its commands take `--root`, `--inputs`, `--out` and, for
  retrieval, `--graph`, and read nothing else. The graph given to retrieval is loaded only by the
  retrieval stage: in extraction or graph-building code, prompts or few-shot material it is a leak
  (it holds the gold extraction and resolution of every document, test included).
- **Few-shot material is train only.** Every example in the agent's prompts and configs traces back
  to the bundle's `train/examples/`, and `fewshot.json` records the train ids it uses. `check_repo.py`
  enforces the ids before evaluation; a row copied from a dev report into a prompt is still a fail.
- **No hard-coded answers.** No gold entity names, query ids, or per-query rules in the code. Dev
  names copied from a dev report into a prompt fit dev: report them, and expect them in the `gap`.
- **Reproducible.** One command per stage rebuilds the predictions from the inputs.

## What the metrics don't measure

Judge these apart and say so:

- **Cost and latency**: per document for extraction and building, per query for retrieval, and the
  `passage_tokens` the envelopes report.
- **Code**: whether a stage could be swapped without touching the others.
- **Not measurable from this gold**: `count`, `confidence`, `domain`, `released`, `country`, and
  `description` (needs a judge). The coined labels need a judge too. The anchor-rarity and BM25-miss
  retrieval slices are not wired.
