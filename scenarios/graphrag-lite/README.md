# GraphRAG evaluation dataset, lite cut

A lighter copy of `../graphrag`: 22 of its 56 articles, 6 train, 8 dev and 8 test, with their gold
and the 130 retrieval queries they still answer. The format, scripts, evaluators and scoring are the
full dataset's; only `corpus/`, `gold/` and the counts in `spec/` differ. Sections after this one
are the full dataset's README: their counts describe the 56 articles, not this cut.

## Lite cut

Written by `../graphrag/scripts/lite.py` (its docstring has the rules); the chosen documents are in
`../graphrag/gold/lite-docs.json`:

```bash
cd ../graphrag
uv run python scripts/lite.py select --train 6 --dev 8 --test 8 --min dev:multi_hop:10 \
  --pin test --pin-from gold/lite-docs.json --out gold/lite-docs.json
uv run python scripts/lite.py build --docs gold/lite-docs.json --out ../graphrag-lite
```

- **Selection.** Each part's documents come from the same part of the full dataset, so the cut
  keeps the time order. A set is scored jointly: the queries it keeps (hard counts most), the
  `kind` x `difficulty` strata each part covers, the extraction load, the merge decisions, and the
  extraction traps each part covers (alias-only rows, merged variants, coined labels, kept-apart
  siblings, names typed twice, ruled aliases, renames, retypes, dropped tool-like names in the body,
  isolated mentions, every entity type). Greedy, then one-for-one swaps. Dev must keep at least
  10 `multi_hop` queries, so one query moves that metric by at most 10 points. Test is pinned to
  the first cut's 8 documents, so later cuts keep its scores comparable.
- **Log.** The kept documents' rows. Identity is the full dataset's: each full entity, restricted
  to its kept surfaces, stays one entity. Original `same_as` rows whose two surfaces survive are
  kept; a chain broken by a dropped surface is rejoined to the entity's root.
- **Graph.** `scripts/compile.py` over that log.
- **Queries.** Path rows (`multi_hop`, `intersection`) stay only when every document survives;
  the other kinds keep the expected items in kept documents. Names move to the lite canonical name,
  difficulty is recomputed, and every row passes `scripts/retrieval_gold.py check`. Two
  `unanswerable` rows per part. Queries keep their original part.

| part | documents | mentions | relations | merge decisions | queries (easy / medium / hard) |
|---|---|---|---|---|---|
| train | 6 (2025-10-07 to 2025-11-18) | 144 | 180 | 7 | 29 (13 / 13 / 3) |
| dev | 8 (2026-01-13 to 2026-05-12) | 373 | 455 | 9 | 46 (16 / 21 / 9) |
| test | 8 (2026-05-19 to 2026-09-10) | 475 | 614 | 6 | 55 (16 / 26 / 13) |

Extraction traps per part (mention rows; `not_a_tool` counts dropped tool-like names in the bodies):

| part | alias-only | merged variant | coined | kept-apart sibling | typed twice | ruled alias | renamed | retyped | not a tool | isolated | types |
|---|---|---|---|---|---|---|---|---|---|---|---|
| train | 3 | 11 | 2 | 13 | 1 | 2 | 3 | 1 | 55 | 7 | 6 of 6 |
| dev | 24 | 17 | 7 | 5 | 5 | 3 | 2 | 0 | 89 | 20 | 6 of 6 |
| test | 41 | 14 | 5 | 13 | 13 | 7 | 5 | 4 | 117 | 12 | 6 of 6 |

Test's documents are the first cut's, but 6 of its queries left with the dev documents their
paths needed, and a merge moved to history. The
`spec/agent/` examples were re-picked for this cut: every example entity is one the lite train
articles write, every example query is a lite train query, and the rest are marked *invented*
(`Kestrel`, `Lumen Weekly`, `ReportWriter`, `FactChecker`, `Atlas Bot`). Names that still match
dev or test entities are the spec's own vocabulary (`embedding`, `ontology`, `Cypher`, `Bash`),
as in the full dataset.

## The full dataset

56 Decoding AI articles with a gold extraction, a gold entity resolution, a gold graph and 230 gold
retrieval queries. They score a GraphRAG system's three stages separately: extraction, graph
building and retrieval. Paths are relative to this directory; run every command with `uv run python …`, which uses this
directory's `pyproject.toml`. The key function's base, Pulse's `_normalize`, is vendored in
`scripts/pulse_normalize.py`.

This README is for whoever maintains the dataset or judges a system. A coding agent building a
system gets only the bundle `scripts/export_agent.py` writes: `spec/agent/`, the train documents and
their gold. This directory holds dev and test, so the agent never works in it.

## Layout

