# Your bundle, and how your system is evaluated

The articles are split by time into three parts. You get **train**; dev and test stay with a
third-party evaluator, who runs your frozen system on them:

| part | documents | you get |
|---|---|---|
| train | the first 12 (2025-09-25 to 2025-11-26): 192 mentions, 211 relations, 10 merge decisions, 30 retrieval queries | the documents and all their gold, in this bundle |
| dev | the next 25 (2025-12-02 to 2026-05-12): 90 retrieval queries | the evaluator's report after each submission, errors included |
| test | the last 19 (from 2026-05-19) | nothing until the end: it is scored once, totals only |

## The bundle

| path | what |
|---|---|
| `spec/` | `task.md`, `ontology.md`, `runtime.md` (how codeclimb runs your system) and this file |
| `corpus/` | the 12 train articles, one markdown file each |
| `train/graph.json` | the gold graph of the train articles: `documents`, `entities`, `relationships` (`mentions`, `related_to`) |
| `train/examples/<stage>.jsonl` | train's gold for each stage, below |
| `train/inputs/<stage>.jsonl` | exactly what the evaluator hands each stage, for train |
| `scorer/` | the official scorers, on train alone, below |

`<stage>` is `extraction`, `graph` or `retrieval`. Nothing outside the bundle is yours to read.

## Scoring your work on train

Run your stage on `train/inputs/<stage>.jsonl`, then score its output with the evaluator's own code,
so your numbers mean what the feedback's numbers mean:

```bash
export PYTHONPATH=/spec/scorer/vendor
python /spec/scorer/evaluators/extraction.py score --split train --predictions out.jsonl --out report.json --details
python /spec/scorer/evaluators/graph.py score --split train --mode gold-history --predictions out.jsonl --out report.json --details
python /spec/scorer/evaluators/retrieval.py score --split train --predictions out.jsonl --out report.json --details
```

`--details` adds the per-item errors. Your system can't use this directory: the evaluator doesn't
have it. Train is few-shot material, so a score here is a check on the code, not a forecast of dev.

## Few-shot examples

Sample from `train/examples/` freely:

- **`extraction.jsonl`:** each train document with its `known_entities` and its gold
  `entity_mention` and `related_to` rows, in the format `task.md` asks you to write (with
  `confidence`; a row whose label is a descriptive one the article never writes carries
  `coined: true`; train has none, dev 6 and test 4).
- **`graph.jsonl`:** the train log with every merge decision it holds (`same_as` rows, 10 of them).
- **`retrieval.jsonl`:** the 30 train queries with their `kind`, `difficulty`, `origin` (`graph` or
  `text`), `expected` nodes (each with a `role`: `anchor`, `bridge` or `answer`), edges (each with
  the `doc_uri` it was read from) and documents. Every one is answered by
  the train articles alone, so the mix leans on what 12 articles hold: 12 `single_hop`, 6
  `temporal`, 4 `comparison`, 4 `intersection`, 2 `unanswerable`, 1 `multi_hop`, 1 `aggregation`.
  Dev and test hold every kind, three-hop paths included.

**Why train is the earliest part:** gold rows reuse the canonical name from the first document that
named the entity, so a later document's rows would reveal earlier documents' answers. Train comes
first, so its gold reveals nothing about dev or test.

Which train items a run uses is a setting of the system, not a constant in the code. Record the ids
it uses in `fewshot.json` at the repository root, even if there are none:
`{"doc_uris": [...], "query_ids": [...]}`. A branch with a missing or wrong manifest, or with any dev
or test `doc_uri` or query id anywhere in the repository, is not evaluated.

## What you submit

A frozen system (one commit) with one command per stage, which the evaluator runs on each part:

```bash
<your command> extraction --root <dir> --inputs <file> --out <file>
<your command> graph      --root <dir> --inputs <file> --out <file>
<your command> retrieval  --root <dir> --inputs <file> --out <file> --graph <graph.json>
```

