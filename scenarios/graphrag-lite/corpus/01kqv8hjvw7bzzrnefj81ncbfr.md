---
title: Building Agentic GraphRAG Systems
type: rss
published: '2026-05-05T00:00:00+00:00'
length: '3199'
source: decodingai-paul
source_id: 01kqv8hjvw7bzzrnefj81ncbfr
source_url: https://www.decodingai.com/p/agentic-graphrag
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: From knowledge graphs and ontologies to a unified memory as an MCP server
  for your AI agent.
saved_at: '2026-05-05T05:07:30.373000+00:00'
updated_at: '2026-05-05T05:07:34.460932+00:00'
reading_time: 13 mins
---

[![GraphRAG at a glance. Fragmented sources unified into a single knowledge graph the agent reads from and writes back to via two tools.](https://substackcdn.com/image/fetch/$s_!XYED!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff21aa3d9-5221-4fef-a924-aea1f1eb9076_1400x1000.png "GraphRAG at a glance. Fragmented sources unified into a single knowledge graph the agent reads from and writes back to via two tools.")](https://substackcdn.com/image/fetch/$s_!XYED!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff21aa3d9-5221-4fef-a924-aea1f1eb9076_1400x1000.png)

*Image 1: GraphRAG at a glance.*

I gave this talk twice in one month: at O’Reilly’s Context Engineering Event and at Abi Aryan’s Maven course on LLM inference at scale. After being blasted with questions, I realized something: GraphRAG isn’t a retrieval algorithm, it’s a data modeling problem.

Powering agents with knowledge graphs (KGs) and ontologies is still an unsolved problem. All the engineers I spoke to want GraphRAG, but don’t know how to implement it.

But at its core, we should ask a different question. Why do we even need GraphRAG in the first place? Why complicate our solution over a simple RAG system?

There are three core reasons.

First, you face context rot. As the context window fills, the signal-to-noise ratio collapses. The LLM degrades.

You pay for this degradation in quality, cost, and latency [[1]](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents).

Second, you face data fragmentation. In the agent era, your data lives in silos most builders share: documents, notes, research, emails, and text messages. We are no longer lucky enough to have all the data nicely stored in a single database.

Third, the agent’s unified memory naturally maps to a knowledge graph (KG). People have preferences and experiences. They went into specific locations, met with other people, or have a list of items to do. Things get trickier when *“Arthur told Felix that his favorite coffee shop is in the center of Timisoara”*, but after two months *“it moved to Lisbon”*. You need to start tracking relationships between people, locations, and most especially how these relate in time.

GraphRAG solves all three.

This is a data modeling problem, not a retrieval algorithm. It took a painful LangChain detour and a hard MongoDB RAM conversation to settle that for me. You need an ontology.

[![Agentic GraphRAG Architecture](https://substackcdn.com/image/fetch/$s_!K9Ds!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffefc6b09-62e0-4a2f-93b6-ad8c2ce773db_1200x1200.png "Agentic GraphRAG Architecture")](https://substackcdn.com/image/fetch/$s_!K9Ds!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffefc6b09-62e0-4a2f-93b6-ad8c2ce773db_1200x1200.png)

Image 2: The full GraphRAG system architecture.

By the end of this article, you will learn about ontology-first design, the three extraction modes, append-only data models, and hybrid retrieval joined by Reciprocal Rank Fusion (RRF). Finally, you will see how to expose the GraphRAG engine as a unified memory layer via an MCP server to power your agents. In other words, **how to do agentic GraphRAG**.

Before walking through the architecture, let’s understand why the story has to start from the ontology.

## Why the Story Starts From the Ontology

Whenever you need to connect dots across a corpus of multiple documents rather than find the most relevant paragraph, you go for GraphRAG. Knowledge is stored as entities and edges.

You traverse connections rather than find similar text.

An ontology is a collection of classes and the relationships allowed between them. If you come from object-oriented programming, you already have the right intuition.

Throughout this article, we will build a digital twin. My favorite example. We will define a Global Ontology of six entity types organized into two sub-ontologies.

The data pipeline deterministically constructs the Document Ontology. It contains `DOCUMENT` and `CHUNK` nodes. It uses `PART_OF`, `NEXT`, `REFERENCED`, and `MENTIONS` edges.

The LLM extracts the Person Ontology. It contains `PERSON`, `TASK`, `EPISODE`, and `PREFERENCE` nodes. It uses `RELATED_TO`, `TODO`, `EXPERIENCED`, and `HAS` edges.

The schema is flexible. You define it for your business case. Every section after this one assumes these exact node and edge labels.

[![ontology_example](https://substackcdn.com/image/fetch/$s_!6-9A!,w_2400,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F69db60bc-3ff8-438a-a432-cfedf2ad3622_2586x897.png "ontology_example")](https://substackcdn.com/image/fetch/$s_!6-9A!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F69db60bc-3ff8-438a-a432-cfedf2ad3622_2586x897.png)

Image 3: Left shows the Global Ontology split into a Document Ontology and a Person Ontology. Right shows an instantiated KG with nodes wired together via the eight typed edges.

Skipping the ontology carries a heavy cost. I tried LangChain’s `MongoDBGraphStore`, which lets the LLM extract entity and relationship types freely. Five documents produced 17 node types and 34 relationship types.

This included `part_of`, `Part Of`, and `part of` as three separate types. The underlying data model does not enforce a schema at the storage layer.

With an ontology, the LLM can only extract what you defined. The constrained scope also allows you to use cheaper extractor models.

That’s why GraphRAG is the right tool when you have a clearly defined schema. It works when you need to identify relationships.

It reduces hallucination on complex queries that span interconnected facts. Domains where knowledge graphs naturally fit are legal, medical, financial, business operations, productivity tools and in my opinion, the crown jewel: personal assistants. With a KG, you can naturally build the unified memory of your personal assistant to properly remember what you like, what you did, and what you have to do, all anchored in time.

For example, Palantir built their empire using ontologies. Google uses KG to power their search and Microsoft uses it in their internal ops tools.

With the ontology defined, the next architectural choice is the shape of the graph itself and how to extract those entities from raw text.

## RDF vs. Property Graphs, and the Three Extraction Modes

[![RDF vs. Labeled Property Graph on the same Arthur fact. RDF explodes every property into its own triplet. Property Graphs attach properties to the node. Agent stacks use property graphs in practice.](https://substackcdn.com/image/fetch/$s_!GtoY!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F05040c7c-d947-454a-ae93-a39e52ef86fb_1400x1342.png "RDF vs. Labeled Property Graph on the same Arthur fact. RDF explodes every property into its own triplet. Property Graphs attach properties to the node. Agent stacks use property graphs in practice.")](https://substackcdn.com/image/fetch/$s_!GtoY!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F05040c7c-d947-454a-ae93-a39e52ef86fb_1400x1342.png)

*Image 4: RDF vs. Labeled Property Graph on the same Arthur fact. RDF explodes every property into its own triplet. Property Graphs attach properties to the node. Agent stacks use property graphs in practice.*

Every graph is structured as a collection of (entity, relationship, entity) triplets. But there are two ways to attach data to each entity or relationship instance, known as Resource Description Framework (RDF) and labeled property graphs.

RDF attaches each piece of metadata as another triplet. The graph explodes in size. Property graphs attach metadata as JSON on the entity or relationship.

In practice, GraphRAG and agents use property graphs [[3]](https://www.manning.com/books/knowledge-graphs-and-llms-in-action).

Now, during **extraction**, where we actually map data into our (entity, relationship, entity) triplets, plus their corresponding data, we have three core methods.

**Structured** extraction is schema-guided. The LLM outputs entities per the Person Ontology.

**Semi-structured** extraction uses metadata and lineage without an LLM. You parse the email’s links and attachments.

**Unstructured** extraction uses an LLM without a schema. The LLM invents its own labels. This is useful for discovery, not for grounded retrieval. In other words, we use the LLM to extract triplets without an ontology. Exactly what we said to avoid in the previous section.

Here is the data-source mapping for the Person Ontology of the digital twin:

[![table](https://substackcdn.com/image/fetch/$s_!B24g!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2d668c23-2d2e-4e89-a677-7b5110ce6dd9_1920x830.png "table")](https://substackcdn.com/image/fetch/$s_!B24g!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F2d668c23-2d2e-4e89-a677-7b5110ce6dd9_1920x830.png)

Table 1: Data-source mapping for the digital twin.

The Document Ontology can be completely done through semi-structured mechanics, since we already know what document each chunk comes from, the author of each document, and the references between them.

> 💡 A student asked about open-domain extraction. Exploratory extraction is great early on when you are figuring out what ontology makes sense for your data. You can use zero-shot Named Entity Recognition (NER) models like GLiNER for that exploratory phase [[4]](http://(https://neo4j.com/labs/agent-memory/explanation/extraction-pipeline/)). Which you can easily run locally without having powerful inference hardware. Without that discipline, the output becomes unusable noise within tens of documents. A constrained scope lets you swap the frontier model for a small fine-tuned extractor like Gemini Flash Lite, Claude Haiku or even better, use Liquid open-source models fine-tuned on your ontology.

These extraction modes feed directly into a five-component system that turns raw documents into queryable memory.

## The Five-Component Architecture

The input consists of heterogeneous documents scattered across multiple silos. The output is a single queryable knowledge graph. The agent can search and write back to it via two tools.

Everything in between is plumbing built to serve that one job.

The data pipeline gathers from URIs, notes, emails and Google Drive. It normalizes everything into a document collection written to a warehouse.

The memory pipeline turns documents into knowledge-graph objects and writes them into the unified memory modeled as a KG.

The KG is the queryable artifact. The agent talks to the knowledge graph through an MCP server that exposes search and write tools.

[![the-five-component-architecture.png](https://substackcdn.com/image/fetch/$s_!YdlO!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F796f1448-9394-405d-9c74-2a20c2c8b782_1200x1200.png "the-five-component-architecture.png")](https://substackcdn.com/image/fetch/$s_!YdlO!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F796f1448-9394-405d-9c74-2a20c2c8b782_1200x1200.png)

Image 5: The five-component architecture. Sources flow through the data and memory pipelines into the materialized knowledge graph. The agent talks to it through two MCP-exposed tools.

The `search_memory` family of tools brings only the slice the agent needs into the context window. The `write_memory` tools run the same data + memory pipelines on demand on a conversation or URI instead of running them in batch mode [[5]](https://www.leoniemonigatti.com/blog/from-rag-to-agent-memory.html).

Ultimately, we connect the MCP server to a harness such as Claude Code or Codex, where we inject custom business logic on how the tools should be used through a family of `assistant-memory` and `assistant-learn` skills.

For 2-3 hop traversals, Postgres or MongoDB handle documents, vectors, and graph-lookup in a single piece of infrastructure [[7]](https://www.youtube.com/watch?v=JhfClrHIwG0).

Reach for Neo4j only when deep traversals or specialized graph algorithms are core to the product [[8]](https://neo4j.com/labs/agent-memory/explanation/graph-architecture/). Do not design for Google scale when you are processing thousands of documents.

The memory pipeline sits at the core of this architecture, transforming raw documents into the exact triplets the rest of the system queries.

## The Memory Pipeline

The memory pipeline cleans the incoming document.

Next is optional chunking. If you can avoid chunking, avoid it. It introduces problems and is more about RAG-era reflexes than a necessity. You always have to customize the solution based on your data and try to introduce as little complexity as possible.

Next, the graph extractor emits triplets. You should use Pydantic-style schema descriptors so the LLM knows how each field should look.

Normalization is the most important step. You track the evolution of a single entity over time. Do not allow multiple versions of the same person to exist. The system re-uses the same canonical ID across extractions. New metadata and new relationships layer on top [[9]](https://neo4j.com/labs/agent-memory/explanation/resolution-deduplication/).

Finally, you embed the relevant fields for semantic search.

Now, let’s look at the core ways of data models you can use to store your KG.

## Single Mutable Collection vs. Append-Only Log Data Models

There are two main approaches on how you can model your collections: as an append-only log or as a single mutable collection. Both have their pros and cons.

The append-only log consists of two collections: an append-only log and a queryable materialized view.

The system appends every event to an immutable log. A periodic materialization step squashes all events for the same ID into one canonical record.

You get versioning, temporality, and reversibility for free. You pay in RAM and operational complexity. As RAM is the most scarce and costly piece of hardware for hosting databases, this quickly translates into larger compute costs.

The single mutable collection approach drops the log. Each extraction directly upserts into the queryable collection.

You get simpler ops and real-time visibility, but the temporal audit trail is gone. Pick the single collection if operational simplicity and reduced costs beat time-travel.

Pick the two-collection append-only approach if you genuinely need an audit trail. Append-only collections never delete and never update. The same ID can appear multiple times across extractions, reflecting updates of an entity or relationship instance across the KG.

You can replay history up to a point in time, soft-delete, and revert a bad extraction. Materialization squashes all logs sharing an ID into one canonical entity.

An intuitive way of comparing the two methods is that the single mutable collection option is the same as the materialized view of the append-only option. Thus, one option comes with an append-only log, which comes with versioning and temporality, while the other doesn’t.

### How Would This Look Within the Digital Twin?

Each log event lands with an auto-generated `ObjectId` plus a single `chunk_id` and `source_document_id` pinning it to one origin, with no embedding because nothing has been merged yet into the final instance. Materialization groups events by `(name, type)` for nodes and by the `(source, kind, target)` triplet for edges, swapping the `ObjectId` for a deterministic composite ID that *is* the merge key, unioning every contributing document into a `sources` array, and embedding each canonical entity once.

[![data_model_append_only_log](https://substackcdn.com/image/fetch/$s_!zNQp!,w_2400,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5c4d1233-69a5-4efc-96c1-9e853d3b78a6_2087x1309.png "data_model_append_only_log")](https://substackcdn.com/image/fetch/$s_!zNQp!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5c4d1233-69a5-4efc-96c1-9e853d3b78a6_2087x1309.png)

Image 6: The two-collection MongoDB shape. Left column shows the append-only log node and edge. Right column shows the materialized node and materialized edge.

Nodes and edges share a single collection, separated only by a `kind` discriminator. So within our MongoDB implementation, `$graphLookup` walks `source_node_id → target_node_id` recursively without joining across collections.

[![data_model_one_collection](https://substackcdn.com/image/fetch/$s_!E-qQ!,w_2400,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe4ed1b3f-7ca3-4e9c-9e47-a74252a3189a_2292x1215.png "data_model_one_collection")](https://substackcdn.com/image/fetch/$s_!E-qQ!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe4ed1b3f-7ca3-4e9c-9e47-a74252a3189a_2292x1215.png)

Image 7: The one-collection MongoDB shape. Nodes and edges coexist in a single collection, both keyed by deterministic string IDs.

A student asked about community detection and isolated nodes. Once materialization runs, the system computes communities over the canonical node collection. An isolated node is just a singleton community. Filter or keep it based on your use case. Postgres and MongoDB handle hundreds of millions of small records. They can also scale vertically easily through sharding by partitioning on the entity and relationship IDs.

Now, let’s finally understand how we can query the KG and plug it into an agent.

## Finally...Let’s Understand the Retrieval Algorithm

During retrieval, we use a hybrid index.

Text search uses exact keywords. Semantic search is meaning-based. Graph search is a multi-hop traversal across the typed edges.

Communities are an optional fourth index for topical clusters.

[![Retrieval Example](https://substackcdn.com/image/fetch/$s_!nriB!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9f1d6313-13fa-49b8-9098-8a52d8995da4_1024x1024.png "Retrieval Example")](https://substackcdn.com/image/fetch/$s_!nriB!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9f1d6313-13fa-49b8-9098-8a52d8995da4_1024x1024.png)

*Image 8: Top-down retrieval example for the query: “Create a presentation on GraphRAG for O’Reilly”.*

GraphRAG retrieval is a two-stage move [[10]](https://towardsdatascience.com/how-to-build-a-graph-rag-app-b323fc33ba06/).

Stage 1 runs text and semantic search. It merges results with Reciprocal Rank Fusion (RRF). Apply a cutoff to get your entry points [[11]](https://substack.com/@jeremyarancio/note/c-205294494).

Stage 2 walks 2-3 hops across the typed edges to expand the result set.

During retrieval, GraphRAG’s addition over RAG is this multi-hop step, after the RRF merge, which is standard for most RAG systems.

[![Two-stage retrieval. Text and semantic search feed RRF for entry points. From there, 2-3 hop graph traversal expands the result set.](https://substackcdn.com/image/fetch/$s_!p-rw!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc07f92e0-5a0b-46a8-b96d-f3ea887de28d_1399x1254.png "Two-stage retrieval. Text and semantic search feed RRF for entry points. From there, 2-3 hop graph traversal expands the result set.")](https://substackcdn.com/image/fetch/$s_!p-rw!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc07f92e0-5a0b-46a8-b96d-f3ea887de28d_1399x1254.png)

*Image 9: Two-stage retrieval. Text and semantic search feed RRF for entry points. From there, 2-3 hop graph traversal expands the result set.*

Still, there are two important details to highlight. There’s bottom-up, which expands entities for depth, while top-down hops across communities for a high-level overview [[2]](https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/). This translates to a trade-off between context size, latency and performance.

[![Bottom-up vs. top-down GraphRAG. Both start at text and semantic search. Bottom-up expands entities for depth. Top-down hops across communities for a high-level overview.](https://substackcdn.com/image/fetch/$s_!LuE-!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb70ad9e2-6d9a-4cf7-b66d-ae7bb7b49214_1024x1024.png "Bottom-up vs. top-down GraphRAG. Both start at text and semantic search. Bottom-up expands entities for depth. Top-down hops across communities for a high-level overview.")](https://substackcdn.com/image/fetch/$s_!LuE-!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb70ad9e2-6d9a-4cf7-b66d-ae7bb7b49214_1024x1024.png)

*Image 10: Bottom-up vs. top-down GraphRAG. Both start at text and semantic search. Bottom-up expands entities for depth. Top-down hops across communities for a high-level overview.*

Now, to close the loop, let’s connect everything to an agent.

## The Cherry on Top: Agentic GraphRAG

GraphRAG becomes agentic when an agent gets to write to and search the knowledge graph autonomously [[5]](https://www.leoniemonigatti.com/blog/from-rag-to-agent-memory.html).

[![Agentic GraphRAG Architecture](https://substackcdn.com/image/fetch/$s_!K9Ds!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffefc6b09-62e0-4a2f-93b6-ad8c2ce773db_1200x1200.png "Agentic GraphRAG Architecture")](https://substackcdn.com/image/fetch/$s_!K9Ds!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffefc6b09-62e0-4a2f-93b6-ad8c2ce773db_1200x1200.png)

*Image 11: Agentic GraphRAG via MCP. The agent calls search and write tools exposed by an MCP server.*

The agent dynamically writes queries against the materialized knowledge graph using a family of `search_memory` tools. The `write_memory` family of tools runs the data and memory pipelines on the current conversation or any other type of document. This is different from the five-component architecture explained earlier, as this time the agent decides when it should search/write to the memory.

The search tools can directly implement the text + semantic + graph-search algorithm programmatically, or let the agent write the query code on-demand, which gives more flexibility at the cost of potentially less optimal code.

As for the write tools, by allowing the agent to ingest the current conversation, we ensure continual learning by dynamically keeping track of the user’s preferences, todos, experiences and more.

At the moment, harnesses such as Claude Code use the filesystem to implement the memory layer. But as the data grows, gets more complex, or we have to operate under strict cost/latency requirements, we will need more powerful solutions than just hoping the agent will figure it out through progressive disclosure.

## What’s Next

In this piece, I presented only the high-level architecture and strategies around GraphRAG.

The issue is that when you start diving into each component, such as normalization, extraction, embedding or data modeling, you will realize that everything is extremely custom to your own data and use case.

This is especially true because GraphRAG is still in its early days, where there is no clear plan of attack.

That’s why I am actively working on a new book on how to implement a personal assistant from scratch (yes, together with Maxime Labonne!), where we will explore building a memory layer stage by stage: RAG, then GraphRAG, with an AI Evals layer on top to measure the actual gain in performance when introducing GraphRAG. As soon as I have more details on this, I will let you know.

*But here is what I’m wondering:*

> ***Are you using a single database (Postgres / MongoDB) or splitting graph and vector workloads across specialized systems (Neo4j + Pinecone)?***

*Click the button below and tell me. I read every response.*

[Leave a comment](https://www.decodingai.com/p/agentic-graphrag/comments)

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/agentic-graphrag?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
