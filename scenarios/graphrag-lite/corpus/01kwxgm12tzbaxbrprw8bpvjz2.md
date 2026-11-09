---
title: Your Second Brain Is a Graveyard. Make It Agent Memory.
type: rss
published: '2026-07-07T00:00:00+00:00'
length: '2811'
source: decodingai-paul
source_id: 01kwxgm12tzbaxbrprw8bpvjz2
source_url: https://www.decodingai.com/p/llm-wiki-agent-memory
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: Turn dead notes into a living LLM wiki your AI agents can query, maintain,
  and grow
saved_at: '2026-07-07T05:25:37.058000+00:00'
updated_at: '2026-07-07T05:25:41.425047+00:00'
reading_time: 11 mins
---

[![Ten thousand notes sit in the dark. The handful you need light up and come to you.](https://substackcdn.com/image/fetch/$s_!qTKJ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc983d19b-d99e-442f-9a41-3418aea2dc4c_1376x768.png "Ten thousand notes sit in the dark. The handful you need light up and come to you.")](https://substackcdn.com/image/fetch/$s_!qTKJ!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc983d19b-d99e-442f-9a41-3418aea2dc4c_1376x768.png)

I spent 18 months turning my second brain into my living research memory. My digital life contains 10,994 notes: over 5,000 in Obsidian, another 5,000 in Readwise, plus more in Notion and Google Drive, growing by roughly 250 a month.

The reality is that most of my notes and bookmarks transformed into a graveyard. When I start a new article or open a codebase, I can’t recall the high-signal notes I already have, so I work without them or burn an hour digging.

The reflex is to reach for Codex or NotebookLM. But those are harnesses: they sit on top of your work, and the moment the chat ends, the context window loses all of it.

More context isn’t the fix. You re-paste the same links and re-explain the same project every session, while past research sits inert in a vault your agents can’t reach.

So , CTO of Towards AI, and I built the alternative, and we’ll show you how: your own **AI Research OS**. It’s a memory layer that sits *between* your second brain and any harness (Codex, Claude Code, or your own). It runs deep research across your notes and the open web, and stores what it finds as an LLM wiki you can query, maintain, and grow.

We first touched on this subject in a talk at the AI Engineer World’s Fair. After we saw that people loved it (it was published as a keynote in the online tracks - out of 82 videos - and is the 2nd most popular one), I decided to write an article about it as well.

By the end you’ll learn how to turn your 10,994 notes into a queryable LLM wiki that your AI agents can use as their agent memory, useful for research, coding and content creation.

You will build an LLM wiki as in the image below, where the payoff already compounds with just 12 sources:

[![The payoff up front: a queryable wiki combining repos, personal notes, and web sources into one graph. Just 12 sources, and the memory already earns its keep.](https://substackcdn.com/image/fetch/$s_!LflI!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fde064b5c-a1fd-4f12-a210-84b70ef625c1_1614x856.png "The payoff up front: a queryable wiki combining repos, personal notes, and web sources into one graph. Just 12 sources, and the memory already earns its keep.")](https://substackcdn.com/image/fetch/$s_!LflI!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fde064b5c-a1fd-4f12-a210-84b70ef625c1_1614x856.png)

Or go crazier with a larger wiki:

[![A bigger project wiki of ~100 notes, distilled into 73 concepts and 18 entities, that still draws on a 10,000+ note second brain. Why it stays this small and this cheap comes together by the end.](https://substackcdn.com/image/fetch/$s_!USVl!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8f1500bb-8910-4222-a8c1-0d396fa71d3c_1602x906.png "A bigger project wiki of ~100 notes, distilled into 73 concepts and 18 entities, that still draws on a 10,000+ note second brain. Why it stays this small and this cheap comes together by the end.")](https://substackcdn.com/image/fetch/$s_!USVl!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8f1500bb-8910-4222-a8c1-0d396fa71d3c_1602x906.png)

By the end, you will also see why the wikis don’t contain all my 10,994 notes to keep ingestion costs low. Let’s go.

## Want your AI work featured across three platforms?

I'm looking for one builder to co-create a customer story on how you used Opik to solve a real-world problem in your AI product.

Here's what you get: from a 1-hour interview where you show off what you built, I'll produce a **co-authored article, a YouTube video, and a run of social posts**, all spotlighting your work. Distributed across both Decoding AI and Opik (by Comet) channels to 200,000+ AI engineers and decision-makers.

Here are the last two:

* [How Evaluation-Driven Development (EDD) Works](https://www.decodingai.com/p/how-evaluation-driven-development-works)
* [What Held Up at 3 AM: One Engineer’s RAG Case Study](https://www.decodingai.com/p/ship-rag-with-weave-cli)

If you want to collaborate, email me at *pauliusztin@decodingai.com*

[Email me](mailto:pauliusztin@decodingai.com?subject=Opik%20Customer%20Story%20Collaboration)

*Fine print:* your product or project must use Opik. This is a collaboration between Decoding AI and Opik (by Comet).

## Why a Bigger Context Window Won’t Save You

Most research doesn’t need this system. If you want a quick answer or a one-off, Google it, or reach for Codex and Claude Code. You need this only when the research has to *stick* and an agent has to reuse those sources later.

You don’t need a giant vault either. This is about topic density, not size. It already pays off on a topic-sized cluster: around 20 notes on one subject, or 2 or 3 repos, like coding agents such as Pi, OpenCode, and Aider. Louis-François runs it on a few hundred notes, not my 10,000+, and it still earns its keep.

Why not NotebookLM? It’s great at digesting sources, but you don’t own it, you can’t personalize it deeply, it isn’t agent-native, and it’s weak for coding since it’s browser-bound.

Why not a vector-database RAG pipeline? That’s the right call at production scale, but it’s infrastructure. It’s hard to inspect or edit by hand, and overkill for a personal tool you open every day.

So you build it yourself: a personalized research assistant that uses an LLM wiki knowledge base that’s light and human-friendly as its agent memory. The perfect context engineering technique as an interface between the human and the AI agent.

Now, I want to go over, step by step, how we reached our final deep research + LLM wiki design, with the “why” and “how” in mind.

## The Deep-Research Loop, Version 1: Mining the Public Web

A year ago, building the Agent Engineering course, we scoped the loop tightly: give it a topic plus a few hand-picked **golden links**, and get back a single static `research.md`.

The deep research algorithm first scrapes the golden links for seed context. Knowing them up front lets the agent frame better questions. Then it runs query rounds: one **orchestrator** generates the questions, and a **sub-agent per question** searches (Gemini grounded in Google) and returns links plus a summary, which the orchestrator aggregates so the context never explodes.

[![Version 1 in one line: topic + golden links → deep-research algorithm → one static research.md.](https://substackcdn.com/image/fetch/$s_!FbGR!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7a02e318-e3d9-43f6-a2a5-7429e48b19c0_2400x731.png "Version 1 in one line: topic + golden links → deep-research algorithm → one static research.md.")](https://substackcdn.com/image/fetch/$s_!FbGR!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7a02e318-e3d9-43f6-a2a5-7429e48b19c0_2400x731.png)

*Version 1 in one line: topic + golden links → deep-research algorithm → one static research.md.*

Three rounds of 6 queries surface 40–50 links, which is too noisy to keep whole. A **ranking** step scores each source against the topic. Only the top-K get fully scraped, the rest are kept as summaries, and everything is compiled into one flat `research.md`. That version generated 35 course lessons fast.

[![The deep-research algorithm unpacked: orchestrator, six sub-agents per round, three rounds, ranking, then top-K full scrapes into research.md.](https://substackcdn.com/image/fetch/$s_!Y6mp!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F792be5b5-ea26-4bfb-829d-d861596cb62f_2400x957.png "The deep-research algorithm unpacked: orchestrator, six sub-agents per round, three rounds, ranking, then top-K full scrapes into research.md.")](https://substackcdn.com/image/fetch/$s_!Y6mp!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F792be5b5-ea26-4bfb-829d-d861596cb62f_2400x957.png)

*The deep-research algorithm unpacked: orchestrator, six sub-agents per round, three rounds, ranking, then top-K full scrapes into research.md.*

It worked for the course, but it was aimed at the generic public web, with every golden link hand-picked from our own second brain.

## Version 2: Point the Loop at Your Second Brain

Same loop, new target: aim it at your own sources instead of the public web, where you’ve already filtered what matters. Your second brain *is* a curated set of golden links, so the input shrinks to just a topic and the loop finds the rest.

[![Version 2's core move: take the same loop and aim it at your own sources instead of the open web.](https://substackcdn.com/image/fetch/$s_!txf7!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6dce886a-e409-47a9-aba5-cff5a95bc51c_2400x873.png "Version 2's core move: take the same loop and aim it at your own sources instead of the open web.")](https://substackcdn.com/image/fetch/$s_!txf7!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6dce886a-e409-47a9-aba5-cff5a95bc51c_2400x873.png)

*Version 2’s core move: take the same loop and aim it at your own sources instead of the open web.*

You plug in Obsidian, Readwise, NotebookLM, and GitHub Stars, then extend with Gemini Deep Research, YouTube, Google Drive, or Notion. Code is a special case: a GitHub sub-agent clones a repo and builds a high-level architecture note.

The token-efficiency trick lives in the reranker. It scores each candidate from 0 to 1 against your question using only its metadata and summary, never the full text, then passes only the top-K to the model.

[![The loop over your own sources: topic-only input, personal sources plugged in, same rank-and-scrape tail.](https://substackcdn.com/image/fetch/$s_!1AwG!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe6164947-9d0d-4ed7-82a3-022984668b97_2400x806.png "The loop over your own sources: topic-only input, personal sources plugged in, same rank-and-scrape tail.")](https://substackcdn.com/image/fetch/$s_!1AwG!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe6164947-9d0d-4ed7-82a3-022984668b97_2400x806.png)

*The loop over your own sources: topic-only input, personal sources plugged in, same rank-and-scrape tail.*

The new problem is that the output is frozen. You still end up with a static `research.md`, and real research isn’t static. You want another question answered, or part of it goes stale, and re-running the loop from scratch is expensive in tokens and time. The fix is a new layer that sits on top of the raw data: the LLM wiki.

## Version 3: From a Static Pile to a Living Wiki

The pivot came from Andrej Karpathy’s idea of **LLM-maintained knowledge-base wikis** [[1]](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Instead of re-deriving knowledge from raw documents on every query, which is the RAG pattern, the LLM incrementally builds and maintains a persistent, interlinked wiki between you and your sources.

**Since I realized the power of LLM wikis, I started to use them for all my personal setups as my agent memory. It’s simple, powerful and beautiful.**

Since giving this talk, we found that Google had published its **[Open Knowledge Format (OKF)](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing)**, an open spec that “formalizes the LLM-wiki pattern into a portable, interoperable format” [[2]](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing). It’s built on the very blocks you’ll see below: plain markdown with YAML frontmatter, an index, a log, and links that form a graph. When Google independently ships the same architecture as a standard, you know the direction is right.

During ingestion it generates, as a byproduct, derivatives over your raw sources: entities and concepts, comparisons between them, notes tied to your questions, open questions, and a synthesis:

[![code](https://substackcdn.com/image/fetch/$s_!qxOx!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffe7b23f3-fd42-4087-87b1-d17f4562fe68_2120x2163.png "code")](https://substackcdn.com/image/fetch/$s_!qxOx!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffe7b23f3-fd42-4087-87b1-d17f4562fe68_2120x2163.png)

Storing each finding as an individual raw file, instead of one flat `research.md`, is the one change that makes everything downstream queryable and growable. Sources can include Obsidian, GitHub, Google Drive, even custom URLs (plain curl for simple sites, Bright Data for bot-walled ones).

[![Sources → deep research → store raw files → index → generate wiki → query. The version-3 pipeline end to end.](https://substackcdn.com/image/fetch/$s_!K5GT!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F30565fb3-2384-4103-aa3a-172461647681_2400x820.png "Sources → deep research → store raw files → index → generate wiki → query. The version-3 pipeline end to end.")](https://substackcdn.com/image/fetch/$s_!K5GT!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F30565fb3-2384-4103-aa3a-172461647681_2400x820.png)

*Sources → deep research → store raw files → index → generate wiki → query. The version-3 pipeline end to end.*

The natural fear is that “index + wiki + query” means vector databases and knowledge graphs. It doesn’t, and that’s the surprising part.

## A Memory Layer Built From Plain Files and No Database

Vector databases, knowledge graphs, and semantic and text search all add real complexity, too much for a personal research OS. So drop that infrastructure and build the whole thing on files and references: no database, just a simple index rooted in how your filesystem already works.

The index is the retrieval layer. An agent reads a single `index.yaml` first, a catalog with a summary and metadata for each source (original file, origin, title, authors, date).

There are 3 layers. A `raw` folder holds the immutable source data, a `wiki` folder holds the LLM-generated derivatives, and the `index` points to all of it. A real example is an `index.yaml` cataloging 10 sources and 38 wiki pages.

[![code](https://substackcdn.com/image/fetch/$s_!OJ0b!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F76c82d98-b000-496f-a6fa-8f1f93bb0da1_2120x563.png "code")](https://substackcdn.com/image/fetch/$s_!OJ0b!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F76c82d98-b000-496f-a6fa-8f1f93bb0da1_2120x563.png)

[![The index is the retrieval layer: one YAML catalog the agent reads first, pointing to everything else.](https://substackcdn.com/image/fetch/$s_!xLVZ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdad1e1cc-58c1-4df9-bc93-93a94480e689_2400x1110.png "The index is the retrieval layer: one YAML catalog the agent reads first, pointing to everything else.")](https://substackcdn.com/image/fetch/$s_!xLVZ!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdad1e1cc-58c1-4df9-bc93-93a94480e689_2400x1110.png)

*The index is the retrieval layer: one YAML catalog the agent reads first, pointing to everything else.*

You even get a knowledge graph for free. Because everything is Obsidian-flavored markdown with references, Obsidian’s local graph renders the connections out of the box: entities like OpenCode or MCP linked to concepts like tool registry, context compaction, and sandboxing, and the sources they touch.

[![claude code entity](https://substackcdn.com/image/fetch/$s_!jvI7!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5d11c98e-271b-41b5-a728-adc37e38024e_2112x1802.png "claude code entity")](https://substackcdn.com/image/fetch/$s_!jvI7!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5d11c98e-271b-41b5-a728-adc37e38024e_2112x1802.png)

Obsidian is only a viewer, though. The whole system runs from any working directory through Codex or Claude Code, so the graph is a bonus on top.

## Querying the Wiki, and Why It Never Freezes

The agent queries through progressive disclosure. It starts at the `index.yaml` summaries. If it needs more, it opens the **source wiki page** (an expanded summary), and often stops there.

If not, it follows references into the **derivatives** (entities, concepts, comparisons, notes). Only as a last resort does it read the **raw source**. Summaries are computed once, at ingestion, so the context window stays small.

[![The query drill-down: each level answers most questions, so the agent rarely touches raw sources and context stays small.](https://substackcdn.com/image/fetch/$s_!Y3Kw!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd45a4434-b833-4be1-be5c-cd3fd702c2ac_2400x1158.png "The query drill-down: each level answers most questions, so the agent rarely touches raw sources and context stays small.")](https://substackcdn.com/image/fetch/$s_!Y3Kw!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd45a4434-b833-4be1-be5c-cd3fd702c2ac_2400x1158.png)

*The query drill-down: each level answers most questions, so the agent rarely touches raw sources and context stays small.*

The wiki is also alive. Ask a question and the LLM can spawn a new concept, note, or comparison, and each question is written to a log. So the wiki evolves as you *talk* to it, not only when you ingest data.

[![Every question leaves a trace: new notes and comparisons accrete, and the log tracks the whole history.](https://substackcdn.com/image/fetch/$s_!DbRB!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd62a4de4-10b1-452f-b73c-0fbd9ee2ddef_2400x798.png "Every question leaves a trace: new notes and comparisons accrete, and the log tracks the whole history.")](https://substackcdn.com/image/fetch/$s_!DbRB!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd62a4de4-10b1-452f-b73c-0fbd9ee2ddef_2400x798.png)

*Every question leaves a trace: new notes and comparisons accrete, and the log tracks the whole history.*

It’s never frozen, and it grows 3 ways: ingest a new custom link, run another deep-research round, or let it create derivatives purely from your questions.

[![The wiki grows three ways: new links, new research rounds, and new derivatives born from your questions.](https://substackcdn.com/image/fetch/$s_!QyOU!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1dc23955-1cf8-4cc0-ad10-47d0539c3249_2400x1416.png "The wiki grows three ways: new links, new research rounds, and new derivatives born from your questions.")](https://substackcdn.com/image/fetch/$s_!QyOU!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1dc23955-1cf8-4cc0-ad10-47d0539c3249_2400x1416.png)

*The wiki grows three ways: new links, new research rounds, and new derivatives born from your questions.*

One design choice makes this safe to run against a decade of notes: the wiki never sits directly on your whole second brain.

## Scope It to a Project With PARA

Your second brain stays an immutable snapshot. I organize everything with the **PARA method**: Projects, Areas, Resources, Archive [[3]](https://fortelabs.com/blog/para/). Sources are piped into Resources as a flat list, then referenced into Projects and Areas. So Obsidian stays read-only; I don’t want the LLM editing notes I write by hand.

[![PARA keeps your global second brain an immutable, read-only snapshot the LLM never writes to.](https://substackcdn.com/image/fetch/$s_!Hom-!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdf9e096d-bde9-4394-8e57-af70ea9b5215_2400x1248.png "PARA keeps your global second brain an immutable, read-only snapshot the LLM never writes to.")](https://substackcdn.com/image/fetch/$s_!Hom-!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdf9e096d-bde9-4394-8e57-af70ea9b5215_2400x1248.png)

*PARA keeps your global second brain an immutable, read-only snapshot the LLM never writes to.*

The wiki is scoped per project, not global. When you start something new, you reference that snapshot *through* the deep-research loop and scope it down to the project, running the loop or ingesting specific repos, articles, and notes via skills plugged into a harness.

Scoping is a scale choice as much as a safety one: plain files stay fast and inspectable at project size, but a whole-vault wiki of thousands of documents is exactly where a vector or graph database finally earns its place.

That’s the ~100-note wiki from the top, kept small by scoping to one project, yet reaching my entire 10,000+ note second brain through the loop.

[![Scope the snapshot down into a project wiki, then let an agent turn that research into the actual work.](https://substackcdn.com/image/fetch/$s_!j4il!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8fb1f960-b375-4943-8d4d-07f9e637778a_2400x859.png "Scope the snapshot down into a project wiki, then let an agent turn that research into the actual work.")](https://substackcdn.com/image/fetch/$s_!j4il!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8fb1f960-b375-4943-8d4d-07f9e637778a_2400x859.png)

*Scope the snapshot down into a project wiki, then let an agent turn that research into the actual work.*

The mental model is that the project is the work and the second brain is the research. A project is anything where you turn research into work: an article, a video, a set of slides (this talk was built this way), or a whole codebase. That’s the whole architecture, and the fastest way to see why it matters is to watch it run.

## See It Run: Three Demos

Everything ships as one open-source Claude Code plugin you can clone and run on your own notes (<https://github.com/iusztinpaul/ai-research-os-workshop>), tweakable for any harness.

It’s four skills: `/research` (build or query the wiki), `/research-distill` (a per-piece `research.md`), `/research-lint` (health-checks), and `/research-render` (slides or a brief).

**Demo 1** is research from a brain dump around “agentic harnesses”. You point the research skill at a file of notes plus a few must-include references. It scrapes those for seed context and picks a depth: **fast** (1 round of 3 queries), **light** (2 rounds, 3 then 2), or **deep** (3 rounds of 3). Out come the raw files + the LLM wiki:

[![Demo 1 output: a topic's worth of research rendered as a live Obsidian graph, the index at its center.](https://substackcdn.com/image/fetch/$s_!m3dw!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd63cc833-a7f5-45e8-9da0-b04a9609955d_1482x1081.png "Demo 1 output: a topic's worth of research rendered as a live Obsidian graph, the index at its center.")](https://substackcdn.com/image/fetch/$s_!m3dw!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd63cc833-a7f5-45e8-9da0-b04a9609955d_1482x1081.png)

**Demo 2** is ingesting and comparing GitHub repos. You give it 3 harness repos (OpenCode, Pi, Hermes), no deep research, scoped to architecture, sub-agents, memory, and the permission flow. It clones each, writes per-repo notes, then builds cross-repo comparisons.

[![Demo 2 output: three harnesses ingested straight from code, with the cross-repo comparison notes generated automatically.](https://substackcdn.com/image/fetch/$s_!0gs0!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F347becea-b19b-45a9-8512-a7d3c7417e3a_1145x822.png "Demo 2 output: three harnesses ingested straight from code, with the cross-repo comparison notes generated automatically.")](https://substackcdn.com/image/fetch/$s_!0gs0!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F347becea-b19b-45a9-8512-a7d3c7417e3a_1145x822.png)

**Demo 3** is ad-hoc links on GraphRAG, then questions to create notes. You hand it 3 arbitrary links to build a wiki, then ask how agentic GraphRAG differs from a plain knowledge graph. It answers off the wiki *and* updates it in place.

[![Demo 3 output: a wiki built from three raw links that keeps growing as you query it.](https://substackcdn.com/image/fetch/$s_!Jzx2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F20818c5f-397a-477f-9606-c6c66e2ca1f6_976x740.png "Demo 3 output: a wiki built from three raw links that keeps growing as you query it.")](https://substackcdn.com/image/fetch/$s_!Jzx2!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F20818c5f-397a-477f-9606-c6c66e2ca1f6_976x740.png)

It was super hard to show the full demos here. You can find the full examples within the [Examples](https://github.com/iusztinpaul/ai-research-os-workshop) section of the repo or watch me go over them in Obsidian and Zed in the [full video](https://www.youtube.com/watch?v=ZRM_TfEZcIo).

## Where This Is Going

Some connectors are missing on purpose (Google Drive, Notion, Slack) — the point is for *you* to add what you need. Louis-François added YouTube transcript ingestion in seconds with one prompt to Codex.

Two weaknesses stand out. The byproducts are often poorly written, fixable with the article writing profiles I already use. And as data grows, the LLM makes subtle errors: **concept confusion** (comparing Claude Code and OpenCode, it merged how each handles tool calls into one explanation) and **superficiality** (the Claude Code queuing system took many follow-ups to get right).

The fix is constant linting, which is what `/research-lint` does: it sweeps the wiki for orphan sources, broken links, stale claims, and contradictions.

## What’s Next

Everything you saw here is open source. **Clone the repo** (or install it as a Claude Code plugin) and run it on your own notes today: <https://github.com/iusztinpaul/ai-research-os-workshop>

If you’d rather see the whole system in action first, watch the full talk  and I gave at the **AI Engineer World’s Fair**:

And if you want to go beyond a workshop repo, such as **building a deep-research-plus-writing multi-agent system** from **scratch** and **shipping** it to **production** with AI evals and an observability layer on top, that’s exactly what we teach in our **[Agent Engineering: Building Multi-Agent Systems course](https://academy.towardsai.net/courses/agent-engineering?ref=b3ab31&utm_source=decodingai&utm_medium=partner&utm_campaign=agent_engineering)**.

[![placeholder](https://substackcdn.com/image/fetch/$s_!Uql0!,w_1456,c_limit,f_auto,q_auto:good,fl_lossy/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe507da12-ec85-47cf-bd9e-afadffc7e99d_1200x1200.gif "placeholder")](https://substackcdn.com/image/fetch/$s_!Uql0!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe507da12-ec85-47cf-bd9e-afadffc7e99d_1200x1200.gif)

The multi-agent system built during the **[Agent Engineering: Building Multi-Agent Systems course](https://academy.towardsai.net/courses/agent-engineering?ref=b3ab31&utm_source=decodingai&utm_medium=partner&utm_campaign=agent_engineering)**

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/llm-wiki-agent-memory?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
