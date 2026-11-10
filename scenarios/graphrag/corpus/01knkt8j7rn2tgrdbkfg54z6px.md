---
title: Your RAG Pipeline Is Overkill
type: rss
published: '2026-04-07T00:00:00+00:00'
length: '3139'
source: decodingai-paul
source_id: 01knkt8j7rn2tgrdbkfg54z6px
source_url: https://www.decodingai.com/p/recursive-language-models
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: The pattern that lets your model write code to explore its context instead
  of retrieving it.
saved_at: '2026-04-07T11:11:50.081000+00:00'
updated_at: '2026-04-07T11:11:53.452594+00:00'
reading_time: 12 mins
---

We constantly fight a battle against the context window limit. You either compress your data until it loses meaning, or you build a massive infrastructure project just to read a few documents. Today, we look at a third option. We explore a pattern that allows models to read millions of tokens by treating data as an environment rather than an input.

In most AI projects, such as the financial assistant I am working on, there is a constant battle between Retrieval-Augmented Generation (RAG) and Context-Augmented Generation (CAG). Should you implement a heavy RAG architecture up front that might not even work, or does CAG get the job done? For example, in our financial assistant system, we ultimately decided to use RAG only when we really HAVE to, because it introduces zigzag retrieval patterns that require dozens of queries per operation, increasing latency.

Also, while building Brown, my writing agent, I hit another wall. Brown needs to ingest massive amounts of research to anchor its writing process. At 180,000 input tokens, the Gemini API became entirely unreliable.

I faced constant timeouts, disconnections, and infrastructure breakdowns. Huge context windows suffer from API reliability and infrastructure stability issues, as well as performance degradation. But the thing is, I didn’t want to overcomplicate my solution with a RAG layer, so I started looking around for other solutions.