`--root` is the directory holding `corpus/` (your bundle; the full dataset when evaluated); every
`path` in an input file is relative to it. `--graph` is the gold graph retrieval loads. The command
reads nothing else, and writes one prediction line per input item. `/spec` doesn't exist when
evaluated, and `--root` holds only `corpus/`: copy any few-shot rows the system uses into your
repository, and list them in `fewshot.json`. Run it on `train/inputs/` to
check it end to end: that run checks the plumbing, not the quality, because train is your few-shot
material and scores high by construction.

**Why one command per stage:** each stage is scored on gold input, so an error is charged to the
stage that made it (`task.md`, The pipeline).

## Inputs and predictions

Predictions are checked against a fixed schema. **A field not listed here fails the stage, and with
it the whole submission**, even if every other row is right. Extra data belongs in your own files.

| row | allowed fields |
|---|---|
| `entity_mention` | `kind`, `doc_uri`, `name`, `type`, `aliases`, `description`, `properties`, `count`, `confidence` |
| `related_to` | `kind`, `doc_uri`, `source_name`, `target_name`, `semantic_type`, `source_type`, `target_type`, `confidence` |
| graph line | `surface_id`, `entity_id` |
| envelope | `id`, `nodes`, `edges`, `docs`, `passage_tokens` |
| envelope node | `type`, `name`, `aliases`, `score` |
| envelope edge | `source`, `target`, `semantic_type`, `score` |
| envelope document | `doc_uri`, `score` |

The rows in `train/examples/` are gold, not predictions, and carry more fields: an expected edge has
a `doc_uri`, and an expected node a `role`. Write predictions from this table, not from those rows.

### Extraction

Input, one line per document, in order:

```json
{"doc_uri": "…", "path": "corpus/….md", "title": "…", "published": "2026-02-03",
 "known_entities": [{"type": "tool", "name": "Claude Code", "aliases": ["claude code"]}]}
```

`known_entities` are the gold entities of every earlier document of the dataset. You may reuse
their names (`task.md`, 1. Extraction).

Predictions: your rows, one per line, as in `task.md`. A predicted mention matches a gold row of the
same document when the types are equal and the key of any of its names or aliases equals the key of
any of the gold row's; each gold row matches once. A relation's ends resolve to your mentions of the
same document by key, then must match the gold row's two ends.

### Graph building

Input: log rows, each tagged with `part` (`history` or `held_out`): `document` rows (the document's
metadata; `path` relative to `--root`), `entity_mention` rows (with `surface_id`), `related_to` rows
(whose `source_id` and `target_id` are surface ids), and `same_as` rows (`from_id` is the same
entity as `to_id`, with a `reason` of `name_key`, `alias_key` or `ruling`, and a `why` on rulings;
rulings have `doc_uri: null`). In order:

1. the history rows: every document before the held-out part, as gold (none for train; train for
   dev; train and dev for test);
2. the history's merge decisions;
3. the held-out rows, without their merge decisions.

Apply the history first, all of it (its rulings carry a high `seq` because the log appends them
after every document); then resolve the held-out rows in `seq` order on top of it.

Predictions, one line per surface, giving the entity you folded it into:

```json
{"surface_id": "tool:9cf0786…", "entity_id": "my-entity-17"}
```

`entity_id` strings are yours; only which surfaces share one matters. A missing held-out surface is
its own entity; a missing history surface keeps the given history.

### Retrieval

Input: `{"id", "query"}` per line. Predictions: one envelope per query (`task.md`, 3. Retrieval). A
missing envelope counts as empty. If your lists carry no order, say so with the submission: the
evaluator then drops the metrics that read order.

## Feedback

After each submission the evaluator sends the dev report for every stage: each primary metric
(`task.md`, What you're optimizing) with a bootstrap interval for retrieval, retrieval per `kind`,
`difficulty` and `origin`, and the per-item errors (missed and false rows, wrong merges, per-query
metrics). Use it to decide what to change; every change is a new submission, scored fresh. A
dev report is feedback, never an example: every few-shot example stays from `train/examples/`.

- **Every choice made on dev fits dev a little.** The final report sets test beside dev; the gap
  between them shows how much.
- **Few merges.** Dev holds 23 merge decisions, so one decision moves merge recall by about 4
  points. Read the raw counts beside the rate.
- **Retrieval is per kind.** Never average across kinds: they test different abilities.