```
corpus/       the input: 56 articles, frontmatter plus body, sponsor/promo/trailer sections removed
gold/         the answers; the agent sees only train's slice, through its bundle
  log.jsonl       every extracted observation, append-only, in ingest order: the one source of truth
  graph.json      the graph compiled from the log: documents, entities, relationships
  rulings.json    the curation decisions behind the log, each with a `why`
  retrieval.jsonl 230 retrieval queries with the nodes, edges and documents each expects
  splits.json     the train/dev/test split, for documents and retrieval queries
spec/
  agent/          the spec in the agent's bundle: ontology.md (also the extractor's prompt), task.md, train.md, runtime.md, lessons.md
  evaluator/      the third-party evaluator's protocol, for dev and test: evaluate.md
evaluators/   one CLI per stage (extraction.py, graph.py, retrieval.py), summary.py over all split
              parts, common.py shared by them: they load the gold themselves and write JSON reports
scripts/      maintenance: compile.py (log → graph.json), split.py (→ splits.json),
              retrieval_gold.py (check and seed the retrieval queries), export_agent.py (→ the agent's bundle)
```

| folder | who reads it | changes when |
|---|---|---|
| `corpus/` | the evaluator, maintainers; the agent's bundle has the train articles | never; a new article means a new dataset version |
| `gold/` | evaluators, scripts, maintainers; the evaluated system's retrieval stage loads `graph.json` | a curation fix: edit `log.jsonl` and `rulings.json`, then re-run the scripts |
| `spec/agent/` | the coding agent, through its bundle | the ontology or the task changes; keep its examples from train documents, or invented |
| `spec/evaluator/` | the evaluator | the protocol changes |
| `evaluators/` | the evaluator | a metric changes |
| `scripts/` | maintainers | the gold format changes |

## Quick start

```bash
# rebuild gold/graph.json from the log, then the splits, then check every retrieval query
python scripts/compile.py
python scripts/split.py
python scripts/retrieval_gold.py check

# the coding agent's bundle: spec/agent/, train documents, train gold, train inputs
python scripts/export_agent.py --out <new dir>

# what a system gets for one part, and its score (the evaluator's commands)
python evaluators/extraction.py inputs --split dev --out in.jsonl
python evaluators/extraction.py score  --split dev --predictions pred.jsonl --out report.json

# every part of one stage in one report: dev.jsonl, optional train.jsonl and test.jsonl
python evaluators/summary.py --stage graph --predictions-dir runs/v3 --out runs/v3/summary.json
```

## Ontology

The full rules are `spec/agent/ontology.md`, which is also the extractor's prompt. In short:

- **Two node kinds:** documents (one per `corpus/` file) and entities.
- **Six entity types**, tested in order: `person` (a named human), `organization` (a body that makes
  things), `model` (named weights), `tool` (a named piece of software you could install, open or sign
  up for), then `system` (a kind of software you ship) and `method` (a practice: a technique,
  pattern, model class, benchmark, metric or failure mode).
- **Two relationship types:** `mentions` (document → entity, the document engages with it) and
  `related_to` (entity → entity, a directed claim the document makes, with a free-form
  `semantic_type` such as `uses`, `part_of`, `develops`). A relationship never spans documents.
- **What is extracted:** only entities the body engages with (explains, uses, builds with,
  compares, takes a position on). A name in a list, link, aside, plug, image credit or sample data is
  not. No frequency floor.
