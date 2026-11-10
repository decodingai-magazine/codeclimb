# Task: a GraphRAG system over a corpus of articles

Build a good GraphRAG system: one that scores well on these evaluations, on this data. It reads
articles, turns them into a knowledge graph that follows `ontology.md`, and retrieves from that
graph the nodes, edges and documents a query needs. Nothing generates or judges a written answer:
retrieval returns evidence, and the evidence is scored.

**The score is the goal; the rest is suggestions.** Only the evaluation is fixed: its commands, its
prediction schema, the models and caps it allows, the `fewshot.json` manifest (`train.md`), not
routing on a query's id (3. Retrieval), and keeping dev and test out of your system, the
publication's other articles included (Domain knowledge).
Everything else in this spec about how to build it is a suggestion. A reference shape is given below
(Reference architecture) and is the recommended starting point: it is what a working system of this
kind looks like, and the spec names where its rules were wrong for this corpus. Depart from it when
train and the feedback back the change: try different ways to extract, merge and retrieve, install
what you need (`runtime.md`), use the allowed models where each fits (`models.md`), and keep what
the metrics back.

**What you have:** your bundle (`train.md`): this spec, the 6 earliest articles (**train**), and
their gold, which you may read in full and sample as few-shot examples. The later articles are
split by time into **dev** and **test**, and you never see them: a third-party evaluator runs your
frozen system on them. Dev's report comes back to you as feedback after each submission; test is
scored once, at the end. `lessons.md` holds what earlier attempts learned while building this
system: read it before you plan.

## What the graph is for

The graph exists to show the main topics of a large pile of documents that keeps growing: which
methods, systems, tools and models the pile engages with, how much, and what it says about each.
The pile is thousands to tens of thousands of items about AI engineering practice: newsletter
articles like the ones in your bundle, and later video transcripts and social media posts. The
evaluation runs on a few articles; the system is meant for all of that. The metrics below measure
the parts of that job, and this section says why each part matters, so you can rank two errors the
metrics count the same.

A reader brings two questions to the graph:

- **What can I compare this to?** Given a tool, system, organization or method, the similar ones
  the pile sets beside it: its `compared_with` and `alternative_to` edges, and the entities that
  share its class.
- **What are the latest, most frequent and most important topics?** The entities the most
  documents engage with, in a time window: document counts from `mentions`, dates from
  `published`.