Most engineers face this painful tradeoff when working with large documents. You can stuff everything into the context window, but performance degrades quickly. This causes context rot, which happens when attention degrades over long contexts and earlier information loses its influence [[1]](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [[2]](https://venturebeat.com/orchestration/mits-new-recursive-framework-lets-llms-process-10-million-tokens-without-context-rot/).

Alternatively, you can build a RAG pipeline. But that requires maintaining vector databases, chunking strategies, and retrieval evaluation infrastructure.

Even the tools we use daily, like Claude Code or Cursor, rely on summarization-based context compression that loses critical information. I just wanted to dump my research into one file and get good answers without the infrastructure breaking. Recursive Language Models (RLMs) solve this exact problem [[3]](https://arxiv.org/abs/2512.24601).

RLMs use an inference-time pattern that treats your input as an external environment the model interacts with programmatically. You do not need chunking infrastructure or embedding pipelines. The model writes code to explore, filter, and recursively process your data on demand.

[![The three approaches to processing large documents](https://substackcdn.com/image/fetch/$s_!jJY1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F08afe0b8-6aa1-41ce-8bb3-cae88284181f_1400x1000.png "The three approaches to processing large documents")](https://substackcdn.com/image/fetch/$s_!jJY1!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F08afe0b8-6aa1-41ce-8bb3-cae88284181f_1400x1000.png)

*Image 1: The three approaches to processing large documents. RAG adds infrastructure complexity. Context stuffing causes degradation. RLMs treat the input as an external environment the model programs against.*

This approach scales the effective input and output lengths of LLMs. Researchers tested RLMs up to 10 million tokens across GPT-5 and Qwen3-Coder, showing they easily outperform base models [[3]](https://arxiv.org/abs/2512.24601). Base model performance degrades as a function of input length and task complexity, while RLM performance scales with less degradation.

RLMs are also a model-agnostic inference strategy, meaning they work with any model you choose.

However, this architecture has honest downsides you must consider. The inference cost has high variance due to differences in trajectory lengths. The system suffers from code fragility, meaning that if the model writes buggy code, the entire reasoning chain fails.

Errors in sub-calls can compound through the recursive tree, propagating hallucinations. Sequential sub-calls also create latency bottlenecks. This makes RLMs best suited for deep thinking applications rather than real-time chat.

To understand how we bypass these infrastructure limits, we need to examine the specific programming trick that keeps the model’s memory clean.

Here is what you will learn about this pattern:

* The mechanism that keeps massive documents outside the context window.
* The orchestration loop that drives programmatic data exploration.
* The specific use cases where this pattern outperforms retrieval systems.
* A practical method to approximate this behavior using Claude Code.

---

## The REPL Trick That Keeps Your Context Window Clean

RLMs introduce a simple core idea. Do not feed the document into the model’s context window. Instead, load it as a variable in a persistent programming environment and let the model write code to interact with it [[4]](https://www.primeintellect.ai/blog/rlm).

The model never sees your 10-million-token document directly. In a traditional agent, the prompt goes into the model, completely blowing up your context window. In an RLM, the context stays outside as an external variable, and the model receives only a symbolic handle to it.

The system initializes a Read-Eval-Print Loop (REPL), which is a persistent interactive programming environment where variables and state persist across iterations [[3]](https://arxiv.org/abs/2512.24601).

The root model receives only metadata, such as the total character count and data structure. It also receives instructions on how to access the REPL. The model then writes code to peek into, filter with regex, chunk, or summarize the data.

When the model identifies a sub-task, it uses a specific primitive such as `llm_query(prompt, chunk)` to spawn a fresh, isolated worker sub-model [[3]](https://arxiv.org/abs/2512.24601). The system pauses, executes this sub-call, and returns the result to the root model’s REPL.

Variables persist across these REPL turns. The model aggregates findings into a buffer, building the response progressively across iterations. Once confident, it calls `FINAL(answer)` to stop the recursive loop and return the response [[5]](https://dextralabs.com/blog/recursive-language-models-rlm/).

[![The RLM REPL mechanism](https://substackcdn.com/image/fetch/$s_!i4L_!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc48c578c-3a1e-4fbf-9c88-a08a748ee2bb_1400x1400.png "The RLM REPL mechanism")](https://substackcdn.com/image/fetch/$s_!i4L_!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc48c578c-3a1e-4fbf-9c88-a08a748ee2bb_1400x1400.png)

*Image 2: The RLM mechanism. The document stays outside the context window as a REPL variable. The model writes code to explore, decompose, and recursively process it.*

RLMs essentially perform context engineering on autopilot. Traditional context engineering requires you to carefully curate what goes into the context window through retrieval and compression [[1]](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents). RLMs automate this by letting the model itself decide what to extract, filter, and process.

Costs and performance stay intact because the model filters the input context without explicitly seeing it. By writing Python scripts, the model processes only the relevant portions through sub-calls. Only constant-size metadata about execution results is appended to the root model’s history, keeping its context window small and clean.

Understanding this mechanical loop allows us to map the pattern directly to production harness engineering.

## Turn Any Agent Into a Plan-Execute-Validate Machine

RLMs are an inference-time orchestration pattern that maps directly to production harness engineering. If you have built agent systems, you already know the components: a planning loop, tool execution and validation [[7]](https://blog.langchain.com/the-anatomy-of-an-agent-harness/). RLMs formalize this into a programmable, recursive architecture.

A robust RLM harness uses a multi-tiered architecture. The root controller is a frontier model that acts as the project manager. It plans the reasoning process, writes code, and coordinates execution, but never directly interacts with tools or the full document [[8]](https://www.anthropic.com/engineering/building-effective-agents).

Worker sub-models are cheaper, faster models spawned via an operation such as `llm_query()` to handle specific, localized sub-tasks. This reduces overall costs while maintaining high quality. The aggregation layer is the REPL environment that combines recursive step results into a final structured response via persistent variables.

This setup naturally follows the plan-execute-validate mapping. In the plan phase, the root controller reviews the query, creates a reasoning plan, and decides how to decompose the problem. It might plan to regex-filter a codebase, chunk a document, or batch sub-calls for parallel analysis.

In the execute phase, the model translates the plan into code. It writes Python scripts, issues `llm_query()` calls, and spawns worker sub-models for parallel execution in isolated REPL environments. External tools, like web search, are provided ONLY to worker sub-models, keeping the root model’s context perfectly clean.

[![The plan-validate-execute orchestration loop](https://substackcdn.com/image/fetch/$s_!OWkF!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fec670a03-124b-4954-93e7-745b5cf1a5d3_1400x1400.png "The plan-validate-execute orchestration loop")](https://substackcdn.com/image/fetch/$s_!OWkF!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fec670a03-124b-4954-93e7-745b5cf1a5d3_1400x1400.png)

*Image 3: The plan-execute-validate loop. The root controller plans, worker sub-models execute, the system validates, and the cycle repeats until FINAL().*

After execution, the system enters the validation phase, where results feed back as observations. The root model assesses accuracy, launches verification sub-calls, and handles errors by dynamically adjusting its plan. If the Python code fails, the error traceback is yielded back to the model as an event.

This allows the model to adapt and fix its code on the next turn. The cycle repeats until the model calls `FINAL(answer)`.

Deploying this in the real world requires strict production guardrails. You must configure `maxIterations` to cap the number of REPL turns, typically between 10 and 50. You need `maxDepth` to limit the recursive stack depth, where a depth of 1 is usually sufficient.

You also need `maxStdoutLength` to truncate REPL output returned to the model to prevent context overflow. Finally, permission gating is required to provide sandboxed execution with explicit approval for sensitive operations.

Neither Claude Code nor OpenAI Codex uses true RLM patterns. They rely on summarization-based context compression, file-system state tracking and progressive disclosure techniques [[9]](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). This creates a succession of agents connected by prompts and file state, rather than maintaining a persistent REPL environment with programmatic sub-calls.

With this architecture in place, we can identify the specific real-world scenarios where this pattern outperforms traditional data processing.

## Four Scenarios Where RLMs Beat Traditional Approaches

RLMs are best suited for deep thinking applications that require accuracy, multi-step reasoning, and reliability over massive contexts. They are not suited for real-time, low-latency chat applications.

The **first scenario** is parsing large files without building retrieval infrastructure. Instead of building a hybrid index with vector and graph search, you keep everything in one file or directory and use an RLM agent to extract information on demand.

We can view the relationship between RAG and RLMs as a spectrum. For simple cases, RLMs replace RAG entirely, removing the need for chunking and embeddings. For advanced scenarios, RLMs complement retrieval beautifully.

You use semantic search to find your first pool of candidates, write the results to disk as cached short-term memory, and use an RLM to query that refined dataset on demand.

The retrieval narrows the haystack, and the RLM reasons deeply over what is left. I use this exact workflow for my research, dumping everything into a massive text file and using an RLM to extract relevant information.

[![RLM replacing RAG for large file parsing](https://substackcdn.com/image/fetch/$s_!K9A3!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F41df1265-00a8-4373-8862-dd260870cd6c_1400x1208.png "RLM replacing RAG for large file parsing")](https://substackcdn.com/image/fetch/$s_!K9A3!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F41df1265-00a8-4373-8862-dd260870cd6c_1400x1208.png)

*Image 4: RLM replaces the entire RAG pipeline for large file parsing. One file, one agent, no retrieval infrastructure.*

The **second scenario** is complex software engineering and codebase comprehension. RLMs ingest massive codebases containing millions of tokens to answer questions about architecture, map dependencies, and perform reviews.

The RLM paper tested this on LongBench-v2 CodeQA using Qwen3-Coder with a Python REPL. The model writes code to break down the codebase, launches sub-queries to smaller language models, and aggregates findings [[3]](https://arxiv.org/abs/2512.24601).

[![RLM decomposing a codebase through recursive sub-queries](https://substackcdn.com/image/fetch/$s_!HwsN!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe733bf97-fdcf-4e10-9d2c-4d242b1baf1d_1400x1400.png "RLM decomposing a codebase through recursive sub-queries")](https://substackcdn.com/image/fetch/$s_!HwsN!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fe733bf97-fdcf-4e10-9d2c-4d242b1baf1d_1400x1400.png)

*Image 5: An RLM decomposes a codebase question into parallel sub-queries, each handled by a worker sub-model, then aggregates the results.*

The **third scenario** is enterprise legal and financial analysis. RLMs provide consistent interpretation across thousands of contracts, case files, and policies that would overwhelm a standard context window. They also excel at financial audits and due diligence by tracing, validating, and reasoning through massive financial datasets.

The **fourth scenario** is deep research and information synthesis. RLMs synthesize research across thousands of files by programmatically filtering, chunking, and summarizing. They enable knowledge graph exploration and multi-hop reasoning over large document dumps.

At scale, RLMs become both more accurate and cheaper than standard long-context approaches. They avoid paying for n-squared attention over massive contexts by having the model process only relevant slices via sub-calls. In all these scenarios, the RLM pattern succeeds because it treats the LLM as a project manager that decides what to look at and delegates sub-tasks to workers.

Knowing these optimal use cases helps us approximate the pattern using tools you likely already have installed.

## Build a Naive RLM SKILL in Claude Code

Claude Code does not natively use the RLM pattern. It relies on summarization-based context compression, file-system state tracking, and progressive disclosure. However, you can approximate RLM behavior using Claude Code’s existing harness features to build a naive RLM SKILL.

First, you set up the environment by having the SKILL load the target file or directory as a reference. Instead of feeding it into the context window, it writes the file path and metadata to a prompt for the root agent.

Second, the root Claude Code agent receives only this metadata and a set of instructions for how to interact with it. It uses its Explore subagent type   
to examine the data structure, identify relevant sections, and plan its approach.

Third, the SKILL uses Claude Code’s Agent tool to spawn subagents. Each subagent receives a focused prompt to read specific lines and extract mentions, returning a condensed summary of a few thousand tokens. This mirrors the RLM pattern of spawning isolated sub-calls that process slices of the input.

Finally, the root agent collects these subagent results. It aggregates them into a coherent answer and decides whether more exploration is needed or whether to finalize the output.

Here is what this naive RLM SKILL looks like as a *SKILL.md* file:

```
---
name: rlm-research-analyzer
description: "Analyze large research files by treating
  them as an external environment. Instead of stuffing
  content into context, the model explores, decomposes,
  and recursively processes the data through subagents."
---

# Analyze Large Research Files Using the RLM Pattern

## Step 1 — Initialize the environment

Accept the target file path as an argument. Do NOT read
the file into context. Instead, run a Bash command to
collect metadata:

wc -l    # total lines
wc -c    # total bytes
head -5   # short prefix

Write the metadata and file path to a temporary prompt
file at /rlm_prompt.md. The root agent
receives ONLY this metadata, never the full content.

## Step 2 — Plan the exploration

Read rlm_prompt.md. Based on the metadata and prefix,
decide how to decompose the file. Use an Explore
subagent to scan the file structure:

- Identify section boundaries, headings, or delimiters
- Estimate which regions are relevant to the query
- Produce a ranked list of target ranges to process

## Step 3 — Delegate to worker subagents

For each target range, spawn an Agent subagent with a
focused prompt:

"Read lines {start}-{end} of {file_path}. Extract all
findings related to {query}. Return a summary under
2000 tokens."

Launch multiple subagents in parallel when ranges are
independent. Write each subagent's output to
/slice_{n}.md.

## Step 4 — Aggregate and finalize

Read all slice files. Synthesize the findings into a
single coherent answer. If gaps remain, return to
Step 3 with new target ranges. Otherwise, write the
final output to /answer.md and present
it to the user.
```

Notice how the four steps map directly to RLM primitives. Step 1 mirrors REPL initialization, where the data becomes an external variable rather than context input. Step 3 replaces the theoretical `llm_query()` operation with Claude Code’s Agent tool. Step 4 mirrors the `FINAL()` call that terminates the recursive loop.

This naive approximation lacks several critical features. It has no true REPL persistence, as Claude Code subagents do not share a persistent variable space. The filesystem serves as a proxy for REPL state, but it is slower and less elegant.

It also lacks sandboxing, as Claude Code runs directly in your environment. Then you miss out on configurable guardrails like `max_iterations` and `max_output_chars`, requiring manual limits instead. You get the idea.

Still, I’ve been using a similar technique in all my current projects: instead of stuffing the research into a file, I dump everything into a dir and link everything together in an `index.yaml` file that contains URIs to all the files, plus metadata such as the title and a 1-2 sentence summary of each source. Like this, through the `index.yaml` file, Claude Code can efficiently navigate the whole research dump token through progressive disclosure.

My structure looks something like this:

```
research/
├── index.yaml
├── file_1.md
├── file_2.md
├── ...
└── file_N.md
```

Also, the only out-of-the-box implementation I found is within the [DSPy framework](https://dspy.ai/api/modules/RLM/).

The naive SKILL is a useful thought exercise and a practical first step. For production use, you should reference the DSPy framework’s `dspy.RLM` module.

## What’s Next

RLMs represent a fundamental shift in how we process large inputs. We are moving from asking how to fit data in the context window to asking how we let the model interact with it programmatically. This is a great thought exercise on integrating specialized inference-time functionality into your harness.

As models get better at writing code and REPL environments become more sophisticated, the boundary between the model and its infrastructure will blur. The model does not just use tools, it writes the tools on the fly to solve the specific problem in front of it.

Your next practical step is to experiment with our SKILL or with the DSPy framework’s `dspy.RLM` module on a real problem. Point it at a large codebase you need to understand or a research corpus you need to synthesize. Start with something you have been using RAG or context stuffing on, and see whether the RLM approach is more effective.

*But here is what I’m wondering:*

***How have you been passing large files, such as deep research results or books, to your agents so far? RAG, CAG or other creative techniques?***

*Click the button below and tell me. I read every response.*

[Leave a comment](https://www.decodingai.com/p/recursive-language-models/comments)

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/recursive-language-models?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
