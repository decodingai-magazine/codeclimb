---
title: 'AI Workflows vs Agents: The Autonomy Slider'
type: rss
published: '2025-10-07T00:00:00+00:00'
length: '3020'
source: decodingai-paul
source_id: 01k7gqd364pw876ptvj8gszh37
source_url: https://www.decodingai.com/p/ai-workflows-vs-agents-the-autonomy
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: What only the top 10% AI engineers who ship think about
saved_at: '2025-10-14T06:44:20.948000+00:00'
updated_at: '2025-10-14T06:44:27.841489+00:00'
reading_time: 12 mins
---

***Welcome to AI Agents Foundations**—an 8-part journey from Python developer to AI Engineer.*

Everyone’s talking about AI agents. But what actually is an agent? When do we need them? How do they plan and use tools? How do we pick the correct AI tools and agentic architecture? …and most importantly, where do we even start?

**Over the following 8 articles, with a write-from-scratch mentality,** we’ll answer all these questions (and more!), focusing on the foundations to build the skills and mental models that you’ll need to ship real AI agents in production.

**What’s ahead**:

1. ***Workflows vs. Agents** ← You are here*
2. Structured Outputs
3. Workflow Patterns
4. Tools
5. Planning: ReAct & Plan-and-Execute

By the end, you’ll have a deep understanding of how to design agents that think, plan, and execute—and most importantly, how to integrate them in your AI apps without being overly reliant on any AI framework.

**Let’s get started.**

---

## Workflows vs. Agents

In the past few months, I have been working on my latest project: **Brown**, my writing assistant. Initially, I was not sure how to properly architect it, such as where I should use workflows, agents, or hybrids. Thus, I did what I usually do when I am not sure: *“JUST START”*. After weeks of hard work, I managed to get something working, but it was a mess. It was slow, complicated, and had a terrible UX. Ultimately, I had to refactor the whole thing.

After, I asked myself: *“What could I have done better, to avoid wasting all these weeks?”*

This is a broad question that I will carefully address in this longer series on the AI Agents Foundations. But for now, let’s start with the beginning: *When should you design your AI system as an agent or as a workflow?*

As AI Engineers this is an important architectural decision that we face early in our development process. We should always think what to choose between a predictable, step-by-step workflow where you control every action, or an autonomous agent that can think and decide for itself, like our lives depend on it. Why? Because this is one of the key decisions that will impact everything from development time and cost to reliability and user experience.

