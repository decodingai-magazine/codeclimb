# Task: a GraphRAG system over a corpus of articles

Build a good GraphRAG system: one that scores well on these evaluations, on this data. It reads
articles, turns them into a knowledge graph that follows `ontology.md`, and retrieves from that
graph the nodes, edges and documents a query needs. Nothing generates or judges a written answer:
retrieval returns evidence, and the evidence is scored.

**The score is the goal; the rest is suggestions.** Only the evaluation is fixed: its commands, its
prediction schema, the models and caps it allows, and keeping dev and test out of your system.
Everything else in this spec about how to build it is a suggestion. A reference shape is given below
(Reference architecture) and is the recommended starting point: it is what a working system of this
kind looks like, and the spec names where its rules were wrong for this corpus. Depart from it when
train and the feedback back the change: try different ways to extract, merge and retrieve, install
what you need (`runtime.md`), and keep what the metrics back.

**What you have:** your bundle (`train.md`): this spec, the 6 earliest articles (**train**), and
their gold, which you may read in full and sample as few-shot examples. The later articles are
split by time into **dev** and **test**, and you never see them: a third-party evaluator runs your
frozen system on them. Dev's report comes back to you as feedback after each submission; test is
scored once, at the end. `lessons.md` holds what earlier attempts learned while building this
system: read it before you plan.

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
  scored; the gold has them for every entity. Extract `description` and `properties` for every
  entity anyway if you can: they give your merging and retrieval something to compare.
- **No frequency floor.** Every gold row counts, including entities named once, so a row you leave
  out for being rare is a missed row.
- **Density.** Train's documents carry 19 to 33 mentions and 21 to 37 claims each,
  about 0.9 mentions per 1000 characters of body text. Held-out gold is denser, because the gold
  engages with every named thing. A system that returns train-like counts on a held-out document
  has stopped early. Measure recall by section on train, not by total.
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
  where otherwise graph building must. The gold does both: most rows reuse known names, and some keep their own variant
  (`RAG`, `LLMs`, `AI agent`), joined later by a merge decision.
- **`related_to` ends** name two mentions of the same document (by name or alias), in the direction
  the claim reads: "Anthropic develops Claude Code", not the reverse. Write the claim as it reads:
  component `part_of` whole, instance `instance_of` class, organization `develops` product, tool
  `used_for` method, method `applied_to` system.
- **Claims are subject-centred and span sentences.** An article's central subject is one end of a
  large share of its claims; that is the gold, not a defect to suppress. A claim is any relation the
  article states between two entities you extracted, wherever the two are named: a list item, a
  comparison table, a sentence two paragraphs after the subject was introduced. Filters on claims
  cost recall here (`lessons.md`, Failed, more than once).
- **One label per claim.** Reuse a `semantic_type` you already wrote in earlier documents rather
  than rewording it (`applied_to`, never `applies_to` beside it). The gold labels are never shown to
  you. **Why:** labels are scored only in the `labeled` relation variant, but a graph with two
  spellings for one claim can't be queried by label. Train's claims use 26 labels, and eight
  of them (`uses`, `used_for`, `instance_of`, `implements`, `compared_with`, `applied_to`, `supports`,
  `integrates_with`) cover most claims. Reuse before coining.

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

- **Explore how to merge.** Normalized keys, alias claims, embeddings of names and descriptions,
  and the decision model on candidate pairs each catch different merges (Where models help). Try
  more than one, alone and combined.
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
  (an invented `Pydantic for Agents` on `Pydantic`) names a variant: a second entity.
- **Watch short generic aliases.** Once `agent` or `workflow` is an alias of one entity, every
  later bare use resolves there.

### 3. Retrieval

**What:** load the gold graph you're given into a store, alongside the corpus, and for each query
return one envelope. A suggestion: Ladybug (`runtime.md`), an embedded graph database, queried with
real Cypher rather than by walking the JSON. Retrieval is always scored on the gold graph (in your bundle,
`train/graph.json`; when evaluated, the full one over every article), so its numbers measure
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