- **Not a tool:** things that look like tools are never extracted, under any type: a function an
  agent calls (`web_fetch`), a code symbol (`StateGraph`), an agent role (`PlanningAgent`), a file
  (`CLAUDE.md`), a command (`/compact`), a script, hook or skill (`/grill-me`), a product feature
  (Opik's `Diagnostics`), an internal component (`Weave stack`), a course or book (`LLM Engineer's
  Handbook`). The software they belong to is extracted instead.
- **Identity:** one entity per referent. An alias is another surface of the same referent (`LLM`
  and `Large Language Model`, `harness` and `harnesses`). A version, a broader or narrower term, or
  a practice's artifact is a second entity (`gemini-1.5-flash` vs `gemini-2.5-flash`, `traces` vs
  `tracing`). Type is part of identity, and similar spelling is not identity (`pass@k` ≠ `pass^k`).

**Two copies of the examples.** The summary here and the gold use examples from the whole corpus.
`spec/agent/` uses only entities that train documents mention, plus names marked *invented* where
train has no instance (a file, a command, a script, an internal component), and its query examples
are train queries. Rule text is unchanged. Rules left without an example: named hardware as a
`tool`, a code constant, environment variable or error as a code symbol, and a mechanism a product
runs.

## Gold data

### `gold/log.jsonl`

Append-only, ordered by `seq`. No row's content is ever rewritten (keys may be renamed), and nothing
is merged in the log: merging happens only when the graph is compiled. Four kinds:

```json
{"seq": 0, "kind": "document", "doc_uri": "…", "observed_at": "2025-09-25", "source_id": "…",
 "title": "…", "type": "rss", "published": "2025-09-25", "length": 2611, "origin_id": "decodingai.com",
 "origin_kind": "newsletter", "author": "Paul Iusztin", "domain": ["ai_engineering"], "path": "corpus/….md"}
{"seq": 1, "kind": "entity_mention", "doc_uri": "…", "observed_at": "2025-09-25", "surface_id": "tool:…",
 "name": "Claude Code", "type": "tool", "aliases": [], "description": "…", "count": 4,
 "confidence": 0.95, "properties": {"released": null}}
{"seq": 2, "kind": "related_to", "doc_uri": "…", "observed_at": "2025-09-25", "source_id": "organization:…",
 "target_id": "tool:…", "source_name": "Anthropic", "target_name": "Claude Code",
 "semantic_type": "develops", "confidence": 0.9}
{"seq": 45, "kind": "same_as", "doc_uri": "…", "observed_at": "2025-10-07", "from_id": "system:…",
 "to_id": "system:…", "reason": "name_key"}
```

- **`document`** opens each document's block. Every document has one, including the two with no
  mentions (`thank-you`, a 311-character note). Its `source_id` is the corpus file name; the
  `related_to` row's `source_id` is unrelated (the source end of the claim).
- **`entity_mention`** is what the extractor reported for one entity in one document, after review.
  `surface_id` = `{type}:{sha1(type + "\x00" + name)[:16]}`: it identifies the surface, not the
  entity, so `LLMs` and `LLM` get two ids. An entity has at most one row per document.
- **`related_to`** is one directed claim between two mentions of the same document.
- **`same_as`** is one identity decision: `from_id` is the same referent as `to_id`. Reasons:
  `name_key` (the keys match: `LLMs` → `LLM`), `alias_key` (the key matches an alias claimed
  earlier: `RAG` → `Retrieval-Augmented Generation`) and `ruling` (a curated merge, with `why`).
  The first two follow the document that triggered them; rulings come after every document, with
  `doc_uri: null`. A surface with no `same_as` row is its own entity.
- **Totals:** 56 documents, 2,065 `entity_mention` rows, 2,546 `related_to` rows, 47 `same_as` rows
  (20 `name_key`, 11 `alias_key`, 16 `ruling`).

### Corrections to the extraction

The rows are reviewed extractor output. Each document was extracted with the names of earlier
documents in view, which shapes them:

- **A row's `name` is usually the entity's canonical label; the document's own wording is always
  among its `name` and `aliases`.** 31 surfaces (60 rows) keep their own variant instead (`RAG`,
  `LLMs`, `AI agent`) and are joined by a `name_key` or `alias_key` merge. In 149 rows the name is absent from the body and only an alias matches it; in
  132 of them the name comes from an earlier document (`Retrieval-Augmented Generation` in a
  document that writes only "RAG", `hallucination` where it writes "hallucinates"). So a mention is
  matched by any name or alias, never by `name` alone.
- **Aliases are per document.** 677 rows carry aliases; 845 of their 846 aliases occur in the row's
  own body. Joining surfaces across documents is the builder's job.
- **Coined labels.** When a document describes a method or system without naming it, the row
  carries a short descriptive label. 10 rows: `train/dev/test split` (×2), `regex parsing`,
  `organizing by type`, `organizing by actionability`, `file-backed memory`,
  `system-prompt-level mocking`, `semantic search` (from "semantic and text search"),
  `human-in-the-loop` (×2: "the human is in the loop", "leave uncertainty to a human"). Three more
  rows paraphrase their article (`structured extraction`, `unstructured extraction`, one `agent
  loop`) without a coined-label ruling.

(Counts above match by key against the body with markdown code backticks removed; see Problems and
learnings.)

The review applied eight kinds of correction. Its counts (rows dropped, added, retyped) are from the
review log and can't be recomputed from the current log, which holds only the result; 19 + 68 = 87
`applied_to` rows today is the one that can be cross-checked:
1. **Retype:** a `ZTRON` row from `tool` to `organization`.
2. **Rename** where the reused name was a different entity: `autonomous loop` → `agent loop` in 8
   documents that only write "agent loop"; `sandbox` → `sandboxing` where it means the practice;
   `tool calling` → `tool call` where it means one invocation.
3. **Added alias:** the document's own wording when missing (`DBOS` on `DBOS, Inc.`).
4. **Removed alias claims:** narrowing claims; a name another entity of the type already owns;
   claims ruled wrong (`workflow` on `AI workflow`, `multi-agent architectures`, a `method`, on the
   `system` `multi-agent system`).
5. **Dropped rows** that are not entities (Not a tool): 241 `entity_mention` rows, 367 `related_to`
   rows, 184 entities. `Bash` survives in the two documents where it means the shell.
6. **`related_to` rows checked against each article:** the extractor under-connected (`pass@k`
   related to `AI agents` but not to `AI Evals` in the article that introduces it as an eval
   metric). 578 rows added, each backed by a verbatim span, with a label already in use and
   `confidence: 1.0`. Two removed because both ends are one entity (`error analysis part_of error
   analysis framework`, `microcompact implements microcompaction`).
7. **Precision and recall review** of every article:
   - 149 mentions added in review (unrelated to the 149 alias-only rows above), each with a verbatim span (`unit tests`, `rubric`, `system prompt`), `confidence:
     1.0`; 40 are new entities;
   - 52 dropped for no engagement or Not a tool (`@tool decorator`, `MongoDBGraphStore`), 11 of
     them agent roles that took 26 `related_to` rows along (Plan-and-Execute's `Planner`,
     `Evaluator`, `Executor`; Brown's `Reviewer`, `Editor`; Squid's six agents);
   - 12 retyped: `serving layer` to `system`, `auto-memory` to `method`, and `LangChain`,
     `LlamaIndex`, `Neo4j` to `organization` where the company itself acts, so those three keep a
     `tool` entity too;
   - 383 `related_to` rows added, 6 dropped as unsupported, reversed or mis-targeted (`Alejandro
     Aboy avoids synthetic data`, `OpenAI uses Modal`).

   81 mentions have no `related_to` row: entities their article never relates to another.
8. **One label per claim:** 19 `applies_to` rows rewritten as `applied_to`, the label 68 rows already
   used. Every other `semantic_type` is as the extractor wrote it.

### Identity

#### The normalized key

Resolution and alias cleaning compare `key(name)`, never the raw string; compiling the graph never
uses it (the `same_as` rows already record every decision). The gold key is `normalize` in
`scripts/compile.py`: acronym plurals folded, symbols spelled as words, then Pulse's normalizer,
tokens joined by `-` (`We use LLMs and tool-calling` → `we-use-llm-and-tool-calling`). Any function
that meets these requirements and passes the checks works:

1. **Matching only.** Names keep the surface the extractor wrote.
2. **Case-insensitive** (`JSON schema` = `JSON Schema`), except that case may decide a plural.
3. **Separator-insensitive:** `tool calling` = `tool-calling`, `url_context` = `url context`.
4. **Plural-insensitive, conservatively:** `AI agents` = `AI agent`, `harnesses` = `harness`,
   `LLMs` = `LLM`, `KGs` = `KG`; but `class`, `analysis`, `focus` stay, and `HTTPS` ≠ `HTTP`.
5. **Meaningful symbols stay distinct:** `&` reads `and`; `pass@k` ≠ `pass^k`, `C#` ≠ `C`,
   `memory/` ≠ `memory`, `$text` ≠ `text`.
6. **Numbers and versions stay distinct:** `gemini-1.5-flash` ≠ `gemini-2.5-flash`; `GPT-4s` is
   not folded onto `GPT-4`.
7. **An empty key matches nothing**, not even another empty one (`---`).
8. **Deterministic, idempotent, corpus-independent:** `key(key(x)) == key(x)`.
9. **One key everywhere, compared within one type.**

Checks against this dataset (each holds): every `name_key` pair has equal keys (20 pairs); within a
type no key is shared by two entities of `gold/graph.json`, names and aliases together (813
entities, 0 shared keys); no name or alias keys empty; the key is idempotent on every mention name.
A stricter key fails the first check, a looser one the second.

#### Narrowing

An alias claim **narrows** when its key tokens are a strict superset of the name's and at least one
extra token is a content word (not `a`, `an`, `and`, `for`, `of`, `the`). A narrowing claim names a
variant, so it is never an alias:

| claim | on | narrowing? |
|---|---|---|
| `ChatGPT for Teachers` | `ChatGPT` | yes (adds `teacher`) |
| `agent harness` | `harness` | yes; a ruling can still accept it |
| `Bank of America` | `Bank America` | no (adds only `of`) |
| `Retrieval-Augmented Generation` | `RAG` | no (no shared token) |
| `Fable 5` | `Claude Fable 5` | no (removes words) |
| `@dataclass` | `dataclasses` | yes (adds `at`): the decorator, not the module |

#### How the `same_as` rows were produced

Mentions are processed in `seq` order; within a document, one row per entity (`microcompact` and
`microcompaction` in one article are one row). Keys match only within a type. For each mention:

1. If its key is an entity's **name key**, it resolves there (`name_key`): `LLMs` → `LLM`.
2. Else, if its key is an entity's **alias key**, it resolves there (`alias_key`): `LLM judge` →
   `LLM-as-judge`.
3. Else it **creates an entity**: its `surface_id` becomes the entity id.
4. **Then** its name and each alias it claims become alias keys of that entity, except a narrowing
   claim, a key that is already a name key, and a key another entity holds (first claim wins).

A claim only catches **later** surfaces: it never merges two existing entities, and once a key is
an alias no later surface with it becomes its own entity. Only a `ruling` merges existing entities.
A `same_as` row is written once per surface, the first time it resolves elsewhere.

#### Canonical name, aliases, uniqueness

- **`name`** is the surface whose `surface_id` equals the entity id: the first seen, spelled as
  written (`AI agents`, plural, because it came before `AI agent`). A ruling's target keeps its name
  (`LLM` absorbs `Large Language Model`).
- **`aliases`** are every other distinct string among the entity's rows' names and alias claims,
  exactly as written and sorted by codepoint, so case and plural variants stay listed. Every name
  and alias in the log is one in the graph, and the reverse.
- **Within a type, every name key belongs to exactly one entity:** `judge` sits on `LLM-as-judge`,
  not `evaluator`. Across types names may repeat. The build asserts it.

### `gold/graph.json`

Compiled by `scripts/compile.py`: each `surface_id` follows its `same_as` chain to a terminal id,
the entity id, and everything is built on terminal ids.

- **`documents`**: the 56 documents, `path` pointing into `corpus/`.
- **`entities`**: 813, `{id, name, type, aliases, description, properties, doc_count,
  mention_count}`. `properties` holds only the keys the type declares; `description` and each
  property take the earliest non-null value (by `observed_at`, `doc_uri`, `seq`). No frequency gate:
  331 entities have `doc_count` ≥ 2.
- **`relationships.mentions`**: one per `(doc_uri, entity_id)`, `count` summed, `confidence` maxed,
  `id` = `mentions:{sha1(doc_uri, entity_id)[:16]}`.
- **`relationships.related_to`**: one per `(doc_uri, source_id, target_id, semantic_type)`,
  `confidence` maxed, `id` = `related_to:{sha1(…)[:16]}`. Never folded across documents; a row whose
  two ends compile into one entity is dropped (none here).

Hashes join their parts with `\x00`. Sorted: `entities` by `id`, `aliases` by codepoint,
`mentions` by `(doc_uri, entity_id)`, `related_to` by its four fields. Compiling the log reproduces
the file byte for byte.

### `gold/rulings.json`

The curation decisions, each with `why`: `merges`, `kept_separate`, `retypes`, `drops`, `renames`,
`add_aliases`, `accept_aliases`, `negative_aliases`, `coined_labels`, `relabels`. Merges also
appear in the log as `same_as` rows with `reason: ruling`, except a merge whose names share their
only document, folded into that document's mention (marked `in_log`).

### `gold/retrieval.jsonl`

238 queries: 200 over the whole corpus, and 38 (`tr-` ids) written over the train documents only
for the agent's bundle (Splits). Each scores retrieval alone: did the engine return the expected nodes, edges and
documents. No answer is generated or judged. A row names only what a merged graph holds, through
id-free handles: a document by `doc_uri`, an entity by `(type, name)`, an edge by its two entities,
direction, label and `doc_uri`.

```json
{"id": "mh-002", "kind": "multi_hop", "origin": "graph", "difficulty": "medium",
 "query": "What multi-agent system includes the class of agent that Nova belongs to?",
 "expected": {
   "nodes": [{"type": "tool", "name": "Nova", "role": "anchor"},
             {"type": "system", "name": "research agent", "role": "bridge"},
             {"type": "system", "name": "article generation system", "role": "answer"}],
   "edges": [{"source": "Nova", "target": "research agent", "semantic_type": "instance_of", "doc_uri": "…"},
             {"source": "research agent", "target": "article generation system", "semantic_type": "part_of", "doc_uri": "…"}],
   "docs": [{"doc_uri": "…", "role": "bridge"}, {"doc_uri": "…", "role": "answer"}]},
 "why": "…"}
```

- **`kind`**: `single_hop`, `multi_hop`, `intersection`, `aggregation`, `comparison`, `temporal`,
  `unanswerable`.
- **`difficulty`**, fixed by the expected set: `easy` when everything sits in one document; `hard`
  when the shortest walk from an anchor to an answer is three hops or more, or the row is an
  `intersection` (the structure tier); `medium` otherwise, including `unanswerable`. 67 / 109 / 54.
- **`origin`**: `graph` (written from a graph seed) or `text` (from a body alone: 42 of the 218
  answerable rows, 19%, against a 30% target, so the set doesn't only reward rebuilding the gold
  graph; the 12 `unanswerable` rows are `text` too).
- **`expected`** is complete: every relevant node, edge and document, not only the seed. Empty for
  `unanswerable`.
- **`role`**: `anchor` is named in the query (counts toward precision, never recall); `bridge` is a
  hop; `answer` is what is asked, the target of MRR. An `intersection` has two anchors that share no
  document and one answer adjacent to both. A `comparison` names both ends, so both are anchors.
- **`window`** (`temporal` only): `{"from": "2026-01", "to": "2026-12"}`, inclusive;
  `expected.docs` is the anchor's `mentions` inside it.
- **`why`**: one unscored reviewer sentence.

#### How the queries were built

Each query is written from a seed in the gold graph, which also closes the expected set:

| kind | rows | seed | filter |
|---|---|---|---|
| `single_hop` | 57 | one `related_to` edge | claimed in one document |
| `multi_hop` | 36 two-hop, 20 three-hop | a path whose edges come from different documents | middle nodes `doc_count` ≤ 3; no two non-adjacent nodes share a document, or one chunk shortcuts the walk |
| `intersection` | 34 | two anchors and a node adjacent to both | anchors `doc_count` ≤ 12, sharing no document; answer `doc_count` ≤ 5, reached through a different document from each |
| `aggregation` | 26 | one node | `doc_count` 3 to 12; above 12 the set is most of the corpus |
| `comparison` | 24 | a `compared_with` or `alternative_to` edge | both ends the same type |
| `temporal` | 21 | a node and a `published` window | mentioned inside and outside the window, so it excludes some documents |
| `unanswerable` | 12 | none | no name in the query resolves to a gold node |

Steps: seed across kinds, documents, hubs and once-seen nodes; an LLM writes the query naming only
the anchors and copying no sentence; check mechanically (`retrieval_gold.py check`); a judge
completes `expected` over the anchor's neighbourhood; gate out any query a model answers with no
corpus; a human reviews every row. While writing, BM25 over `corpus/` chunks ranked the answer
document; `single_hop` and `multi_hop` wordings that handed it over at rank 1 were rewritten (9
remain, where one document dominates its anchor).

Optional kind, not built: a one-node `lookup` seeded from sibling pairs the gold keeps apart
(`Lambda` and `AWS Lambda`, `pass@k` and `pass^k`, `LangChain` the company and the library).

## Splits

`gold/splits.json` (written by `scripts/split.py`) splits the data into **train**, the only part
the coding agent sees (its bundle: few-shot examples, inspection), **dev**, scored by a third-party
evaluator after each submission with the report sent back as feedback, and **test**, scored once by
the evaluator with the system frozen, totals only. Nothing is trained: tuning is any change made
from looking at the data (few-shot examples, prompt edits after reading errors, a threshold, top-k,
a choice of model).

| | documents | retrieval queries |
|---|---|---|
| train | the first 12 in log order (2025-09-25 to 2025-11-26): 192 mentions, 10 merge decisions | 30, written over train documents only |
| dev | the next 25 (2025-12-02 to 2026-05-12): 932 mentions, 23 merge decisions | 90 |
| test | the last 19 (2026-05-19 to 2026-10-20): 941 mentions, 14 merge decisions | 110 (31 hard) |

Parameters: `train_fraction` 0.22, `dev_fraction` 0.44, 90 dev queries; `split.py` tries 10 seeds
and keeps the most even (seed 3), and re-running it reproduces the file. Train's queries are the
`tr-` rows; the other 200 are assigned as four buckets, dev in three thirds and test, which keeps the
test set of the earlier splits unchanged (dev's third third was the earlier train).

- **Why three parts, not folds.** Few-shot examples must come from documents earlier than the ones
  scored: gold rows reuse the canonical name of the entity's first document, so a later
  document's rows reveal earlier documents' answers. With time-ordered folds, examples from folds 2
  and 3 would hand fold 1 its answer key. A train prefix can't leak forward.
- **The agent's isolation is enforced, never trusted.** `export_agent.py` writes a bundle holding
  only `spec/agent/`, the train documents, train's gold graph (`compile.py`'s graph of the train
  log), each stage's train examples and train inputs; it fails if any file names a dev or test
  document. The agent works from that bundle; the evaluator runs its frozen system here.
- **Train queries are grounded in train.** Every document and edge a `tr-` row expects is a train
  document's, and its query names no entity only dev or test documents mention (`split.py` asserts
  both). Scored on the full graph, so `check` holds them to every rule there too: an aggregation
  anchor is mentioned only in train documents, and a temporal window keeps only train documents.
  The exception is `multi_hop`: few train paths pass its rules on the full graph, and the agent runs
  these on the train graph, so `check` judges their hops there. Nothing is decided on their scores.
  The mix is skewed for it: 12 `single_hop`, 6 `temporal`, 4 `comparison`, 4 `intersection`, 2
  `unanswerable`, 1 `multi_hop`, 1 `aggregation`, no three-hop. On the full graph only one path
  through train edges keeps its anchor and answer in separate documents, and only `JSON Schema` is
  mentioned in 3 to 12 documents, all of them train.
