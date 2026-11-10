---
title: I Replaced My Vibe Coding With a Six-Agent Software Team
type: rss
published: '2026-05-12T00:00:00+00:00'
length: '2622'
source: decodingai-paul
source_id: 01kre3c159fcpsxjw36waca0cm
source_url: https://www.decodingai.com/p/squid-my-agentic-coding-setup-may-2026
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: My Claude Code agentic coding setup that one shots all my design decisions
saved_at: '2026-05-12T12:42:39.729000+00:00'
updated_at: '2026-05-12T12:42:43.457942+00:00'
reading_time: 10 mins
---

[![Squid — a six-agent team where no single agent both writes the code and decides if it's correct.](https://substackcdn.com/image/fetch/$s_!e0Qp!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7f80fe78-e6b2-4fc9-b2e1-e4484cb9d42b_1400x1000.png "Squid — a six-agent team where no single agent both writes the code and decides if it's correct.")](https://substackcdn.com/image/fetch/$s_!e0Qp!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7f80fe78-e6b2-4fc9-b2e1-e4484cb9d42b_1400x1000.png)

I needed a TypeScript harness for my latest book code. It required a Terminal User Interface (TUI), an agent loop, tools, Model Context Protocol (MCP) support, skills, and slash commands. I will be honest with you. I first tried to vibe code this project.

As I knew what I was looking for, it worked. Until it didn’t. The code was working until you started looking more closely at the details. Only the first 20 characters were rendering inside the TUI, and the skills weren’t invoked by the agent loop.

So I deleted the whole code base and started over with a new strategy.

The cost of vibe coding isn’t abstract. It’s the next feature you can’t ship because you’re debugging a slash-command renderer that looked finished. This is what most people get wrong. Output that compiles and looks done breaks the moment you reach for the rough edges.

I divided the harness into tasks. I one-shotted the barebones version, which was just a TUI plus an agent loop with `bash`, `grep`, and a todo tool. Then I layered MCP, skills, and slash commands as separate features.

You can’t one-shot whole applications. You can one-shot big features if you scope them right and run them through a real engineering process.

This is known as agentic coding. Not vibe coding. You’re using agents to write the whole codebase, but you are still the mastermind behind everything.

But I wanted more. I wanted to automate this process. But with a single constraint in mind: “the code should HAS to be good”.

That’s why I built Squid. It’s an opinionated six-agent Claude Code setup available at [iusztinpaul/squid](https://github.com/iusztinpaul/squid). It ships features the way a real software team ships them.

Squid has already shipped our content-automation tool, expanding it from articles to posts, notes, threads, and messages. It shipped the book’s code data pipelines and TypeScript harness.

In this article I will show you how it works.

The concrete blueprint relies on a specialized team and an e2e lifecycle.

## The Six Agents Engineering Team

The system contains six agents. No agent both writes code and decides whether the code is correct.

[![The six-agent team](https://substackcdn.com/image/fetch/$s_!9yS9!,w_2400,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fecde9a6b-b62d-4f38-a010-6c8af2e9728e_1208x1038.png "The six-agent team")](https://substackcdn.com/image/fetch/$s_!9yS9!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fecde9a6b-b62d-4f38-a010-6c8af2e9728e_1208x1038.png)

My Agentic Engineering Team

The **product manager agent** manages the tasks and ensures the feature adheres to the software architect’s specifications. It takes a raw feature specification, writes or updates an Architecture Decision Record (ADR) for non-obvious choices, and splits the feature into ordered tasks. It also maintains the Domain-Driven Design (DDD) glossary so vocabulary stays consistent between the business and engineering.

Note how, because Claude can easily handle both PM and software architecture work, we decided to merge these roles together. We did this to avoid fragmenting the context just to follow a standard human process. Ultimately, planning should be closely aligned with the software architect’s vision. In human processes, dividing these two responsibilities often created more issues than solutions.

The **software engineer agent** uses red-green Test-Driven Development (TDD). It writes the failing test, writes the minimal code to pass it, and then refactors. The software engineer uses direct command-line interfaces (CLIs) like `git`, `mongosh`, and `gh`. It never uses MCP wrappers. CLIs are more flexible because they tap directly into the power of bash. Plus, LLMs have seen considerably more bash code than MCP wrappers during training.

The **tester agent** specializes in the adversarial end-to-end edge-case pass. It catches false-confidence claims where the software engineer says the tests pass. It does this by reading every acceptance criterion against concrete evidence, like the test name, file lines, and command output.

The **pull request reviewer agent** performs a diff-only review. It looks for dead code, duplication, missing test coverage, and documentation adherence. It does a narrow performance review on hot paths only. It’s explicitly told not to micro-optimize one-off scripts.

The **on-call agent** loops on the Continuous Integration (CI) pipeline until it passes. In an earlier iteration, the CI check lived inside the software engineer and tester loop, and it got skipped constantly. Promoting it to a dedicated agent invoked by the orchestrator increased the probability the step runs.

The **self-improve agent** is an optional meta agent. After the feature is done, while looking over the results, the human can run the self-improve agent to scan the run for high-signal lessons and propose updates to the agentic coding layer that consists of `CLAUDE.md`, skills and subagents. This is a double-edged sword. It can constantly improve your workflow or quickly degrade it if you are not careful. That’s why it’s incredibly important that this step is gated by a human.

The secret sauce is in anchoring the agents into your own documentation.

## Keeping Up With Documentation: ADRs & DDD Glossary

The ADR directory acts as compressed architectural memory across runs. Every non-obvious choice regarding the datastore, synchronization defaults, authentication boundaries, or dependency lock-in ships with an ADR. These records include the status, context, decision, and consequences at `docs/adr/.md`. The product manager reads the directory before grooming a new feature, so decisions stay consistent across feature branches.

The DDD glossary gives shared vocabulary between the business and engineering at `docs/glossary.md`. It enforces one canonical name per concept. Code identifiers, OpenAPI schemas, database columns, and customer-facing interfaces all use the term exactly as it appears there. This gives Claude Code business context, not just code context, properly anchoring your code in your domain. The software engineer, tester, and pull request reviewer all reason about the same domain.

I have an honest caveat. The agents still under-use both the ADRs and the glossary. The spine exists, but I am still working on getting the agents to lean on it consistently.

Now the agents have the context they need to execute a feature from a raw specification all the way to a merged pull request.

## The Night Skill. The End-To-End Workflow.

The `/night` skill takes one input, which is a feature specification written by the human, and produces one output, which is a merged pull request with green CI. Everything in this section sits between those two endpoints.

The `/night` pipeline is a long-running lifecycle. That’s why it’s called the “night” skill. It’s scoped to run for hours at a time, often with multiple pipelines in parallel.

It has two human checkpoints and five retry caps, while everything else is automated. The orchestrator acts as a manager. It never writes code itself, never runs tests itself, and never reviews the diff itself. It launches agents and enforces human validation.

After a human carefully writes a detailed feature specification, it calls the `/night` skill, which creates a new branch and worktree. The product manager reads the glossary and ADR directory, updates or writes a new ADR if needed, and splits the feature into a task plan.

Then we hit the first human gate. The user approves the plan, optionally sharpened by the `/grill-me` skill. The `/grill-me` skill is inspired by Matt Pocock’s work, which forces the agent to ask sharp questions back about anything fuzzy in the plan, such as interfaces, modularization, or new tools. This conversation is the line between vibe coding and agentic coding.

Next is the inner loop per task. The software engineer implements the code, the tester verifies it, and failures route back to the software engineer. This loop is capped at 5 attempts. Convergence is mostly mechanical through a run, fail, fix, and run cycle.

The product manager then performs an acceptance review on the whole feature from the user’s perspective. Rejections are packed into a single task back into the inner loop. This is capped at 3 attempts, because judgment-call loops are where Claude Code spirals.

Next, we repeat a similar loop using the PR reviewer agent, which looks at the diff, with a maximum of 3 attempts to avoid perfectionism. Adding a maximum number of attempts here is critical, because during review an LLM almost always has something else to say.

After the push, the on-call agent watches CI with a maximum of 5 attempts, routing failures back to the software engineer.

When the CI is green, we notify the user (e.g., via Slack) that the PR is ready for review. Optionally, based on any potential issues found while running the `/night` skill, we run `self-improve` to propagate that into your memory.

The /night lifecycle. Two human gates, five retry caps, everything else automated.

[![The /night lifecycle. Two human gates, five retry caps, everything else automated.](https://substackcdn.com/image/fetch/$s_!8VWO!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5775bbe9-c91b-46fe-94ef-1a819be0bce8_1200x965.png "The /night lifecycle. Two human gates, five retry caps, everything else automated.")](https://substackcdn.com/image/fetch/$s_!8VWO!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5775bbe9-c91b-46fe-94ef-1a819be0bce8_1200x965.png)

My Agentic Coding Setup

Beautiful! With this process I one-shot most of the features I am working on. And when it’s not a one-shot, I’m typically 95–99% there by the time I review the PR.

## How the Tester Stopped Re-Running What the SWE Already Ran

The biggest problem with the e2e workflow above is that it’s slow and redundant. I preferred that over generating AI slop that I have to manually review and fix.

Still, there are a few tweaks that we can make to the workflow to improve speed and efficiency.

For example, when the tester re-ran the linter, type checker, formatter, and the happy-path suite that the software engineer had already run, we paid for everything twice. This was the number-one source of having a system that works but is too slow to use.

To fix this, the tester now accepts the software engineer’s reports for formatting and happy-path tests. It only runs the adversarial end-to-end edge-case pass itself. This covers the part the software engineer can’t credibly self-verify. Trust is bounded. Intuitively, I realized I’d started shifting the `Tester` toward QA-style practices, rather than just running simple tests.

I am still iterating on optimizations. For example, I want to route some subagents to Claude Sonnet models instead of Claude Opus. I also plan to narrow toolsets per role to reduce reasoning failures.

Also, depending on what you are working on, you might want to use the system more as a fast, snappy assistant than as a long-running workflow that prioritizes correctness above all.

## Day vs. Night: Two Orchestrators, One Team

That’s why we have two pipelines running the same agents. The `/night` skill is the full lifecycle. It’s long-running, set-and-forget, has two human gates, and runs while you are away from the keyboard or working in parallel.

The `/day` skill is the lean inner loop. It runs the software engineer, the tester, and human commits for surgical edits. It skips product manager grooming, the pull request reviewer, and the on-call agent.

There is a concrete use case for the `/day` skill. When I read a merged pull request and find code I don’t like, the `/day` skill runs the stripped software engineer and tester loop to apply targeted edits. Then the on-call agent cleans up any CI fallout. This is the surgery that keeps the system from becoming a black box.

[![Day vs. Night — same agent team, two orchestrators tuned for different workloads.](https://substackcdn.com/image/fetch/$s_!2bZF!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1143ede6-93a8-4c72-ac85-3f12071bd61b_1200x965.png "Day vs. Night — same agent team, two orchestrators tuned for different workloads.")](https://substackcdn.com/image/fetch/$s_!2bZF!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F1143ede6-93a8-4c72-ac85-3f12071bd61b_1200x965.png)

Day vs. Night: Same agent team, two orchestrators tuned for different workloads.

Both pipelines have one thing in common. The human is in the loop on purpose, not as a fallback.

## Why Code Templates Are a Waste of Time in 2026

Most teams are still scaffolding from cookiecutter templates that were outdated the day they were committed. This is a maintenance tax disguised as productivity. Squid stops paying that tax. Technology moves fast enough that any frozen template’s frameworks, tooling, interfaces, and opinions all need their own maintenance pipeline. That’s only worth it if one template fans out across dozens of projects.

A Copier or cookiecutter template isn’t free. I tried scaling one across Python, TypeScript, and Go. I watched the project balloon into a maintenance burden where most files would never be used. Maintaining a template engine to support multiple stacks is a full-time job.

Asking Claude Code to copy from the last project fails too. It propagates the technical debt baked into the source codebase. You inherit the mess, not the ideal state.

The real shift relies on markdown, not Jinja. I call these **agentic templates**.

You encode good practices as skills and `CLAUDE.md` files. Fundamentals like clean architecture, CI/CD discipline, testing patterns, and development cycles rarely change. When they do change, you edit prose instead of regenerating from a template engine that quickly slides into dependency hell.

Tooling stays dynamic. You don’t pin framework versions inside a template. You keep a decision tree of allowed choices and let the agent pull the latest interfaces on demand via Context7 at scaffold time.

Project structure can’t be templatized. The anti-pattern organizes by type, putting files into `agents/`, `nodes/`, `schemas/`, and `tools/` directories. One business module’s logic ends up scattered across four folders, forcing both humans and the agent’s context window to thrash.

The correct pattern organizes by actionability, keeping one bounded context per directory. Each domain owns its own types, store, Application Programming Interface (API), and prompts. That’s locally readable, easier to maintain, and easier for the agent to reason about.

Because we describe the structure in Markdown files instead of cookiecutter templates, we can define it like this:

[![code](https://substackcdn.com/image/fetch/$s_!bhZj!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F83fcb967-260a-49e3-af0c-b1a7f0181e01_2737x1779.png "code")](https://substackcdn.com/image/fetch/$s_!bhZj!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F83fcb967-260a-49e3-af0c-b1a7f0181e01_2737x1779.png)

Avoid global dumping grounds like `utils/` or `helpers/`. Avoid a root-level `types.py` grab bag. Avoid grouping tests by type.

The `/scaffold` skill acts as an interactive bootstrap. An `AskUserQuestion` prompt drives a tight decision tree covering project identity, layout, components, backend, frontend framework, infrastructure, agent team, tracker, ADR and glossary opt-ins, and external services. A deterministic table picks only the matching specifications from the specification library. Unused categories never enter the context. The skill writes a tailored `CLAUDE.md` brief, lays down an empty folder skeleton, and hands off.

Then, based on the agentically generated template, you can use `/night` or `/day` to start writing real code.

## Open-Sourcing Squid

I don’t want to keep Squid for myself. I want to share it with the community to learn from and contribute to.

Thus, **I am open-sourcing [Squid](https://github.com/iusztinpaul/squid).**

You can install it as a Claude Code plugin:

```
/plugin marketplace add iusztinpaul/squid
/plugin install squid@squid
```

I want you to try it, build something awesome with it, and if you like it, contribute back:

[Check the full codebase](https://github.com/iusztinpaul/squid)

*Still, here is what I’m wondering:*

> ***What is your agentic coding setup? How is Squid different from your own approach?***

*Click the button below and tell me. I read every response.*

[Leave a comment](https://www.decodingai.com/p/squid-my-agentic-coding-setup-may-2026/comments)

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/squid-my-agentic-coding-setup-may-2026?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---