- **Only these fields.** A node has `type`, `name`, `aliases`, `score`; an edge has `source`, `target`,
  `semantic_type`, `score`; a document has `doc_uri`, `score`; an envelope has `id`, `nodes`, `edges`,
  `docs`, `passage_tokens`. Any other field fails the stage (`train.md`, Inputs and predictions).
- **Handles, not ids.** A node is its `type` and `name` (or any alias), matched by key; an edge is
  its two end names, matched by key against the gold entities' names and aliases, with no type
  (an invented `Kestrel` the tool and the company are the same end); a document is its `doc_uri`. An edge's
  document is not checked: the graph keeps one edge per document, and any of them counts, so an edge
  never carries a `doc_uri`, even though the gold's expected edges do. Your own ids never reach the
  scorer.
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
| `single_hop` | "What goes wrong in tool calling when an agent is handed too many tools?" | the edges that answer it (usually one), in the top 5 |
| `multi_hop` | "Which Python library can automatically produce the tool-definition format that Google's function-calling API expects?" | every edge of the path, two or three hops; the hops come from different articles, so no single document holds the answer |
| `intersection` | "Which platform do both Atlas Bot (*invented*) and Nova integrate with?" | the node adjacent to both anchors, ranked first among nodes, and both edges |
| `aggregation` | "Which articles describe tools or outputs with JSON Schema?" | every document that engages with the node, and no others |
| `comparison` | "Why reach for Pydantic rather than plain JSON for structured outputs?" | the edge that joins the two |
| `temporal` | "Which articles from September to November 2025 cover LangGraph?" | the node's documents published inside the window, none outside it |
| `unanswerable` | "Which article streams events from Kafka into Flink?" | nothing |

## Reference architecture

Build each stage as a small pipeline of modules with typed rows between them, not one script. The
shape below is adapted from a working ontology-extraction system over documents like these;
`lessons.md` lists where its rules lost recall on this corpus. Your repository starts as this
layout, wired end to end and runnable (its README says what each module does out of the box).

```
graphrag/
  __main__.py        CLI: extraction | graph | retrieval
  config.py          every threshold and size, loaded from config.toml
  contracts.py       pydantic models for rows and model replies
  jsonl.py           rows in and out
  llm.py             chat, embeddings, rerank, decisions; retries; concurrency
  prompts/
    ontology.md      the ontology, which is the extractor's system prompt
  extraction/
    chunking.py      sections from headings, size-bounded; never a truncation
    extract.py       per section: an entities call, then a claims call, canon injected
    filter.py        deterministic: closed rejection reasons, duplicate fold, endpoint check
    critic.py        optional second pass over the document's rows
  graph/
    keys.py          the scorer's normalized key (with pulse_normalize.py beside it)
    resolve.py       exact, alias; narrowing check; collision drop; a hook for acronym, fuzzy and embedding nominations
    materialize.py   log rows to entity assignments
  retrieval/
    store.py         Ladybug schema and loader
    anchors.py       query phrases to entities
    queries.py       one Cypher template per query shape
    rank.py          ranking and caps; BM25, embeddings and rerank go here
config.toml
fewshot.json
```

**Extraction data flow.** Document, then sections (every section whole: a long article is more
sections, never fewer characters), then per section one call that returns entities and one that
returns the claims between them, with the canon injected: the known entities the section names,
matched by whole key tokens, under one rule, "write these names". Parse the reply into a typed
model (a strict envelope, lenient rows, one re-ask on a schema error), drop a reply that loops (cut
at the token limit, or over a row cap) and extract that section again in halves, then a
deterministic filter with a closed list of reasons (the starter's: `unknown_type`, `blank_name`,
`type_conflict`, `endpoint_not_mentioned`, `self_loop`, `duplicate_claim`; never a count floor),
then the union across sections into one row per `(type, key)` per document: counts summed, aliases
joined, one type per key within the document. Keep the rejected rows in a file of your own: reading
them on train is how you tune the filter.
Log one line per document on stderr: sections, looping replies split or given up, rows kept, rows
rejected by reason. A document far denser or sparser than the others is the first thing to read.
Relation work goes through this stage's mention recall: a claim whose end was never extracted
can't be found (`lessons.md`, The lever for relations).