[![](https://substackcdn.com/image/fetch/$s_!8jSy!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6a30b362-68de-4a06-981e-81c6d915e144_1073x788.png)](https://substackcdn.com/image/fetch/$s_!8jSy!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F6a30b362-68de-4a06-981e-81c6d915e144_1073x788.png)

Image 1: Workflows vs. Agents: What would it be? (Source [Frankie’s Legacy](https://frankieslegacy.co.uk/take-the-red-pill-take-the-blue-pill-the-choices-and-decisions-we-make))

Choose the wrong approach, and you might end up with an overly rigid system that breaks when users deviate from expected patterns. Or you could build an unpredictable agent that works brilliantly 80% of the time but fails beautifully when it matters most. In the worst case, you could waste months of development time rebuilding the entire architecture, just like I did.

Thus, in this article we will first look at what’s the actual difference between workflows, agents and hybrid systems. Next, we will look at some popular workflow, agents and hybrid use cases to build the intuition required to design your own AI systems, such as:

* Document summarization workflow
* Coding agents
* Vertical AI agents
* Deep research agents

## Workflows vs. Agents: The Fundamental Difference

First, let’s understand the fundamental difference between workflows and AI agents.

An **AI workflow** is a sequence of tasks orchestrated by developer-written code. The steps are defined in advance by the AI Engineer, resulting in predictable, rule-based execution paths. Think of it as a factory assembly line where each station performs a specific, repeatable action. You will see in future articles that common patterns include chaining, routing, and orchestrator-worker [[1]](https://towardsdatascience.com/a-developer-s-guide-to-building-scalable-ai-workflows-vs-agents/), [[2]](https://www.anthropic.com/engineering/building-effective-agents).

[![](https://substackcdn.com/image/fetch/$s_!MBbS!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fda9c11e1-7f3b-4c07-8745-ff92516570d2_960x380.png)](https://substackcdn.com/image/fetch/$s_!MBbS!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fda9c11e1-7f3b-4c07-8745-ff92516570d2_960x380.png)

Image 2: A simple AI workflow

**AI agents**, on the other hand, are systems where an LLM dynamically decides the sequence of steps to achieve a goal. Here, the path is not predefined. Instead, the agent reasons and plans its actions based on the task and feedback from its environment. This is like an autonomous drone adjusting its flight path based on real-time obstacles and weather conditions. These systems often use actions and planning techniques like ReAct and Plan-and-Execute, which you will learn about in upcoming articles [[1]](https://towardsdatascience.com/a-developer-s-guide-to-building-scalable-ai-workflows-vs-agents/), [[3]](https://www.louisbouchard.ai/agents-vs-workflows/).

[![](https://substackcdn.com/image/fetch/$s_!U9x4!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F27bf96e1-6706-459e-9514-0be5fddd69a9_960x374.png)](https://substackcdn.com/image/fetch/$s_!U9x4!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F27bf96e1-6706-459e-9514-0be5fddd69a9_960x374.png)

Image 3: A simple AI agent

As illustrated in images 2 and 3, at a high level, what makes an agent, an agent, is the **autonomous loop**, where we feed back into the LLM the results from our tools, also known as our environment, and pass to the LLM the responsability to decide what to do next: call more tools or generate the final answer.

In reality, most systems are a mix of both, creating hybrid solutions. So, the question is, should we even bother labeling an AI application as a workflow or an agent?

## The Autonomy Slider: From Workflows to Agents

It is not about the label itself but about consciously deciding how much autonomy to grant your AI system. Stick with me, I promise you will get it by the end of the article.

In reality, this is not a binary question or answer! The decision between workflows and agents exists on a spectrum, which we can call the “autonomy slider.” As seen in image 4, at one end, you have fully controlled workflows while at the other, you have fully autonomous agents.

[![](https://substackcdn.com/image/fetch/$s_!bIH0!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F04b8d363-15db-4967-8188-629321ca8475_1150x766.png)](https://substackcdn.com/image/fetch/$s_!bIH0!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F04b8d363-15db-4967-8188-629321ca8475_1150x766.png)

Image 4: The autonomy slider, showing the trade-off between control and autonomy

Now, let’s extend our definition of AI workflows and agents from the previous section and understand which design approach excels best in which scenario.

**AI workflows** are best for structured, repeatable tasks. Common examples include data ingestion pipelines that extract information from PDFs and websites or content generation systems that repurpose articles into social media posts. Their main strength is predictability. Because the execution path is fixed, costs and latency are consistent, and debugging is straightforward. However, they can be rigid and require significant development time to engineer each step manually. This reliability makes them ideal for enterprise environments, such as finance or medicine, where consistency is essential [[4]](https://workspaceupdates.googleblog.com/2025/06/summarize-responses-with-gemini-google-forms.html), [[5]](https://blog.gopenai.com/agentic-workflows-vs-autonomous-ai-agents-do-you-know-the-difference-c21c9bfb20ac), [[6]](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2025/autonomous-generative-ai-agents-still-under-development.html).

**AI agents** excel at open-ended, dynamic problems where the solution path from A to B is unclear. Think of an agent tasked with researching a complex topic or one that generates, executes, and debugs code to solve a problem. Their strength lies in their adaptability and flexibility. The trade-off is a loss of reliability. Agents are non-deterministic, so their performance, cost, and latency can vary with each run. They are also harder to debug and often require larger, more expensive LLMs to reason effectively through the provided context and available tools.

For example, in the early stages of Cursor, when I asked to edit a file, it used a simple workflow that ran in a couple of seconds. Now, with its sophisticated agents, it sometimes takes up to 10-15 minutes to execute a simple “replace X to Y” request. Because of this I went back to the stone age and started using “find & replace” again [[7]](https://www.lyzr.ai/blog/agentic-ai-vs-llm/).

[![](https://substackcdn.com/image/fetch/$s_!Mze5!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdca0e051-e2a4-4260-8ec5-5c185a3d7bf7_1027x534.png)](https://substackcdn.com/image/fetch/$s_!Mze5!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdca0e051-e2a4-4260-8ec5-5c185a3d7bf7_1027x534.png)

Image 5: The AI-generated answer and human feedback loop.

Most real-world systems find a balance. When you build an application, you decide where to set the autonomy slider. A manual process might involve a workflow with a human verifying each step. A more automated one gives the agent greater control with fewer human-in-the-loop checkpoints. Andrej Karpathy noted that successful applications like Cursor and Perplexity let the user control this slider, offering different levels of autonomy for different tasks [[8]](https://www.youtube.com/watch?v=LCEmiRjPEtQ).

## Zooming in on My Favorite Examples

To make these concepts tangible, let’s examine four examples, progressing from a simple workflow to a more complex hybrid system. We will keep the explanations high-level, as we will explore their details in future articles.

### Document Summarization Workflow

**What we want to build:** To speed up document search and interpretability, most cloud providers, such as Google Drive, compute an embedded summary along with your docs. This is a perfect example of a simple workflow, because it’s predictable, while it has to be fast and cheap.

[![](https://substackcdn.com/image/fetch/$s_!TNnV!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F66731987-7a42-4bb6-a157-2932bb8507fe_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!TNnV!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F66731987-7a42-4bb6-a157-2932bb8507fe_1200x1200.png)

Image 6: Document summarization workflow (e.g., in Google Drive)

**How it works:** The system reads the document you opened, routes it to a specialized LLM that, based on its content (e.g., Google Docs, PDFs, slides, etc.), generates a summary. Next, we chain another LLM call that extracts metadata like tags from the summary. Finally, the results are saved and displayed to the user. This is a pure workflow where every step is predefined [[9]](https://workspace.google.com/blog/product-announcements/may-workspace-feature-drop-new-ai-features), [[10]](https://www.cnet.com/tech/services-and-software/how-to-summarize-text-using-googles-gemini-ai/).

**With code:**

```
def summarize_document(document):
    # Step 1: Read document
    content = read_document(document)
    
    # Step 2: Route to specialized LLM based on doc type
    doc_type = detect_document_type(content)
    specialized_llm = route_to_llm(doc_type)
    
    # Step 3: Generate summary
    summary = specialized_llm.generate_summary(content)
    
    # Step 4: Extract metadata
    metadata = extract_metadata(summary)
    
    # Step 5: Cache results
    cache_results(summary, metadata)
    
    return summary
```

### Coding Agents: Gemini CLI or Claude Code

**What we want to build:** One of the best use cases for AI agents is writing code because there is tons of data available for free online, and the results are easy to evaluate: the code works or not. Let’s take a look at how Gemini CLI works behind the scenes. Based on our latest research from August 2025, it uses a single-agent architecture that allows the model to reason about a problem and then autonomously act to solve it. This iterative loop of thinking and doing is a common pattern for agents [[11]](https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent/), [[12]](https://cloud.google.com/gemini/docs/codeassist/gemini-cli).

[![](https://substackcdn.com/image/fetch/$s_!pXKU!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd7c2ea63-42b0-4e05-b06b-174b65a7e2df_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!pXKU!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd7c2ea63-42b0-4e05-b06b-174b65a7e2df_1200x1200.png)

Image 7: The operational loop of coding agents such as the Gemini CLI coding assistant.

**How it works:**

1. **Gather Context**: The agent loads the code and documentation in its working memory with the directory structure and available actions.
2. **Propose Plan (as tools)**: The LLM drafts a step-by-step plan, expressed as tool calls it intends to run.
3. **Validate Plan (human-in-the-loop)**: The user reviews and approves or edits the plan.
4. **Execute Plan**: The agent runs the approved tools to read, write, or run code.
5. **Generated Code**: The resulting code changes are produced and staged for review.
6. **Evaluate Code**: The agent compiles, runs, and/or tests the code to assess results.
7. **Loop Decision**: If not done, it iterates, otherwise, it finalizes the code.

**With code:**

```
def coding_agent(user_query):
    # Step 1: Gather context
    context = gather_context(codebase, docs)
    
    # Agentic loop
    code_done = False
    while not code_done:
        # Step 2: LLM proposes plan as tools
        plan = LLM.propose_plan(user_query, context)
        
        # Step 3: Human validates plan
        approved_plan = human.validate(plan)
        
        # Step 4: Execute plan
        generated_code = execute_plan(approved_plan)
        
        # Step 5: Evaluate code
        evaluation = evaluate_code(generated_code)
        
        # Step 6: Decision - is code done?
        code_done = LLM.is_done(evaluation)
        context = update_context(evaluation)
    
    return generated_code
```

### Vertical Hybrid AI Agents

**What we want to build:** We want to build a QA assistant on a specialized domain like a shopping, nutrition or investing assistant. This is probably one of the most common use cases for AI nowadays. In this use case, we can anticipate a big portion of the user requests (e.g., list files, get summary, generate report, recommend meal, investment plan, etc.) while also handling open-ended queries. This is an excellent use case for a hybrid system.

[![](https://substackcdn.com/image/fetch/$s_!gNtA!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1c96e813-225d-4fcb-a49f-964e38a7d8ca_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!gNtA!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1c96e813-225d-4fcb-a49f-964e38a7d8ca_1200x1200.png)

Image 8: Hybrid system for vertical AI agents.

**How it works:** The architecture combines a workflow with an agent. A **workflow router** first interprets the user’s request. If it matches a predefined scenario (e.g., “generate a Q3 financial summary”), it is sent to a specialized workflow with hardcoded steps for a fast and consistent response. If the question is open-ended, it is routed to an AI agent that can dynamically plan and execute the user’s request. This design combines the consistency of workflows with the adaptability of agents [[13]](https://www.revanthquicklearn.com/post/understanding-workflow-design-patterns-in-ai-systems), [[14]](https://docs.aws.amazon.com/prescriptive-guidance/latest/agentic-ai-patterns/workflow-for-routing.html).

**With code:**

```
def vertical_ai_system(user_request):
    # Workflow router decides the path
    request_type = workflow_router(user_request)
    
    # Anticipated scenarios → predefined workflows
    if request_type == “list_docs”:
        answer = list_documents_workflow()
    elif request_type == “get_summary”:
        answer = get_summary_workflow()
    elif request_type == “generate_report”:
        answer = generate_report_workflow()
    
    # Open-ended questions → agent with tools
    else:
        answer = Agent(
            query=user_request,
            tools=[search, analyze, synthesize]
        )
    
    return answer
```

### Deep Research Hybrid Agents

**What we want to build:** Perplexity’s Deep Research feature. While the system is closed-source, we can infer its high-level architecture from public information, which appears to combine a structured workflow with multiple specialized agents [[15]](https://www.perplexity.ai/hub/blog/introducing-perplexity-deep-research).

[![](https://substackcdn.com/image/fetch/$s_!q-Hw!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9df132d4-34a5-46f5-9f1a-5e95bdf37f28_1200x1200.png)](https://substackcdn.com/image/fetch/$s_!q-Hw!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9df132d4-34a5-46f5-9f1a-5e95bdf37f28_1200x1200.png)

Image 9: The iterative multi-step process of Perplexity’s Deep Research agent.

**How it works:** Here is a simplified overview: an orchestrator agent plans the research by decomposing the query into sub-questions. Specialized search agents then gather information in parallel using actions like web search. After the agents analyze, validate and synthesize their findings. Ultimately, the orchestrator reviews the results, identifies knowledge gaps, and initiates further research cycles if needed. Finally, it compiles everything into a comprehensive report [[16]](https://www.langchain.com/breakoutagents/perplexity), [[17]](https://www.usaii.org/ai-insights/what-is-perplexity-deep-research-a-detailed-overview).

**With code:**

```
def deep_research(user_query):
    gaps_exist = True
    all_findings = []
    
    while gaps_exist:
        # Step 1: Orchestrator breaks query into sub-questions
        sub_queries = LLM.decompose_query(user_query, all_findings)
        
        # Step 2: Specialized agents run in parallel
        findings = []
        for query in sub_queries:
            result = Agent(
                query=query,
                tools=[web_search, analyze, validate]
            )
            findings.append(result.synthesize())
        
        all_findings.extend(findings)
        
        # Step 3: Check for gaps in research
        gaps_exist = LLM.identify_gaps(all_findings)
    
    # Step 4: Compile final report
    return compile_report(all_findings)
```

## The Fine Line Between Workflows and Agents

There is a fine line between workflows and agents. In the real-world the difference between the two is fuzzy. For example, if we take our hybrid deep research example, where we added a loop between stopping or making new queries, would we consider that agentic behavior or not? To be honest, I don’t know, and don’t really care.

My goal with this article was not to have you obsess over labels, such as what a workflow or an agent is. In reality, that’s not that important. Instead, I want you to deeply consider the right trade-off between control at the right level of human-in-the-loop and autonomy for your AI application before writing a single line of code.

**Before wrapping up, here is a simple thinking model that I always apply in my AI apps:**

*“You should always start your design with simple, fully controllable AI systems. If a simple LLM call gets the job done. Perfect. Stop there. Next, you should instantly start thinking about adding a human in the loop. You should move to hybrid systems and start adding more autonomy only when it’s REALLY required by your business use case. When you do that, you should instantly think about how you plan to let the user tweak the autonomy slider based on their needs. Ultimately, you should implement full-fledged agents only if you have no other choice.”*

That’s it! Simple, step by step, and straight to the point.

Remember that **this article is part of a longer series of 8 pieces on the AI Agents Foundations** that will give you the tools to morph from a Python developer to an AI Engineer.

Here’s our roadmap:

1. **Workflows vs. Agents** *← You just finished this one.*
2. Structured Outputs *← Move to this one (available next Tuesday, 9:00 am CET)*
3. Workflow Patterns
4. Tools
5. Planning: ReAct & Plan-and-Execute

See you next week.

[Paul Iusztin](https://www.linkedin.com/in/pauliusztin/)

---

*What’s your take on today’s topic? Do you agree, disagree, or is there something I missed?*

[Leave a comment](https://www.decodingai.com/p/ai-workflows-vs-agents-the-autonomy/comments)

---

*If you enjoyed this article, the ultimate compliment is to share our work.*

[Share](https://www.decodingai.com/p/ai-workflows-vs-agents-the-autonomy?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
