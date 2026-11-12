---
title: From 12 Agents to 1
type: rss
published: '2026-03-26T00:00:00+00:00'
length: '2635'
source: decodingai-paul
source_id: 01kmn99qwnjcyx6d3d5w4jx430
source_url: https://www.decodingai.com/p/from-12-agents-to-1-ai-agent-architecture-decision-guide
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: The mental model that prevents you from overengineering your next AI system.
saved_at: '2026-03-26T14:38:09.885000+00:00'
updated_at: '2026-03-26T14:38:14.269397+00:00'
reading_time: 10 mins
---

[![The complexity spectrum from workflows to single agents to multi-agent systems, with decision triggers between each stage.](https://substackcdn.com/image/fetch/$s_!tlx1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb3b68fec-e7dc-49ea-a30a-5394c6ffc2d1_1456x932.png "The complexity spectrum from workflows to single agents to multi-agent systems, with decision triggers between each stage.")](https://substackcdn.com/image/fetch/$s_!tlx1!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fb3b68fec-e7dc-49ea-a30a-5394c6ffc2d1_1456x932.png)

It is 2026. People across the industry still mix up words like workflows, agents, tools, and multi-agent systems. Beyond terminology, this confusion has led to massively overengineered solutions.

Teams jump to multi-agent architectures because it sounds impressive and helps raise money. In reality, a simple workflow would have been faster to build, cheaper to run, and easier to debug. The result is bloated systems, wasted tokens, and debugging nightmares.

Our goal is to provide a clear mental model of what architecture to choose for your AI project: workflows vs. single agents vs. multi-agent systems.

from Towards AI has been working on this exact problem with his clients and distilled his decision framework into two YouTube videos: [Stop Overengineering: Workflows vs AI Agents Explained](https://www.youtube.com/watch?v=_rO2fv6tSsQ) and [From Workflows to Multi-Agent Systems: How to Choose](https://www.youtube.com/watch?v=iOpLKJYOvXs). He allowed me to take that framework and turn it into this article. Kudos to Louis-François!

This decision framework is a spectrum from simple to complex that tells you exactly what to build based on your actual constraints. The goal is to stay as far left on the complexity spectrum as possible while still solving your problem.

Here is what you will learn:

* The fundamental difference between an agent and a workflow.
* How to use the complexity spectrum to make architecture decisions.
* When to rely on simple workflows for predictable tasks.
* Why a single agent with tools is often enough for dynamic problems.
* The exact breaking points that justify moving to a multi-agent system.

To apply this spectrum effectively, you must first define the terms. Here are the core misconceptions that lead to bad architecture decisions.

*Before we continue, a quick word from the Decoding AI team.* ↓

---

## Clarifying the Confusion: Not Everything Is an Agent

The first major misconception is that every LLM application is an agent. The key difference is autonomy. In a workflow, you control the flow.

You decide the steps and their order. In an agent, the model controls the flow. It decides what to do next based on the goal you give it.

If you can write down the exact sequence of steps in advance, you are building a workflow. You are not building an agent.

[![A side-by-side comparison of a predetermined workflow and an autonomous agent.](https://substackcdn.com/image/fetch/$s_!5bE2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa5af291e-e122-48ee-87c8-4ee8283b3ff9_1200x630.png "A side-by-side comparison of a predetermined workflow and an autonomous agent.")](https://substackcdn.com/image/fetch/$s_!5bE2!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa5af291e-e122-48ee-87c8-4ee8283b3ff9_1200x630.png)

*Image 1: A side-by-side comparison of a predetermined workflow and an autonomous agent, highlighting who controls the flow.*

The second misconception is that tools are agents. A tool is a capability. It can be a calculator, a database query, a web browser, a validator, or an API call.

It can even be another LLM. An agent is the decision maker who chooses which tools to use and when.

If someone tells you they built a multi-agent system, but it is actually one model calling ten different APIs, that is not multi-agent. That is a single agent with ten tools.

[![A central agent connected to multiple tools — calculator, database, web browser, validator, API, and another LLM.](https://substackcdn.com/image/fetch/$s_!Hg-F!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9f18d144-8860-4b4b-baf2-c1df3722fb66_1200x630.png "A central agent connected to multiple tools — calculator, database, web browser, validator, API, and another LLM.")](https://substackcdn.com/image/fetch/$s_!Hg-F!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9f18d144-8860-4b4b-baf2-c1df3722fb66_1200x630.png)

*Image 2: A visual showing the distinction between tools and agents, with a central agent utilizing various tools.*

This distinction matters. It defines how you architect, debug, and scale your system. It drives your core architecture choice between a workflow, a single agent with tools, or multiple agents.

## The Complexity Spectrum: A Mental Model for Architecture Decisions

To make this architecture choice easier, we use a complexity spectrum. It is a slider going from the most control to the most autonomy. Your goal is to stay as far left as possible while still solving the problem.

**Level 1** represents workflows. Here, you chain multiple LLM calls together in a predefined sequence. You control every step.

**Level 2** represents a single agent with tools. The model makes decisions about what to do next. You have one decision maker and multiple capabilities.

**Level 3** represents multi-agent systems. Here, you have multiple decision makers who need to coordinate with each other.

[![A horizontal spectrum with three levels: Workflows, Single Agent, and Multi-Agent, with a cost and complexity slider.](https://substackcdn.com/image/fetch/$s_!idxn!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F294a748b-0308-412d-a1f5-9d75ff5b3bdc_1200x630.png "A horizontal spectrum with three levels: Workflows, Single Agent, and Multi-Agent, with a cost and complexity slider.")](https://substackcdn.com/image/fetch/$s_!idxn!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F294a748b-0308-412d-a1f5-9d75ff5b3bdc_1200x630.png)

*Image 3: A horizontal spectrum showing three levels of autonomy with increasing cost and complexity.*

The core principle is straightforward. Move right on this spectrum only when you absolutely have to. Each step to the right increases costs, latency, and debugging complexity.

More LLM calls mean more tokens, more traces to follow, and more places where things can go wrong.

In practice, start simple and escalate only where things break. Write a prompt first. Test it.

Implement it with minimal complexity. Measure the results. Add what is missing.

If the model lacks information, add retrieval. If it needs calculations, add a tool. Only when you genuinely need autonomous decision-making should you reach for an agent.

Even then, start with one. The best AI systems are the simplest ones that reliably solve the problem. That usually means starting with workflows.

## When a Workflow Is the Right Answer

Workflows are the right answer when your steps are known and stable. If the process is largely the same each time, regardless of input, a workflow is almost always the best choice.

Workflows win because they are predictable. They are easy to test because you can write unit tests for each step. They are easy to debug because you can trace exactly what happened when something goes wrong.

They are also cheap because you are not burning tokens on the model, figuring out what to do next.

Consider a support ticket system. A ticket comes in. You classify it.

You route it to the right team. You draft a response from templates and context. You validate it against the policy.

Finally, you send it. Each step might involve an LLM call, but the model does not need to decide whether to classify before routing. That is always the order.

Building this as an agent adds overhead without adding capability.

[![A horizontal flowchart showing six sequential steps of a support ticket workflow.](https://substackcdn.com/image/fetch/$s_!Za9K!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F94971ee8-618a-40c5-8687-d0dedfa73bd6_1200x489.png "A horizontal flowchart showing six sequential steps of a support ticket workflow.")](https://substackcdn.com/image/fetch/$s_!Za9K!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F94971ee8-618a-40c5-8687-d0dedfa73bd6_1200x489.png)

*Image 4: A horizontal flowchart illustrating the support ticket workflow with six sequential steps.*

Do not underestimate workflows. They are not limited to simple sequential chains. They can include routing to pick different models based on input.

They can use parallel execution with majority voting to aggregate answers. They can also use generator-evaluator loops where one LLM generates and another validates until quality criteria are met. They can even leverage tools in designs like the orchestrator-worker. These patterns handle complex tasks without any agent overhead.

If you can write down the exact sequence of steps in advance, like a recipe, it is a workflow.

## When a Single Agent with Tools Wins

Sometimes the order of work is not fixed. You genuinely cannot write down the steps in advance. This happens when the path changes depending on what you discover along the way.

Maybe the first API call fails, and you need to try an alternative. Maybe the retrieved data is incomplete, and you need clarification. This is what agents handle well.

When is an agent worth the risk? Anthropic offers a useful framework. Agents make sense when the task is complex enough to need autonomous decisions and delivers real value.

Critically, the cost of errors and the cost of discovering those errors must be low. This is why AI coding agents are great. A human reviews the code before production, so mistakes are cheap to fix.

A purchasing agent who accidentally buys the wrong hardware makes an expensive error. You must match your architecture to your error tolerance [[3]](https://www.anthropic.com/engineering/building-effective-agents).

The rule is to always start with one agent. A single agent with tools works best when tasks are tightly coupled and mostly sequential. It works well when global context matters, meaning step one affects step five.

It is also ideal when you need fewer than twenty tools and face strict budget or latency constraints.

Take a marketing content platform from Louis-François’s client work at Towards AI. The client wanted AI-assisted content generation for emails, text messages, and promotional materials. Their initial specification called for a multi-agent setup with over a dozen specialized agents.

They wanted an orchestrator, a request analyzer, a content generator, and many others. On paper, it looked clean with specialists doing specialist work.

[![Comparison of initial multi-agent setup versus actual single-agent solution for a marketing platform.](https://substackcdn.com/image/fetch/$s_!z1td!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3ea9f84f-dc70-4c98-9f72-af3a1dfb68c9_1200x630.png "Comparison of initial multi-agent setup versus actual single-agent solution for a marketing platform.")](https://substackcdn.com/image/fetch/$s_!z1td!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F3ea9f84f-dc70-4c98-9f72-af3a1dfb68c9_1200x630.png)

*Image 5: Comparison of initial multi-agent setup versus actual single-agent solution for a marketing platform.*

A single agent was the right call. The tasks were tightly coupled and sequential. The template choice affects the content.

Personalization depends on both content and contact data. Splitting this across multiple decision makers creates information silos and handoff errors. They did not need parallelism.

The flow was to plan, generate, validate, and fix if needed.

The key insight is that tools can be smart. A tool can have its own system prompt and use a different model. The validation tool can use its own LLM with instructions to catch errors.

The text message tool can treat character limits as deterministic engineering constraints instead of prompting problems. You get specialists, but you keep one brain to maintain context and make final decisions.

[![An agentic loop diagram showing how a single agent plans, executes, and reflects.](https://substackcdn.com/image/fetch/$s_!vqMr!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6b7f3d18-2a3d-48a3-8442-704aa5ba8c34_1200x630.png "An agentic loop diagram showing how a single agent plans, executes, and reflects.")](https://substackcdn.com/image/fetch/$s_!vqMr!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6b7f3d18-2a3d-48a3-8442-704aa5ba8c34_1200x630.png)

*Image 6: An agentic loop diagram showing how a single agent plans, executes, and reflects.*

This results in a system that is faster to build, cheaper to run, and easier to debug. You get the same capabilities without the coordination overhead.

## The Tool Count Problem: When One Agent Isn’t Enough

As your tool list grows, tool selection gets harder. This is one of the main ways agent systems quietly break down. It is also one of the clearest signals that splitting into multiple agents might be worth it.

Every tool has a name, description, and schema that the model needs in context to use correctly. The more tools you add, the more of your context budget you burn before the agent even starts thinking about the actual task. You also have to add system instructions, a few-shot examples, retrieved documents, and conversation history on top of that.

A single agent tends to work best with roughly 10 to 20 tools. Past that threshold, tool selection degrades. The agent has to choose among too many options in an already packed context.

This mechanism is known as context rot. LLM performance measurably degrades as context grows, well before hitting the advertised limit. Two forces drive this issue.

First, more context means more noise competing for the model’s attention. Second, models suffer from loss in the middle. They tend to attend more to the beginning and end of their context, underweighting information in the middle.

As your tool schemas and instructions pile up, the model gets worse at picking the right tool.

[![The context window budget problem — comparing 10 tools vs 25 tools.](https://substackcdn.com/image/fetch/$s_!YqbJ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F584e3d74-3c06-40b9-9ed8-ccee10d8da97_1200x630.png "The context window budget problem — comparing 10 tools vs 25 tools.")](https://substackcdn.com/image/fetch/$s_!YqbJ!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F584e3d74-3c06-40b9-9ed8-ccee10d8da97_1200x630.png)

*Image 7: The context window budget problem, more tools mean less room for actual task reasoning.*

Managing context can reduce history and retrieved content, but not the tool schema load. Those definitions must always be there. The only approach that actually reduces how many tool definitions the model sees per call is splitting across agents.

If one agent sees only email tools and another only sees validation tools, each call stays smaller. Tool selection gets easier. Once you split tools across agents to keep calls small, you enter multi-agent territory.

## When Multi-Agent Is Actually the Right Call

Specific reasons justify multiple agents, not because the architecture sounds impressive. There are four legitimate reasons to go multi-agent. First, you need true parallelism where tasks are genuinely independent and run simultaneously.

Second, you face context overload where instructions and tools degrade performance. Third, you need modularity to connect with third-party agent systems you do not control. Fourth, you have hard separation requirements like security boundaries or sensitive data handling.

Consider the professional article generation system that Louis-François and I built as one of the projects for our [Agentic AI Engineering course](https://academy.towardsai.net/courses/agent-engineering?ref=b3ab31&utm_source=decodingai&utm_medium=partner&utm_campaign=agent_engineering). We started with a single agent for research and writing but had to pivot because the two phases have fundamentally different needs.

The research phase is exploratory and dynamic. It needs flexibility and broad tool access across web search, video transcription, and document processing. The agent searches, reads, pivots based on what it finds, and iterates based on human feedback.

The writing phase is constrained and deterministic. It needs focused constraints, consistent style enforcement, and iterative refinement against fixed rubrics.

These agents communicate through explicit artifacts. The research agent produces a structured markdown file that the writer agent consumes as context. There is no complex runtime orchestration.

It is just a sequential handoff with a clear contract between them. Each agent has its own optimized context without the bloat of carrying the other’s tools.

[![The article generation multi-agent system with Research Agent and Writing Agent.](https://substackcdn.com/image/fetch/$s_!8P9n!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4d7b4acc-9771-4b65-a99e-4a48eb2a278b_1200x630.png "The article generation multi-agent system with Research Agent and Writing Agent.")](https://substackcdn.com/image/fetch/$s_!8P9n!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4d7b4acc-9771-4b65-a99e-4a48eb2a278b_1200x630.png)

*Image 8: The article generation multi-agent system with a Research Agent, a Writing Agent, and an artifact handoff.*

If you do go multi-agent, we recommend the plan-and-execute combined with the orchestrator-worker pattern. You do not want everyone talking to everyone. One orchestrator maintains the main context and delegates specific tasks to worker agents.

Then, it synthesizes the results. This prevents the information silos that kill multi-agent systems.

[![The Orchestrator-Worker pattern with delegation and result arrows.](https://substackcdn.com/image/fetch/$s_!Gnrt!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5b250f4b-eb33-479b-9791-4fa8a58ae816_1200x630.png "The Orchestrator-Worker pattern with delegation and result arrows.")](https://substackcdn.com/image/fetch/$s_!Gnrt!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5b250f4b-eb33-479b-9791-4fa8a58ae816_1200x630.png)

*Image 9: The Orchestrator-Worker pattern with no direct communication between workers.*

Multi-agent systems can simplify individual contexts and enable specialization. However, they increase coordination costs. You will face more token usage, added latency, more failure points, and handoff complexity.

Only accept those costs when you hit a real constraint that simpler architectures cannot solve.

## To Wrap Up

To build reliable AI applications, you must stay as far left on the complexity spectrum as possible while still solving your problem.

Keep these key takeaways in mind:

* Not every LLM application is an agent, and not every tool is an agent.
* Always start with workflows because they are predictable, cheap, and testable.
* Use one agent when the path cannot be predetermined, but keep the tool count manageable.
* Move to multi-agent architectures only when you hit a real constraint like true parallelism or context overload.

Each step right on the spectrum increases cost, latency, and debugging complexity. The simplest system that reliably solves the problem is always the best system.

> 💡 If you want **a step-by-step framework to help you decide what architecture to pick for your next project,** Louis-François and the Towards AI team put together a **[free cheatsheet](https://academy.towardsai.net/products/digital_downloads/agents-cheatsheet?ref=b3ab31)** that walks you through the decision process from workflows to multi-agent systems.

---

*What’s your opinion? Do you agree, disagree, or is there something I missed?*

[Leave a comment](https://www.decodingai.com/p/from-12-agents-to-1-ai-agent-architecture-decision-guide/comments)

---

*Enjoyed the article? The most sincere compliment is to share our work.*

[Share](https://www.decodingai.com/p/from-12-agents-to-1-ai-agent-architecture-decision-guide?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