**Graph data flow.** Rows in `seq` order, a key index per type, and for each surface: an exact key
hit (identity), an alias key hit (identity, unless the alias narrows the name or another entity of
the type already owns it), an acronym match (a nomination), fuzzy (a nomination; a gray band goes to
a verdict, which prefers "new"), then the assignment. The starter has the exact and alias steps;
its hook for acronym, fuzzy and embedding nominations returns nothing. Rebuild from the whole log
each run; nothing persists. The scorer's key is `normalize` in `/spec/scorer/scripts/compile.py`;
your repository ships the same function as `graphrag/graph/keys.py`, because `/spec` does not
exist when evaluated (`train.md`, What you submit).

**Retrieval data flow.** The gold graph into Ladybug tables (`Entity`, `Document`, `MENTIONS`,
`RELATED_TO` with `semantic_type` and `doc_uri`; `runtime.md` has a schema), anchors from the query
(a key match on names and aliases, then embeddings), one Cypher template per shape (the edges of an
anchor; `*1..3` paths between two anchors; the common neighbour of two anchors; documents by
`MENTIONS` inside a `published` window), then ranking with BM25 and embeddings, a rerank of the
short list, and abstention when no anchor resolves and the top score is low. The starter has the
first three templates, returns an anchor's documents without a window, ranks by fixed scores and
abstains only when no anchor resolves.

**Knobs belong in `config.toml`,** read at start: section size, candidate counts, thresholds,
concurrency, model names. Tune them on train; never edit a constant in code to try a value.

## Where models help

Starting points, not requirements. `runtime.md` lists the models and their endpoints. Every call
costs time and money, so try a change on train and keep what raises a metric there.

- **Chat model: read text.** Use it to extract rows, with few-shot examples from train.
- **Extraction cost.** The sections (Extraction data flow) can serve as passages for retrieval too.
  The cost is one or two calls per section: time one section call on train, multiply by sections
  and calls, divide by concurrency, and keep the part's total under the stage's time limit. A critic
  pass adds one call per document; a gray-band verdict adds one decision call per candidate pair.
- **Embedding model: find candidates cheaply.** Embed names with their descriptions, edges as short
  sentences, and passages, then compare by cosine similarity. Send texts in batches.
- **Decision model: answer yes or no with a probability.** Use it where a threshold is the design:
  one question per candidate, and several questions in one call. Set the threshold on train.
- **Reranking model: order a short list.** Take about 20 candidates from BM25 and embeddings, write
  each as text, and rerank them against the query. It orders candidates but doesn't say which to
  keep: use the decision model for a yes or no. Reranking the whole graph is too slow and too costly.

Per stage:

| stage | where a model fits |
|---|---|
| extraction | the canon holds only the known entities a section names (Extraction data flow), so a growing history doesn't fill the prompt; a critic pass over the document's rows (keep, drop, fix type) catches roles, code identifiers and list-only names |
| graph building | compare by normalized key first; embed surfaces to find likely pairs of the same `type`; ask the decision model whether a pair is one referent, with a high threshold, because a wrong merge is worse than a wrong split |
| retrieval | combine BM25 and embeddings to rank nodes, edges and documents; rerank the top candidates; ask the decision model whether a query names anything the corpus holds, to decide when to abstain; link query phrases to entities by embedding to find anchors, then walk the graph from them, with Cypher paths for example, for `multi_hop` and `intersection` |

**Run calls concurrently.** One call per document or candidate in sequence can overrun a stage's
time limit, and a stage that overruns fails the whole submission (`runtime.md`, Evaluation).

## What you're optimizing

Primary metrics, all in the evaluator's report:

| stage | primary | why |
|---|---|---|
| extraction | mention F1 (micro) and `related_to` F1 (directed); type accuracy beside them | entities and claims are what the graph is made of |
| graph building | B-cubed precision and recall, read apart, against the history-only baseline | the baseline merges nothing new; only recall above it measures your merging |
| retrieval | per kind: `single_hop` and `comparison` edge recall@5, `multi_hop` path completeness, `aggregation` and `temporal` R-precision, `intersection` answer MRR, `unanswerable` abstention; subgraph precision for every kind | each kind tests a different ability; precision stops recall being bought by returning everything |

Never collapse retrieval into one average across kinds: the kinds test different things.
