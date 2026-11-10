---
title: Agent Memory From Scratch
type: rss
published: '2026-07-14T00:00:00+00:00'
length: '3098'
source: decodingai-paul
source_id: 01kxfx2sybpcry8aacabd9ddgt
source_url: https://www.decodingai.com/p/how-to-implement-a-unified-memory-from-scratch
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: Ingest, query, and serve a unified memory from a single database.
saved_at: '2026-07-14T08:49:43.955000+00:00'
updated_at: '2026-07-14T08:49:48.166246+00:00'
reading_time: 12 mins
---

[![Many sources. One record. That is what a unified memory buys you.Many sources. One record. That is what a unified memory buys you.](https://substackcdn.com/image/fetch/$s_!Cr9k!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd8b3401e-0a72-4e13-ba67-9a2863a387a2_1376x768.png "Many sources. One record. That is what a unified memory buys you.Many sources. One record. That is what a unified memory buys you.")](https://substackcdn.com/image/fetch/$s_!Cr9k!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd8b3401e-0a72-4e13-ba67-9a2863a387a2_1376x768.png)

Agent memory is one of the hottest problems in AI engineering right now, with Graphiti, mem0, HydraDB, and cognee all racing to solve it. A race this crowded means one thing: nobody has cracked it yet.

But if you’re thinking of jumping straight into an agent memory tool without understanding how it works under the hood, read this first.

> Here is what happened in one of my tests: LangChain’s `MongoDBGraphStore` gave me a knowledge graph (KG) in 10 minutes, and from 5 documents it invented 17 node types and 34 relationship types, where `part_of`, `Part Of`, and `part of` were three different ways to express the same relationship.

That’s why it’s incredibly important to **understand how the memory layer works under the hood**, so you know its limitations, how to properly configure it for your data, and how to plug it into your agent.

Or even decide if **you need a unified memory at all, and if so, which tool to use.**

Claude Code comes with a built-in memory layer powered by files. Is this enough for you or not?

Then, if you move to a more powerful solution, should you use a vector database, a graph database, or a combination of both? Do you need temporality or versioning?

And ultimately, how should you serve your memory layer to your agent? Through an MCP server, a CLI, or plain skills?

The reality is that there is no blueprint on how to build your own unified memory layer. Too many choices, too many trade-offs.

But that’s why I want to show you how to build a unified agent memory from scratch, in the most complicated way possible: via knowledge graphs (KGs). Plus all the other moving pieces: ingestion, querying, and serving.

**Why?** Because all the popular vendors (cognee, Graphiti, Neo4j’s agent memory, etc.) go in this direction. Plus, if you know how this works, it will be incredibly easy for you to build simpler solutions.

So, I am not saying that KGs are always the way to go. They are not. But they are definitely something you need to understand. At least to know when to stay away from them.

Let’s go!

## A Session With a Unified Memory

First, here is what I expect a unified memory plugged into a harness to do.

I open Claude Code and ask what I need to do today. The memory already knows: building a coding agent for my next open source project.

I ask it to gather everything relevant I have on building a coding agent: Obsidian notes, Readwise highlights, starred repos, all ingested long ago. Then to build an LLM wiki on top of that as my agent memory while I implement the plan.

When I’m done, the conversation is ingested too, so the next session already knows all my decisions around the project.

Nothing in that session lived in the harness. Claude Code was just the interface.

So how do I implement a unified memory that supports this? Let’s kick off with the architecture.

## The Architecture, End to End

Sources in, subgraphs out. In between sit 4 pieces: an ontology, a write path, one collection, and a serving layer.

The whole database layer is powered by [MongoDB](https://www.mongodb.com/): a document warehouse plus a knowledge-graph store doing text, vector, and graph search in one collection. Because we use a single database, lineage is free: nodes hold references to their source documents, not copies from a separate source. This works incredibly well at 2-3 hops at query time.

OG databases such as MongoDB scale really well up to millions of documents via sharding and replicas.

Writes are 2 durable pipelines. A data pipeline normalizes each source into the warehouse. A memory pipeline cleans, chunks, extracts, normalizes, embeds, and writes the knowledge-graph objects. Both pipelines are powered by an orchestrator, such as Prefect or DBOS, to serve them, scale them, and make them durable.

On the read side, we offer multiple ways to interact with the unified memory: standard graph search encoded directly into the tool, agentic search where the agent writes its own MongoDB query, and a deep-search primitive that creates an on-demand LLM wiki for exploring larger subgraphs via progressive disclosure. Reads never touch the orchestrator, as they need to be fast and don’t benefit from the orchestrator’s durability or scheduling features.

The memory is reachable only through a FastMCP server exposing agent-shaped primitives (query, deep-search, ingest), never raw database operations. The MCP server should never be an API wrapper, but directly expose business logic to the harness. A hook fires the conversation ingestion as the session runs, so what the agent learns flows back into the memory — a process known as “continual learning.”

[![The full dataflow — data pipeline, memory pipeline, one MongoDB engine, the MCP server, and the harness with its skills.](https://substackcdn.com/image/fetch/$s_!qby_!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb4ba4d2e-41d4-4847-b2ce-f95abe5ff76f_600x600.png "The full dataflow — data pipeline, memory pipeline, one MongoDB engine, the MCP server, and the harness with its skills.")](https://substackcdn.com/image/fetch/$s_!qby_!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb4ba4d2e-41d4-4847-b2ce-f95abe5ff76f_600x600.png)

The most interesting part is not the database, the ingestion, or the query logic, but the ontology that makes everything possible.

## The Ontology Is the Contract

An ontology is a contract between the writer and the reader. The LLM extracts against it. The query layer reads against it. Define it once as Pydantic, serialize with `model_json_schema()`, and dump that JSON into both writing and reading system prompts. 1 artifact, 2 consumers, no drift.

[![The unified memory's three layers, with the POLE+O ontology at the core of the long-term graph.](https://substackcdn.com/image/fetch/$s_!k41v!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F0df98727-adf0-400d-ae27-3e6dd3cd5177_1200x1006.png "The unified memory's three layers, with the POLE+O ontology at the core of the long-term graph.")](https://substackcdn.com/image/fetch/$s_!k41v!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F0df98727-adf0-400d-ae27-3e6dd3cd5177_1200x1006.png)

*One memory, three layers*

The ontology defines what the knowledge graphs look like. All the KG instances are extracted by passing the input data and the ontology schema to an LLM.

The memory is 3 layers. The long-term layer is the knowledge graph: the POLE+O entities plus `preference` and `fact`. A short-term layer holds the dialogue as `conversation` and `session` nodes. A reasoning layer records the agent’s work as `agent`, `tool_call`, and `memory` nodes.

[![The ontology as a contract — data plus the POLE+O ontology go into extraction, and knowledge-graph instances come out.](https://substackcdn.com/image/fetch/$s_!iXbI!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F923ca4d3-e1fc-44d4-bdc3-c1fae8391130_1200x630.png "The ontology as a contract — data plus the POLE+O ontology go into extraction, and knowledge-graph instances come out.")](https://substackcdn.com/image/fetch/$s_!iXbI!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F923ca4d3-e1fc-44d4-bdc3-c1fae8391130_1200x630.png)

*The ontology is the contract the extractor reads. The same POLE+O nouns, preferences, and facts on the left; the graph they produce on the right.*

One powerful ontology design is based on the 5 POLE+O nouns from law-enforcement analysis: Person, Object, Location, Event, Organization, which Neo4j Labs writes up as the [POLE+O data model](https://neo4j.com/labs/agent-memory/explanation/poleo-model/). Each noun carries an optional subtype used to further refine the ontology within a specific domain. For gaming, this can look like:

* Person: Player, Character
* Object: Item, Quest
* Event: Raid, Battle

Because the agent memory is often used for a personal assistant, you also need to plug `preference` and `fact` nodes into the ontology. A **fact** is an atomic subject-predicate-object triplet, an island no edge may touch, reachable only by similarity. A **preference** is the personalization layer with typed slots.

```
nodes: person · organization · location · event · object
       preference · fact
edges: related_to, with semantic_type ∈ {
         knows, member_of, employed_by,
         owns, uses, located_at, resides_at,
         alias_of, has_task, ... 
       }
```

Now, on top of the KG instances extracted by the LLM, we can also have structured nodes that are directly inferred via code.

Such as:

```
nodes: document · chunk
edges: part_of · next · mentions · referenced · has · same_as · superseded_by
```

There is a lot more to talk about ontologies. I have a [full article](https://www.decodingai.com/p/ship-a-knowledge-graph-ontology-in-5-minutes) just on this.

With the contract fixed, let’s see how we can ingest KG objects into the unified memory based on the ontology schema.

## The Write Path

There are 7 stages in one direction. Chunk the document (512-token chunks, 64 overlap). Extract nodes and edges with an LLM. Validate. Resolve names. Embed. Deduplicate. Upsert into the MongoDB unified memory.

[![The extraction pipeline feeding the per-entity normalization algorithm — resolution, then deduplication, with the score thresholds that govern each.](https://substackcdn.com/image/fetch/$s_!vN7D!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6298cf69-c546-42e4-8702-f0f5347ddf9b_1200x1009.png "The extraction pipeline feeding the per-entity normalization algorithm — resolution, then deduplication, with the score thresholds that govern each.")](https://substackcdn.com/image/fetch/$s_!vN7D!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6298cf69-c546-42e4-8702-f0f5347ddf9b_1200x1009.png)

*The write path. Deduplication — the ≥0.95 merge / ≥0.85 flag / else new-node branch*

During the LLM extraction, we pass in a chunk and we receive a JSON response with nodes and edges, the same shape Neo4j Labs lands on in [How Entity Extraction Works](https://neo4j.com/labs/agent-memory/explanation/extraction-pipeline/).

The model sees one chunk and nothing else. It receives no IDs and no prior state. It returns JSON. Every edge endpoint points to a node’s `name` in the same record. This allows us to scale the extraction pipeline through batching to process large documents of 1,000,000+ units.

[![code](https://substackcdn.com/image/fetch/$s_!Qssu!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdf5826f4-ab01-4d78-b2a8-8e562f1e38fe_2120x2035.png "code")](https://substackcdn.com/image/fetch/$s_!Qssu!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdf5826f4-ab01-4d78-b2a8-8e562f1e38fe_2120x2035.png)

Validation is done via Pydantic. We load the JSON response into a Pydantic model and validate it against the schema.

Name resolution only checks whether two canonical names match. It’s done purely on the name and its aliases: alias, exact, fuzzy 0.85, semantic 0.80, filtered by type.

But there is a next step, where we actually check if an entity is the same instance as another that already exists in the graph.

Deduplication runs on embeddings computed on the whole node content: ≥0.95 cosine merges, ≤0.85 makes a new node, and the gap writes a `same_as` edge for a human to judge.

So why two steps?

Name resolution simply helps us group entities by their canonical name. For example, “Demis Hassabis” and “Demis Hassabis, CEO” would both be resolved to “Demis Hassabis”. Or “Apple” and “Apple Inc.” would both be resolved to “Apple”. Super powerful for analytics and human curation.

Deduplication is the sensitive one — it decides what actually merges. It shouldn’t flag “Apple” and “Apple Inc.” as duplicates, as they are different entities with different meanings.

A wrong merge is the only unrecoverable mistake. That’s why, when the similarity score has low confidence, between 0.85 and 0.95, we don’t merge the nodes automatically, as the operation can be irreversible.

I break the full algorithm down in [Keep Your Knowledge Graph Clean](https://www.decodingai.com/p/keep-knowledge-graph-clean).

Which leaves the question that decides your RAM bill: once the triplets are extracted, how do we store them in the unified memory?

## Append-Only Logs vs. a Single Knowledge Graph Collection

There are 3 designs, and the winner? Well... It depends... As always.

An **append-only log plus a materialized view** buys versioning and soft-delete for free, but you pay for it. **Nested relationships** duplicate edges and make them awkward to query. **Separate edge docs** give queryable edges, no duplication, and the cheapest footprint, at the cost of built-in temporal history and versioning.

[![Three ways to store the same graph in MongoDB, and what each one costs you.](https://substackcdn.com/image/fetch/$s_!pc0N!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fab164d43-00b7-4a1c-83cb-8457cb5cf35d_1200x934.png "Three ways to store the same graph in MongoDB, and what each one costs you.")](https://substackcdn.com/image/fetch/$s_!pc0N!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fab164d43-00b7-4a1c-83cb-8457cb5cf35d_1200x934.png)

*Append-only log, nested relationships, or edges as first-class documents.*

Because the graph is a projection of the append-only log, a bad extraction is fixed by invalidating its event. You can change the materialization logic and replay it without re-extracting a single source. Also, full-graph temporality belongs to the log alone.

The log’s real cost: a vector index is at least as large as the data it covers. Indexing both the log and the view inflates ~10 GB of data toward ~40 GB of RAM. Index only the view, leave the log cold on disk, and it collapses back toward ~10 GB. But the idea is that adding an append-only log brings a lot of engineering effort you then have to maintain.

So think three times before you sign up for it.

[![The two data models behind the log design — the append-only immutable log and the materialized view it projects into.](https://substackcdn.com/image/fetch/$s_!2XrE!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F98a7e08c-bd36-4811-9dc2-446e780ace5f_1200x1031.png "The two data models behind the log design — the append-only immutable log and the materialized view it projects into.")](https://substackcdn.com/image/fetch/$s_!2XrE!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F98a7e08c-bd36-4811-9dc2-446e780ace5f_1200x1031.png)

*The view is a projection of the log — dedup is one aggregation that squashes events by entity ID (an early run: 244 log entries → 70 nodes + 104 edges). Roadmap, not shipped; the build writes separate edge docs instead.*

At query time, the agents see the materialized view, not the log itself. Given the RAM cost, reach for the log only when versioning or the time dimension is core to your business logic. Otherwise, keep it simple and stick to a single knowledge graph collection.

Within the data model, Node IDs are `{user_id}:{type}:{name}`. Edge IDs are `{source}|{type}|{target}`. Because the key is content-derived, every write is idempotent.

The reality? You can get temporality even without a dedicated append-only log. Preferences and facts carry `valid_from` / `valid_until`, and a superseding preference writes a `superseded_by` edge.

## Three Ways to Read the Memory

The 3 retrieval methods below are the serving layer’s search primitives, the tools the MCP server exposes to the agent.

**Graph search** is the default retrieval, baked into a single function. It runs `$vectorSearch` and `$text` in parallel over the KG collection. Fuse the *ranks* with [Reciprocal Rank Fusion (RRF)](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf). Keep the fused top 10 as seed nodes, then expand with a bidirectional `$graphLookup` at 2 hops by default. That multi-hop step is the entire difference between RAG and GraphRAG.

**Deep search** widens the walk to 3 hops and persists the result to disk as a memory wiki the agent can access via progressive disclosure. The LLM wiki is a mini-graph of its own: you keep the (entity, relationship, entity) triplets by cross-referencing files, where each file is an entity. You can see it as a local cache that is either discarded between sessions or kept in sync with the KG collection.

**NL query** is agentic search that lets the LLM write its own MongoDB queries based on the ontology. Here you have to validate that the query is syntactically correct, and especially guard it against harmful intents such as deleting or modifying data. It’s safer to use this mode purely for read operations.

[![The three retrieval methods — graph search, deep search, and NL query — plugged into the agent through the MCP server.](https://substackcdn.com/image/fetch/$s_!LJc3!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7cf6f9b0-9519-4135-b923-c88bd051390d_1245x1036.png "The three retrieval methods — graph search, deep search, and NL query — plugged into the agent through the MCP server.")](https://substackcdn.com/image/fetch/$s_!LJc3!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7cf6f9b0-9519-4135-b923-c88bd051390d_1245x1036.png)

*Three ways in: graph search fuses then walks one hop; deep search walks three hops and writes a wiki; NL query lets the LLM author the aggregation against the ontology.*

RRF replaces a reranker (a second model that re-scores the retriever’s top candidates) you don’t need yet. It is 20 lines of Python, needs no model, and runs in microseconds. Reach for a cross-encoder (a heavier model that compares the query against each candidate) when you search millions of heterogeneous documents.

**When do you need to switch from a single database (MongoDB) to a graph database (Neo4j)?** Past 4 hops, past ~100M to 1B vectors, when graphs *are* your business logic, or purely to visualize them: that is where you leave MongoDB for Neo4j. It’s common to use a single database in production (MongoDB) and a graph database as an internal tool for data exploration and analysis (Neo4j). This is a powerful combo, because for an internal tool you don’t care that much about 99.99% SLAs, while you can fully leverage Neo4j’s Cypher query language to explore and analyze your graph data.

## Open, Closed, and Small

Extraction (from ingestion) and query translation (from agentic search) use `gemini-3.1-flash-lite`. Embeddings are Voyage `voyage-3.5` at 1024 dimensions. Both are closed APIs.

You can take this further and fine-tune an open-source SLM (such as the Liquid family of models) as an extractor, query translator, or embedding model on your own data.

The issue with SLMs is that without fine-tuning they perform poorly on new data. But the beautiful part about them is that after fine-tuning they perform as well as a frontier model on a scoped task, while being much cheaper and faster to run.

I won’t go too much into fine-tuning here, but the idea is that at first you always want to start with an API that quickly gets stuff done, and then slowly replace the most important parts with your own fine-tuned models. You usually have to decide this based on cost, latency, performance, data privacy, or other dimensions important to your use case.

## Build vs Buy: When Not To Build This

Everything above assumed you build everything yourself. But in reality, there are 3 levels to choose from.

**Level 1:** build the memory, the logic, and the serving layer yourself on one database.

**Level 2:** keep only the business logic and serving layer on top of a memory SDK, such as [Graphiti](https://github.com/getzep/graphiti), `neo4j-labs/agent-memory`, or [mem0](https://github.com/mem0ai/mem0).

**Level 3:** run an off-the-shelf engine, such as [cognee](https://github.com/topoteretes/cognee), managed [Zep](https://www.getzep.com/), or [HydraDB](https://hydradb.com/).

This is a problem about owning your context layer, which I have a [full article](https://www.decodingai.com/p/the-context-layer) on.

Buy when you don’t care that much about customization. Build when you want *your* own solution. But since building everything yourself usually isn’t worth it (or you just don’t have the time to do it — even with Claude Code), the best solution is **Level 2**, where you own the business logic and can customize the serving layer to your needs.

But honestly, because things move so fast and I am lazy, my long-term memory still lives in Obsidian, Readwise, and Google Drive, plus a serving layer that creates scoped LLM wikis per project as agent memory. This way, you create mini-graphs for one specific problem, powered purely by .md files, without any infrastructure hassle. The reality is that this works for personal use only, and not so much for shipping a production-ready solution. I write about that approach in [LLM Wikis as Agent Memory](https://www.decodingai.com/p/llm-wiki-agent-memory).

Still, I am applying the strategy based on KGs and ontologies to build **Pulse**, a data mining tool that runs the exact same strategy presented above on a knowledge-work ontology to extract the top 0.1% signal from the AI industry. I want it custom because I want it to be super light, powered by LadybugDB, and to leverage my Claude subscription for the extraction and deduplication part, built as a hybrid between skills and Python modules.

*But here is what I’m wondering:*

> ***If you keep dumping everything into the unified memory, where do you draw the line between what your agent should remember forever and what it should be allowed to forget?***

*Click the button below and tell me. I read every response.*

[Leave a comment](https://www.decodingai.com/p/how-to-implement-a-unified-memory-from-scratch/comments)

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/how-to-implement-a-unified-memory-from-scratch?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---

*Special thanks to [MongoDB](https://www.mongodb.com/) for sponsoring this article and keeping it free!*

[![](https://substackcdn.com/image/fetch/$s_!c1Gm!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F143757ba-2cb8-4d2f-be0e-dbd29fcbb7d0_1200x400.jpeg)](https://www.mongodb.com/)

---