Both are read off the ontology as it is; no new field or type is needed. Neither is scored as
such: the evaluation scores `single_hop`, an entity's own edges, which is the step both are built
on (What you're optimizing).

Two things are built, in order, and each has its own measure:

- **The log first.** Extraction writes it, so extraction's metrics are the log's quality.
- **Then the graph, from the log alone.** Graph building and retrieval measure it. The graph can't
  be better than the log it is built from, so the log's quality matters as much as the graph's.

What that means for each part:

- **A topic is an entity many documents engage with.** Its weight is the number of documents that
  mention it in the merged graph, with `count` saying how much each one does. Nothing is clustered
  or summarized: the topics are read off the graph.
- **Extraction decides which topics exist.** An entity no document's rows hold is a topic nobody
  can find. A row for a thing the document does not engage with (a code symbol, a name in a list)
  is a topic that isn't there. Most topics are `method` and `system` entities, the two types
  extraction misses most (`lessons.md`, The lever for relations).
- **Merging decides what each topic weighs.** A wrong split shares one topic's documents between
  two entities, and both look minor. A wrong merge adds two topics' documents together and shows
  one that doesn't exist.
- **The log makes it trustworthy.** Every row is an observation from one document and is never
  rewritten, so each topic and each claim can be traced to the documents behind it (The log).
- **One hop answers "what does the pile say about this topic".** A topic's edges are the claims
  made about it, each from the document that made it (3. Retrieval).
- **It must stay cheap as the pile grows.** The work a new document costs must not grow with the
  number of documents before it (Built to grow).

## Domain knowledge

What counts as an entity here is a judgment about AI engineering, and the ontology states it only
in general terms. The data shows it:

- **Read the train articles beside their gold rows before you design anything.** See which named
  things the gold keeps and which it leaves out, how it types a method against a system, and what
  a claim looks like. `train/examples/extraction.jsonl` has each article's rows.
- **Give the extractor that knowledge.** The ontology is its system prompt, and the starter uses
  no few-shot example. Train's gold rows may be used as examples, but more of them has not helped
  so far: attempts that used an example document found a second or a swapped one worse, and a
  section with its gold rows was flat (`lessons.md`). Use an example to show one judgment the ontology leaves open (Open
  hypotheses, Type contrast), measure it, and list the documents it comes from in `fewshot.json`
  (`train.md`, Few-shot examples).
- **Train is the only sample of the publication you may read.** Its other articles are dev and
  test: never open the publication, its archive or a copy of one of its articles. This is a rule
  of the evaluation. Reading about methods, libraries and their docs on the web is fine.

## The pipeline

Three stages. Each is scored on its own, fed gold input, so an error is charged to the stage that
made it. The evaluation never runs your stages end to end: what your extraction writes reaches
no other scored stage. In the system the graph is for, each stage feeds the next:

| stage | input when evaluated | input in the real system | output |
|---|---|---|---|
| 1. extraction | one document, `ontology.md`, and the gold entities of every earlier document | one document, `ontology.md`, and your own entities so far | the document's `entity_mention` and `related_to` rows |
| 2. graph building | the gold extraction rows, in order, with the history's merges | your own extraction rows, in order | each surface assigned to an entity |
| 3. retrieval | a query, the corpus and the gold graph | the same | an envelope of nodes, edges and documents |

**Why stages are scored on gold input:** extraction errors would otherwise show up as resolution
errors, and both as retrieval errors, and you couldn't tell which stage to fix.

**Why order matters:** documents arrive in order (by `published`, then `uri`), like new articles
landing in a live graph. A document is extracted and resolved with only earlier documents in view,
and the first surface of an entity (a surface is one `(type, name)` as a document wrote it)
decides its canonical name. The documents before the part being evaluated are its history: none
for train, train for dev, train and dev for test.

### The log

The stages share one data model: an append-only log, ordered by `seq`. Graph building's input is
this log (`train.md`, Graph building), and `train/examples/graph.jsonl` is train's.

**You read the log; you never write it.** Your extraction output is rows in the prediction schema,
which the evaluator turns into log rows. Your graph output is one `surface_id` and `entity_id`
line per surface: that is your merge decisions, in the only form the schema allows. Never write a
`same_as` row or any other log field (`train.md`, Inputs and predictions).

What the log's shape asks of your system:

- **Rows are observations.** An `entity_mention` or `related_to` row says what one document
  states. It is never rewritten or corrected afterwards, so extraction has one chance at each
  document.
- **A merge is separate from the rows it joins.** In the log it is a `same_as` row appended after
  them; in your output it is two surfaces sharing an `entity_id`. Either way the rows stay as they
  were written, and the same log always gives the same graph.
- **A split can heal, a merge can't.** A later merge joins two surfaces left apart. Nothing
  restores what two merged entities each held (2. Graph building).
- **Each claim keeps its document.** Two documents making the same claim are two rows. That count
  is what says how widely a claim is made.

### Built to grow

Not scored on its own; the stage time limits are the only check. It is still what the system is
for, so prefer the design that holds when the pile is a thousand times larger:

- **Extraction reads one document and a bounded canon** (the known entities shown to the
  extractor), never the whole history (Extraction data flow).
- **Graph building resolves a surface against an index.** A key lookup, or a nearest-neighbour
  lookup for embeddings, then a decision on a few candidates. Never compare every pair of
  entities, and never ask a model about all of them.
- **Replaying the log is one pass.** The evaluation rebuilds from the whole log because nothing
  persists between stages; the pass itself should do per row what a live system would do when the
  row arrives.
- **Retrieval starts from anchors,** the entities a query names. A query touches their
  neighbourhood, not the graph.

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
  `target_name` on a relation. `semantic_type` is not scored. `source_type` and
  `target_type` are optional, but when written an end resolves only to a mention of that type, so
  a wrong one loses the relation: leave them out, or copy the mention's type. `description`,
  `properties`, `count` and `confidence` (your own 0 to 1 estimate) are part of the row but not
  scored, and no scored stage reads yours: graph building and retrieval get the gold's. They matter for the system the
  graph is for (`count` separates a document's subject from a thing it names once; What the graph
  is for), so write them when it costs nothing, and never trade a scored field for them. The
  document's `domain` has no row in the prediction schema: don't write it.
- **No frequency floor.** Every gold row counts, including entities named once, so a row you leave
  out for being rare is a missed row.
- **Density.** Train's documents carry 19 to 33 mentions and 21 to 37 claims each,
  about 0.9 mentions per 1000 characters of body text. Held-out gold is denser: more rows
  per 1000 characters. A system that returns train-like counts on a held-out document has stopped
  early. On train, read the missed mentions under `--details` by where they sit in the article,
  not only the total.
- **A wrong type is a miss and a false positive.** Mentions match only on equal type. The pairs
  that match when type is ignored are listed per document under `--details` (`type_errors`); the
  report has no type-accuracy number.
- **Unnamed things.** When an article describes a method or system without naming it, the gold row
  carries a short descriptive label. Recall leaves those gold rows out (no extractor can guess the
  label); a label you coin counts as a true positive only if it keys to a gold row, else as a false
  positive.
- **One row per entity per document.** Two spellings of one entity in one article are one row: the
  name plus an alias.
- **The document's own wording must be a name or alias.** A row is matched by its name or any
  alias, so either `name: "RAG"` or `name: "Retrieval-Augmented Generation", aliases: ["RAG"]`
  scores the same. Reusing the known name is optional: it joins the two in extraction already,
  where otherwise graph building must. The gold does both: most rows reuse known names, and some
  keep their own variant (`RAG`, `LLMs`, `AI agent`), joined later by a merge decision.
- **`related_to` ends** name two mentions of the same document (by name or alias), in the direction
  the claim reads: "Anthropic develops Claude Code", not the reverse. The gold reads component
  `part_of` whole, instance `instance_of` class, organization `develops` product, tool `used_for`
  method, method `applied_to` system. That describes the gold; as rules in the extractor's
  prompt, direction lists did not help (`lessons.md`, Failed, more than once). The starter's
  claims prompt carries one.
- **Claims are subject-centred and span sentences.** An article's central subject is one end of a
  large share of its claims; that is the gold, not a defect to suppress. A claim is any relation the
  article states between two entities you extracted, wherever the two are named: a list item, a
  comparison table, a sentence two paragraphs after the subject was introduced. Filters on claims
  cost recall here, and so did giving a section's claims call ends from outside that section
  (`lessons.md`, Failed, more than once): the starter asks per section, between that section's
  entities.
- **One label per claim.** Reuse a `semantic_type` you already wrote in earlier documents rather
  than rewording it (`applied_to`, never `applies_to` beside it). Held-out gold labels are never
  shown to you; train's are in `train/examples/extraction.jsonl`. **Why:** labels are not scored,
  but a graph with two spellings for one claim can't be queried by label. Train's claims use 26 labels, and eight
  of them (`uses`, `used_for`, `instance_of`, `implements`, `compared_with`, `applied_to`, `supports`,
  `integrates_with`) cover most claims. Reuse before coining.

### 2. Graph building

**What:** fold surfaces into entities, in document order. A surface is one `(type, name)` as the
extractor wrote it; an entity is one referent. Two surfaces are one entity only when they denote the
same thing (`ontology.md`, Identity).

When evaluated, the input is extraction rows that each carry a `surface_id`, plus, in
history, merge rows (`same_as`: `from_id` is the same entity as `to_id`; a merge whose reason is
`ruling` is one a curator decided, which no key explains). Return one line per
surface: its `surface_id` and an `entity_id` of your own. Only which surfaces share an `entity_id`
matters; the strings are yours.

- **A surface id is shared across documents:** the same `(type, name)` in two documents is one
  `surface_id`, already one entity. Every other merge, `json schema` onto `JSON Schema` included, is
  a decision you make and is scored. A surface first seen in history is a history surface; your
  line for it, if any, overrides the given history.
- **The evaluation runs `gold-history`** (the history's merges given). The scorer's other mode,
  `end-to-end`, gives none; train has no history, so on train the two are the same and there is
  nothing to compare.
- **Keys, aliases and acronyms are the baseline; three bands are the addition.** Merging by rule,
  with no model, found nearly every merge on the articles so far: keep it. For the surfaces the
  rules leave, embeddings give each candidate pair a similarity, and two thresholds cut it in
  three: merge, new entity, or ask the decision model (Graph data flow). Finding a duplicate
  matters enough here to pay for those calls, but like every suggestion here the addition stays
  only if it is measured: it finds merges the rules missed and adds no wrong one.
- **A wrong merge is worse than a wrong split.** **Why:** a later merge heals a split; nothing heals
  a merge that destroyed a distinction (`tool calls` folded into `tool calling` loses the request
  apart from the practice).
  When in doubt, keep two entities apart. Precision and recall are scored apart for this reason, and
  the trade is one-sided: treat a change that raises recall while lowering precision as a
  regression unless you can name the merges it gets right.
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
- **An alias that narrows a name is not an alias.** A longer name that denotes a narrower thing
  (an invented `Pydantic for Agents` on `Pydantic`, `Wikipedia research agent` on `research
  agent`) is a variant: a second entity. A longer name the corpus uses as shorthand for the same
  thing is an alias (`orchestrator agent` for `orchestrator`; `ontology.md`, Identity). The
  strings alone don't tell the two apart: the starter's check treats every added word as
  narrowing, so it drops the second kind, which train's gold has.
- **Watch short generic aliases.** Once `agent` or `workflow` is an alias of one entity, every
  later bare use resolves there.

### 3. Retrieval

**What:** load the gold graph you're given into a store, alongside the corpus, and for each query
return one envelope. A suggestion: Ladybug (`runtime.md`), an embedded graph database, queried with
real Cypher rather than by walking the JSON. Retrieval is always scored on the gold graph (in your bundle,
`train/graph.json`; when evaluated, the full one over every article), so its numbers measure
retrieval alone and compare across systems. Use the graph's `documents`, `entities` and
`relationships` (`mentions`, `related_to`) as given; never feed it to extraction or graph building.

**What a one-hop query is for:** a reader has a topic and asks what the pile says about it. The
answer is the topic's own edges that bear on the question, each a claim some document made, with
the entity at the other end. So the edge is the unit that is scored, and a wrong edge is a wrong claim
shown to the reader: ten edges around the anchor are not an answer to a question about one of
them. Edge precision is reported beside the primary metrics for that reason.

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
  is an artifact of how the set was built. This is a rule of the evaluation, not a suggestion.
  **Why:** a real query carries no kind, so a system that reads it from the id scores what it
  can't do.
- **Order is your ranking.** Best first in each list.
- **Anchors** are the entities the query names. In the gold each expected node has a `role`:
  `anchor` (named in the query), `bridge` (a hop on the way) or `answer`. Nothing scores a
  returned anchor. Answer MRR reads the rank of the first `answer` node in `nodes`, so list answer
  nodes above anchors; the starter lists anchors first.
- **An edge is found only when both ends and the direction are right.** `compared_with` and
  `alternative_to` count either way; the label is not required to match. **Why:** a node can come
  back for the wrong reason, an edge can't.
- **Return what answers the query, not its neighbourhood.** Edge recall reads only your first 5
  edges. Edge precision is the share of all returned edges that are expected: a diagnostic, with
  no threshold. Returned documents are not scored.
- **`passage_tokens`** is optional: the tokens of text your engine would hand a reader for this
  query. The schema allows it and the scorer ignores it.
- **Abstain, carefully.** Some queries name nothing the corpus holds, and the right envelope for
  them has `nodes`, `edges` and `docs` all empty. Those queries are not scored, so an abstention
  check can only cost points: every `single_hop` answer it wrongly empties is lost. Abstain when
  no anchor resolves; before adding a model check, count the `single_hop` queries it empties on
  train.

Query kinds, and what a good answer holds. Write an envelope for every query, whatever its kind
(a missing one counts as empty); only `single_hop` is scored (What you're optimizing):

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
layout, every stage wired and runnable (its README says what each module does out of the box).

```
graphrag/
  __main__.py        CLI: extraction | graph | retrieval
  config.py          thresholds and sizes, loaded from config.toml
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
    keys.py          the scorer's normalized key (with text_normalize.py beside it)
    resolve.py       exact, alias; narrowing check; collision drop; a hook for acronym, fuzzy and embedding nominations (not called yet)
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
model and treat a looping reply as `runtime.md` says (Typed replies), with a row cap as a second
sign of a loop, then a deterministic filter with a closed list of reasons (the starter's:
`unknown_type`, `blank_name`, `type_conflict`, `endpoint_not_mentioned`, `self_loop`,
`duplicate_claim`, and `critic_drop` when the critic is on; never a count floor), then the union
across sections into one row per key per document: counts summed, aliases joined, one type per
key. Keep the rejected rows in a file of your own: reading
them on train is how you tune the filter.
Log one line per document on stderr: sections, looping replies split or given up, rows kept, rows
rejected by reason. A document far denser or sparser than the others is the first thing to read.
Relation work goes through this stage's mention recall: a claim whose end was never extracted
can't be found (`lessons.md`, The lever for relations).

**Graph data flow.** Rows in `seq` order, a key index per type, and for each surface:

1. **Identity by rule.** An exact key hit; an alias key hit (unless the alias narrows the name or
   another entity of the type already owns it); an acronym that is the initials of exactly one
   entity of the type. No model. This is the baseline.
2. **Candidates.** For a surface no rule places: the few entities of the same `type` nearest to
   it by embedding (the name with its type and description), from an index.
3. **Vetoes.** A version or family member, a longer name for a narrower thing, a practice
   against the artifact it produces (`ontology.md`, Identity). An embedding reads these
   as near-identical and they are two entities, so check them in code and drop the candidate
   before any band.
4. **Three bands on the similarity.** Above `high`: merge. Below `low`: a new entity. Between
   them: ask the decision model whether the two are one referent, with both names, types,
   aliases and descriptions in `state`, and merge only above its own threshold. Use what the log
   rows carry: on train `--root` holds the articles, but the evaluation gives the graph stage
   none.
5. **The assignment.** Write the surface's `entity_id`: the entity it merged into, or a new one.

Set `low`, `high` and the decision threshold on train's merges and non-merges, in `config.toml`.
Similarity alone is not identity, so `high` is safe only above every train pair that is two
entities; if nothing is left above such a value, the high band is empty and every candidate above
`low` goes to the decision model. Score steps 2 to 4 against step 1 alone: the merges the rules
missed so far were curated rulings, and the bands are for those and for the paraphrases a larger,
more varied pile brings. The starter has the key and alias rules; its hook for acronym, fuzzy and
embedding candidates returns nothing and is not called yet. The scorer's key is `normalize` in
`/spec/scorer/scripts/compile.py`; your repository ships the same function as
`graphrag/graph/keys.py`, because `/spec` does not exist when evaluated (`train.md`, What you
submit).

**Retrieval data flow.** The gold graph into Ladybug tables (`Entity`, `Document`, `MENTIONS`,
`RELATED_TO` with `semantic_type` and `doc_uri`; `runtime.md` has a schema), anchors from the query
(a key match on names and aliases, then embeddings), the anchor's edges as candidates, a shortlist
by BM25 and embeddings, a rerank of the shortlist, and an empty envelope when no anchor resolves (3. Retrieval,
Abstain, carefully; never a threshold on rerank scores, `models.md`, Reranker). That is `single_hop`, the scored
kind. The other kinds each take one more Cypher template (`runtime.md` has them): answer them, but
spend rounds on them only after the scored metrics pass. `lessons.md` records what raised
multi-hop; since a query carries no kind, path and bridge edges must never push a one-hop
answer's edge out of the first 5. The starter has the templates for an anchor's edges, paths and common
neighbours, returns an anchor's documents without a window, ranks by fixed scores and abstains only
when no anchor resolves.

**Knobs belong in `config.toml`,** read at start: section size, candidate counts, thresholds,
concurrency, model names. Tune them on train, and move a constant into the config before you try a second value for it.

## Where models help

Starting points, not requirements. `models.md` has one card per model: how to call it, what it
costs, and where it failed here. Every call costs time and money (`models.md`, The cost of a run),
so try a change on train and keep what raises a metric there.

| stage | where a model fits | card in `models.md` |
|---|---|---|
| extraction | the chat model writes the log: rows from each section, with the canon of known entities the section names; a critic pass over the document's rows (keep, drop, fix type) | Chat |
| graph building | rules first, with no model; then, as an addition to measure, embeddings score candidate pairs of the same `type` into three bands and the decision model settles the middle one (Graph data flow) | Embedding, Decision |
| retrieval | embeddings link query phrases to anchors and, with BM25, shortlist an anchor's edges; the reranker orders the shortlist; the decision model can say whether a query names anything the corpus holds, which is unscored (3. Retrieval, Abstain, carefully) | Embedding, Reranker, Decision |

## Open hypotheses

Changes to extraction that no earlier attempt has tested, in a suggested order. Extraction is where
the metrics fall short. Earlier attempts passed graph building and `single_hop` retrieval with the
recipes in `lessons.md`. The starter does not have them yet (no acronym rule, fixed-score ranking,
anchors listed first): build those first. The one addition to measure there is the three bands
(Graph data flow).
Each is a hypothesis, not a rule: it names the train measurement that
decides it. Measure paired (`train.md`, Scoring your work on train), keep it only if the measurement
moves, and say in your notes which way it went.

1. **Narrowed variants as their own entity.** **Problem:** the canon says "write these names", so a
   qualified variant (a multi-agent form of the agent class, a family member of a base model) is
   written as an alias of the broader known entity. The article's own entity goes missing and its
   claims land on the broad one (`lessons.md`, The lever for relations). **Try:** present the known
   names as candidates, not as names to write (the input gives no description for them), and say
   that a longer name for a narrower thing is a new entity, never an alias (2. Graph building has
   the same rule for merges).
   **Measure:** on train's documents that have known entities, the count of rows whose alias adds a
   word to a known name, with mention precision and recall beside it. The count should fall and
   recall should not.
2. **Type contrast.** **Problem:** a wrong type is a miss and a false positive, and most missed
   relation ends are methods or systems. **Try:** beside the ontology's definitions, show pairs that
   train's gold types differently and why (a method against a system that implements it, a tool
   against a system). These are type examples, not a section with its gold rows, which was flat
   (Domain knowledge). List the documents they come from in
   `fewshot.json`. **Measure:** the count of `type_errors` under `--details`, on the documents the
   examples do not come from.
3. **Code masking.** **Problem:** code symbols typed as tools or systems are a named source of false
   positives; a rule that drops single code-style identifiers removes them after the fact
   (`lessons.md`; the starter has no such rule). **Try:** in the entities call only,
   replace each fenced code block with a one-line placeholder, and leave the claims call's text
   whole. **Measure:** mention precision, and recall on the gold entities a document names only
   inside code (an import, a client class): if those are lost, mask the block's body and keep its
   import lines.
4. **Section context.** **Problem:** a section read alone doesn't say what "the framework" or "this
   approach" refers to. The starter's calls carry the title and the section's own heading. **Try:**
   (a) the full heading path, parents included; (b) the same plus one sentence on what the article
   is about. **Measure:** the missed mentions under `--details`, section by section, and the false-positive claims that have the
   article's subject as one end. Variant (b) is the risky one: prompts framed around the subject
   linked it to everything near it (`lessons.md`, Failed, more than once), so drop it if those
   claims rise.

## What you're optimizing

Primary metrics, all in the evaluator's report:

| stage | primary | why |
|---|---|---|
| extraction | mention F1 (micro) and `related_to` F1 (directed), with their precision and recall | entities and claims are what the graph is made of; a mention with the wrong type is a miss |
| graph building | B-cubed recall, with precision held high, against the history-only baseline | the baseline merges nothing new; only recall above it measures your merging |
| retrieval | `single_hop` only: edge recall@5 and answer-node MRR, with edge precision beside them | the other kinds are answered but not scored; MRR reads whether the answer comes first, and precision stops recall being bought by returning everything |
