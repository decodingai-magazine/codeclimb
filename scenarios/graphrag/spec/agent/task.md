# Task: a GraphRAG system over a corpus of articles

Build a system that reads articles, turns them into a knowledge graph that
follows `ontology.md`, and retrieves from that graph the nodes, edges and documents a query needs.
Nothing generates or judges a written answer: retrieval returns evidence, and the evidence is
scored. How you chunk, embed, store, resolve and rank is yours to design.

**What you have:** your bundle (`train.md`): this spec, the 12 earliest articles (**train**), and
their gold, which you may read in full and sample as few-shot examples. The other 44 articles are
split by time into **dev** and **test**, and you never see them: a third-party evaluator runs your
frozen system on them. Dev's report comes back to you as feedback after each submission; test is
scored once, at the end.

## The pipeline

Three stages. Each is scored on its own, fed gold input, so an error is charged to the stage that
made it. In your own pipeline each stage feeds the next:

| stage | input when evaluated | input in your pipeline | output |
|---|---|---|---|
| 1. extraction | one document, `ontology.md`, and the gold entities of every earlier document | one document, `ontology.md`, and your own entities so far | the document's `entity_mention` and `related_to` rows (`domain` is not scored) |
| 2. graph building | the gold extraction rows, in order, with the history's merges | your own extraction rows, in order | each surface assigned to an entity |
| 3. retrieval | a query, the corpus and the gold graph | the same | an envelope of nodes, edges and documents |

**Why stages are scored on gold input:** extraction errors would otherwise show up as resolution
errors, and both as retrieval errors, and you couldn't tell which stage to fix.

**Why order matters:** documents arrive in order (by `published`, then `uri`), like new articles
landing in a live graph. A document is extracted and resolved with only earlier documents in view,
and the first surface of an entity decides its canonical name.

### 1. Extraction

**What:** per document, one row per entity the document engages with, and one per claim it makes
between two of them:

```json
{"kind": "entity_mention", "doc_uri": "…", "name": "Claude Code", "type": "tool", "aliases": ["CC"],
 "description": "…", "properties": {"released": null}, "count": 4, "confidence": 0.95}
{"kind": "related_to", "doc_uri": "…", "source_name": "Anthropic", "target_name": "Claude Code",
 "semantic_type": "develops", "confidence": 0.9}
```

- **Scored fields:** `kind`, `doc_uri`, `name`, `type` and `aliases` on a mention; `source_name` and
  `target_name` on a relation. `semantic_type` counts only in the `labeled` variant. `description`,
  `properties`, `count`, `confidence` and the document's `domain` are part of the ontology but not
  scored; the gold has them for every entity, and your own retrieval text may use them.
- **No frequency floor.** Every gold row counts, including entities named once, so a row you leave
  out for being rare is a missed row.
- **A wrong type is a miss and a false positive.** Mentions match only on equal type. Type accuracy
  is measured apart, over the pairs that match when type is ignored.
- **Unnamed things.** When an article describes a method or system without naming it, the gold row
  carries a short descriptive label. Recall leaves those gold rows out (no extractor can guess the
  label); a label you coin counts as a true positive only if it keys to a gold row, else as a false
  positive.
- **One row per entity per document.** Two spellings of one entity in one article are one row: the
  name plus an alias.
- **The document's own wording must be a name or alias.** A row is matched by its name or any
  alias, so either `name: "RAG"` or `name: "Retrieval-Augmented Generation", aliases: ["RAG"]`
  scores the same. Reusing the known name is optional: it joins the two in extraction already,
  where otherwise graph building must. The gold does both: most rows reuse known names, and 60 rows (31 surfaces) keep
  their own variant (`RAG`, `LLMs`, `AI agent`), joined later by a merge decision.
- **`related_to` ends** name two mentions of the same document (by name or alias), in the direction
  the claim reads: "Anthropic develops Claude Code", not the reverse.
- **One label per claim.** Reuse a `semantic_type` you already wrote in earlier documents rather
  than rewording it (`applied_to`, never `applies_to` beside it). The gold labels are never shown to
  you. **Why:** labels are scored only in the `labeled` relation variant, but a graph with two
  spellings for one claim can't be queried by label.

### 2. Graph building

**What:** fold surfaces into entities, in document order. A surface is one `(type, name)` as the
extractor wrote it; an entity is one referent. Two surfaces are one entity only when they denote the
same thing (`ontology.md`, Identity).

When evaluated, the input is extraction rows that each carry a `surface_id`, plus, in
history, merge rows (`same_as`: `from_id` is the same entity as `to_id`). Return one line per
surface: its `surface_id` and an `entity_id` of your own. Only which surfaces share an `entity_id`
matters; the strings are yours.

- **A surface id is shared across documents:** the same `(type, name)` in two documents is one
  `surface_id`, already one entity. Every other merge, `json schema` onto `JSON Schema` included, is
  a decision you make and is scored. A surface first seen in history is a history surface; your
  line for it, if any, overrides the given history.