- **Documents split by time.** Resolution depends on order, so dev is a log prefix and test its
  continuation, like new articles arriving in a live graph. A random split breaks the prefix.
- **Replay the history, score the held-out part only.** Dev runs with train replayed as gold, test
  with train and dev; train has no history. Extraction sees the gold
  entities of every earlier document. Graph building gets the history's `same_as` rows
  (`gold-history`) or none (`end-to-end`, whose gap to `gold-history` is the error the history
  carries in); B-cubed clusters span the whole cut log but only held-out rows are averaged.
- **A merge decision is hidden** unless both its surfaces are first seen in history: 10 in train (4
  of them rulings), 23 in dev, 14 in test.
- **Dev and test queries split by query, not documents.** The engine always sees the full corpus
  and graph. Queries sharing an anchor form one group and stay in one part (so `Pydantic` queries
  can't tune a `Pydantic` test query), and each part keeps the `kind` × `difficulty` mix.
- **Protocol** (`spec/evaluator/evaluate.md`): the agent takes few-shot material from its bundle;
  the evaluator scores each submission on dev and returns the report, errors included; test is
  scored once at the end, its errors never read. The spread a fold split gave is replaced by the
  bootstrap `dev_ci95` and the dev-to-test `gap`.

## Scoring

(Lite cut: the counts in this section, such as the no-merge baseline and the query tiers, are the
full dataset's; the metrics and rules are the same.)

Gold ids are hashes and a system mints its own, so nothing matches on ids: everything matches on
type plus the key of any name or alias.

### 1. Extraction

Input: one document, the ontology and the earlier documents' entities. Gold: its `entity_mention`
and `related_to` rows.

- **Mention precision, recall, F1** (headline): micro over documents. One to one: each gold row
  matches once, a name-to-name hit preferred. Recall leaves the 10 coined rows out (they need a judge
  on the description). A type counts only through the match: a mention with the wrong type is a miss
  and a false positive (`--details` lists the type errors).
- **`related_to` P/R/F1, directed** (headline): both ends resolve to the document's predicted mentions
  by key and must match the gold ends, in order; labels are ignored. `unresolved_ends` counts ends
  that name no predicted mention.
- **Guards:** `documents.empty` (a held-out document with no rows back) and
  `documents.predicted_rows_outside_held_out`.

Not measurable here: `count` (bare shorthand was counted: `tester agent` has 10 for one full-name
use), `confidence` (review rows carry a flat 1.0), `domain` (54 of 56 documents are only
`ai_engineering`), `released` (null everywhere), `country` (16 organizations), `description` (judge
only).

### 2. Graph building

Input: the gold extraction rows in `seq` order, without the held-out `same_as` rows, so the
builder's errors are its own. Gold: each `surface_id` → its terminal id.

- **B-cubed precision and recall** over `entity_mention` rows: per row, overlap ÷ predicted cluster
  (precision) and overlap ÷ gold cluster (recall). Read apart: precision drops on over-merges,
  recall on under-merges, and a wrong merge is worse than a wrong split.
- **Baseline:** no merge at all scores P 1.000, R 0.943 over all documents, so only the last 6
  recall points measure merging. Per part, the evaluator reports `baselines.history_only.recall` (the
  given history, nothing new merged): only recall above it is the builder's.
- **Guards:** `surfaces.*` count surfaces left without an assignment and assignments to surfaces
  outside the cut log. `--details` lists the missed and the wrong merges.

### 3. Retrieval

Input: a query, `corpus/` and `gold/graph.json`, always: retrieval is scored on the gold graph so it
measures retrieval alone, and the system's own graph is scored only by the graph stage. The
retrieval stage may load `graph.json`; nothing else in the system may, since it holds the gold
extraction of every document. The agent's bundle carries train's graph in its place. Output: one envelope per query (`spec/agent/task.md`). A node matches on type plus
key; an edge on both ends and direction (`compared_with`, `alternative_to` either way; label and
`doc_uri` ignored, a strict variant needs the label); a document on `doc_uri`.

Every kind is answered (`spec/agent/task.md`), but only `single_hop` is scored:

| metric | why |
|---|---|
| edge recall@k (k = 5) (headline) | a node can come back for the wrong reason, an edge can't |
| answer-node MRR (headline) | the only metric that reads order: recall@5 can't tell rank 1 from rank 5 |
| edge precision | recall can be bought by returning the neighbourhood |

Each is a mean over the part's single-hop queries with a seeded bootstrap 95% interval (`ci95`); a
metric that can't apply to a query is left out of its mean, never zero. `--unranked` replaces recall@5
with recall over every edge returned and drops MRR. `rows.envelopes_outside_held_out` counts envelopes
for queries outside the part. Single-hop is a few dozen queries per part, so read the `ci95`.

## Evaluators

`evaluators/` has one CLI per stage, each with `inputs` (what a system gets for a split part,
with the held-out answers removed) and `score` (predictions in, JSON report out, gold loaded
internally), plus `examples` (train's gold, as few-shot material, which `export_agent.py` writes into
the bundle). Flags: `--split train|dev|test`, `--details` (per-item errors, train and dev only).
Input and prediction formats are in `spec/agent/train.md`; every report field is in the code and
Scoring above. Only the evaluator runs them.

`summary.py --stage <stage> --predictions-dir <dir>` scores `dev.jsonl` (required), `train.jsonl`
and `test.jsonl` (optional) and writes `headline`: each primary metric for train, dev and test, with
`dev_ci95` for retrieval and `gap` (test minus dev). Without `test.jsonl`, test and gap are
null: the evaluator runs it on each dev submission, then once with test (`spec/evaluator/evaluate.md`).

Gates the evaluators pass: gold predictions score 1.0 on every metric on train, dev and test (MRR
needs the answer node listed first); empty predictions give recall 0. Perturbations move only what
they should: a dropped mention lowers recall only; a flipped type lowers mention precision and
recall; a reversed relation lowers `directed`; a wrong label changes nothing; a name swapped with its
alias still matches; a wrong merge lowers B-cubed precision only; a missing merge lowers recall; an
answer at rank 2 halves that row's MRR; a reversed edge misses unless it is `compared_with` or
`alternative_to`; `--unranked` drops every metric that reads order.

## Scripts

- **`scripts/compile.py [--log] [--out]`** rebuilds `gold/graph.json` from the log and asserts the
  log's invariants (contiguous `seq`, every reference logged, one mention row per entity per
  document). Its `normalize` is the dataset's key; the evaluators import it.
- **`scripts/split.py [--train-fraction 0.22] [--dev-fraction 0.44] [--retrieval-dev-size 90]
  [--tries 10] [--out]`** writes `gold/splits.json` and asserts that train queries are grounded in
  train documents.
- **`scripts/retrieval_gold.py check`** validates every query against the graph and corpus (names
  resolve, edges exist, documents mention their nodes, the query names no non-anchor, difficulty
  matches the rule) and reports the BM25 rank. **`seeds --per-kind N [--graph]`** samples candidate
  seeds for new queries; `--graph` seeds from another graph, such as a bundle's `train/graph.json`.
- **`scripts/export_agent.py --out <dir>`** writes the coding agent's bundle (Splits) and fails if
  any of it names a dev or test document.

After any edit to `gold/`: run `compile.py`, `split.py` and `retrieval_gold.py check` (expect
`failing=0`).

## Problems and learnings

- **Name-only matching fails.** 149 rows match their article only through an alias; the canonical
  name came from elsewhere. Every matcher in the dataset uses name or alias.
- **Raw extractor output was not gold.** It under-connected entities (961 `related_to` rows added
  across two reviews), extracted tool calls, code symbols, files and agent roles as tools (241 rows
  dropped), and used two spellings for one label (`applies_to` / `applied_to`).
- **A key can't link an acronym to its expansion** (`RAG` / `Retrieval-Augmented Generation`), nor
  catch drift like `TerminalBench` / `Terminal-Bench` or `Perplexity's Deep Research` / `Deep
  Research`: those need alias claims or rulings, not a looser key.
- **Singular rules guess wrong** (`Kubernetes` may key as `kubernete`): harmless unless it collides,
  so check collisions, not pretty keys.
- **Short generic aliases swallow everything:** once `memory`, `judge` or `workflow` is an alias,
  every later bare use resolves there.
- **Resolution is order-dependent:** the first surface names the entity, and an alias claim only
  catches later surfaces. That is why documents split by time and history is replayed.
- **Unicode breaks determinism:** curly vs straight quotes (`AI Agent’s Memory`), en dash vs hyphen,
  accents, and characters whose lowercase is longer (Turkish `İ`).
- **Markdown leaks into keys.** The key spells symbols as words, so a body keyed whole turns
  `` `SAME_AS` `` into `grave-accent-same-as-grave-accent` and misses the name. Strip code backticks
  before keying a body. The earlier "131" and "174" alias-only counts and "837 of 844" came from
  inconsistent text matching; the key-based counts are 149 and 845 of 846.
- **The coined-row count drifted** (documented 9, measured 10): recount from data rather than
  trusting prose.
- **Names collide across row kinds:** a `document` row's `source_id` is a file name, a `related_to`
  row's is the claim's source surface.
- **Specs leak the parts they quote.** The ontology's examples came from the whole corpus
  (`microcompaction`, `Decode`, `H100`); an extractor prompted with them has seen test. Moving them
  to dev fixed test but not dev, so `spec/agent/` now uses train entities or invented names only.
- **Retrieval examples crossed parts.** Split by query, 29 of the 30 earlier train queries had their
  answer in dev or test documents (`voyage-3.5` in `mh-003`), so an agent reading them saw dev and
  test. They moved to dev, and train got 30 queries written over train documents only.
- **Few-shot examples and time-ordered folds don't mix.** Examples from later folds carry earlier
  folds' canonical names and merges, their answer key. A train prefix fixes it; the cost is the fold
  spread, replaced by bootstrap intervals and the dev-to-test gap.
- **Splits have a shape, not just a size.** Train has no history, so most of its mentions create
  entities and 4 of its 10 decisions are rulings; test resolves against 37 earlier documents.
- **Few merges per part** (10 to 23): one decision moves merge recall 4 to 10 points. Read raw
  counts beside rates.
- **Seeds matter for small stratified splits:** seed 0 gave unbalanced intersections; `split.py`
  now keeps the most even of 10.
- **Counts are not rates:** dev has 23 merge decisions and test 14, so `summary.py` compares merge
  decisions as a rate.
- **Not measured:** coined labels and descriptions need a judge; the anchor-rarity and BM25-miss
  retrieval slices and the closed-book gate are not wired.