- **The official mode is `gold-history`** (the history's merges given). `end-to-end` gives none and
  is a diagnostic: its gap to `gold-history` is the error your own history carries in.

- **A wrong merge is worse than a wrong split.** **Why:** a later merge heals a split; nothing heals
  a merge that destroyed a distinction (`tool calls` folded into `tool calling` loses the request
  apart from the practice).
  When in doubt, keep two entities apart. Precision and recall are scored apart for this reason, and
  the trade is one-sided: a change that raises recall while lowering precision is a regression unless
  you can name the merges it gets right.
- **When two strings are the same name.** Compare names through a normalized key, never the raw
  string. The scorer uses its own key with these properties; edge cases (an odd plural) are rare,
  and listing the document's own spelling as an alias covers them. The key must be:
  - case-insensitive (`JSON schema` = `JSON Schema`);
  - separator-insensitive (`tool calling` = `tool-calling`, `url_context` = `url context`);
  - plural-insensitive, conservatively: `AI agents` = `AI agent`, `LLMs` = `LLM`, but `class`,
    `analysis` and `focus` are not plurals, and `HTTPS` ≠ `HTTP`;
  - symbol-preserving: `&` reads as `and`, but `C#` ≠ `C`, `x@k` ≠ `x^k`;
  - version-preserving: `gemini-1.5-flash` ≠ `gemini-2.5-flash`;
  - never empty-matching: a name made only of symbols (`---`) matches nothing;
  - deterministic, idempotent and corpus-independent: the same string always gets the same key;
  - compared within one `type` only.
- **A key can't link an acronym to its expansion** (`LLM` and `Large Language Model` share no
  token). Only an alias claim or your own resolution logic joins them.
- **An alias that narrows a name is not an alias.** A claim that adds a content word to the name
  (an invented `Postgres for Analytics` on `Postgres`) names a variant: a second entity.
- **Watch short generic aliases.** Once `agent` or `workflow` is an alias of one entity, every
  later bare use resolves there.

### 3. Retrieval

**What:** load the gold graph you're given into your store, alongside the corpus, and for each
query return one envelope. Retrieval is always scored on the gold graph (in your bundle,
`train/graph.json`; when evaluated, the full one over all 56 articles), so its numbers measure
retrieval alone and compare across systems. Use the graph's `documents`, `entities` and
`relationships` (`mentions`, `related_to`) as given; never feed it to extraction or graph building.

```json
{"id": "tr-mh-001",
 "nodes": [{"type": "tool", "name": "Pydantic", "aliases": [], "score": 0.9}],
 "edges": [{"source": "Google", "target": "JSON Schema", "semantic_type": "uses"},
           {"source": "Pydantic", "target": "JSON Schema", "semantic_type": "generates"}],
 "docs": [{"doc_uri": "…", "score": 0.8}],
 "passage_tokens": 1800}
```

- **Handles, not ids.** A node is its `type` and `name` (or any alias), matched by key; an edge is
  its two end names, matched by key against the gold entities' names and aliases, with no type
  (`DBOS` the tool and the company are the same end); a document is its `doc_uri`. An edge's
  document is not checked: the graph keeps one edge per document, and any of them counts. Your own
  ids never reach the scorer.
- **The query `id` is an opaque handle.** Echo it; don't route on its prefix (`tr-sh-`, `mh-`, …), which
  is an artifact of how the set was built. **Why:** a real query carries no kind, so a system that
  reads it from the id scores what it can't do.
- **Order is your ranking.** Best first in each list.
- **Anchors** are the entities the query names. Returning them is expected and counts toward
  precision, but the primary metrics score what the query asked for: the edges that connect the
  anchors to the answer, and the answer nodes and documents. In the gold each expected node has a
  `role`: `anchor` (named in the query), `bridge` (a hop on the way) or `answer`; subgraph precision
  counts every role as expected.
- **An edge is found only when both ends and the direction are right.** `compared_with` and
  `alternative_to` count either way; the label is not required to match. **Why:** a node can come
  back for the wrong reason, an edge can't.
- **Return what answers the query, not its neighbourhood.** Subgraph precision is the share of
  returned nodes and edges that are in the query's expected set (anchors included); documents are
  scored by R-precision instead. It is reported beside the count of nodes, edges and documents
  returned.
- **`passage_tokens`** is optional and reported, not scored: the tokens of text your engine would
  hand a reader for this query, in any tokenizer you name. It makes the cost of an answer visible.
- **Abstain.** Some queries name nothing the corpus holds. Abstention scores 1 only when `nodes`,
  `edges` and `docs` are all empty; anything returned for such a query is a false retrieval.

Query kinds, and what a good answer holds:

| kind | example | a good envelope |
|---|---|---|
| `single_hop` | "What did DBOS take the place of?" | the edges that answer it (usually one), in the top 5 |
| `multi_hop` | "Which Python library can automatically produce the tool-definition format that Google's function-calling API expects?" | every edge of the path, two or three hops; the hops come from different articles, so no single document holds the answer |
| `intersection` | "Which platform do both the AI PR Reviewer and Nova integrate with?" | the node adjacent to both anchors, ranked first among nodes, and both edges |
| `aggregation` | "Which articles describe tools or outputs with JSON Schema?" | every document that engages with the node, and no others |
| `comparison` | "Why reach for Pydantic rather than plain JSON for structured outputs?" | the edge that joins the two |
| `temporal` | "Which articles from September to November 2025 cover LangGraph?" | the node's documents published inside the window, none outside it |
| `unanswerable` | "Which article streams events from Kafka into Flink?" | nothing |

## What you're optimizing

Primary metrics, all in the evaluator's report:

| stage | primary | why |
|---|---|---|
| extraction | mention F1 (micro) and `related_to` F1 (directed); type accuracy beside them | entities and claims are what the graph is made of |
| graph building | B-cubed precision and recall, read apart, against the history-only baseline | the baseline merges nothing new; only recall above it measures your merging |
| retrieval | per kind: `single_hop` and `comparison` edge recall@5, `multi_hop` path completeness, `aggregation` and `temporal` R-precision, `intersection` answer MRR, `unanswerable` abstention; subgraph precision for every kind | each kind tests a different ability; precision stops recall being bought by returning everything |

Never collapse retrieval into one average across kinds: the kinds test different things.
