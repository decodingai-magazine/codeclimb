---
title: Stop Babysitting Your Coding Agents
type: rss
published: '2026-09-10T00:00:00+00:00'
length: '3442'
source: decodingai-paul
source_id: 01m24wjgb1r88p8xf8aq0thmj5
source_url: https://www.decodingai.com/p/coding-agents-in-remote-headless
author: Paul Iusztin
site_name: Decoding AI Magazine
category: rss
location: feed
tags: []
summary: Run the harness remotely on Modal, triggered by your CLI, a webhook, or a
  nightly cron.
saved_at: '2026-09-10T05:27:40.201000+00:00'
updated_at: '2026-09-10T05:27:50.712639+00:00'
reading_time: 13 mins
---

***Every AI application that wraps an agent is a harness!***

In LangChain’s Terminal-Bench experiment, changing only the harness (with the same model) moved a coding agent from ~30th place into the top 5: the harness, not the model, is what makes a coding agent good.

In the **open-source course** **[Building a Coding Agent From Scratch](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course)**, you’ll build that harness from scratch in Python: **Decode**, a complete coding agent that grows lesson by lesson from a bare agent loop into a swarm of remote agents running in parallel in the cloud.

**Why?** You’ll be able to engineer custom harnesses for your own AI products (the skill behind that leaderboard jump), and you’ll understand what Claude Code and Codex actually do under the hood, turning you into a power user.

[![](https://substackcdn.com/image/fetch/$s_!ge05!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F27ba7d81-6547-41ad-9370-e9df2dd960e1_1200x630.gif)](https://substackcdn.com/image/fetch/$s_!ge05!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F27ba7d81-6547-41ad-9370-e9df2dd960e1_1200x630.gif)

**Lessons:**

1. [Building a Coding Agent From Scratch](https://www.decodingai.com/p/building-a-coding-agent-from-scratch-system-design)
2. [The Bare-Bones Coding Agent Loop](https://www.decodingai.com/p/the-coding-agent-loop)
3. [From a Raw Shell to a Sandboxed Coding Agent](https://www.decodingai.com/p/run-coding-agents-safely)
4. [Context Engineering for Coding Agents](https://www.decodingai.com/p/context-engineering-for-coding-agents)
5. [Subagents Are Context Engineering](https://www.decodingai.com/p/subagents-are-context-engineering)
6. **Swarm of Remote Agents** **←** ***You are here***
7. AI Evals Foundations **←** *Available next week*
8. AI Evals on Steroids via Replays

[Full open-source course](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course)

# Lesson 6: Swarm of Remote Agents

[![You went to bed. The work did not.](https://substackcdn.com/image/fetch/$s_!PKQ2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9a7063de-4375-455e-9186-a287c9020433_1376x768.png "You went to bed. The work did not.")](https://substackcdn.com/image/fetch/$s_!PKQ2!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F9a7063de-4375-455e-9186-a287c9020433_1376x768.png)

While building automations for Decoding AI and the personal assistant for my next Manning book, I ended up with five coding agents running in parallel. After three hours, I was completely exhausted, losing clarity and forgetting what they were doing and what their scope was. The real issue wasn’t running five agents. It was babysitting them, each needing me present in a terminal.

The goal is to have background agents running in your CI/CD pipeline or proactive agents pulling Linear tickets overnight that launch parallel attempts and pick the best PR for you to review. The goal is to switch from having your work blocked behind a TUI to proactive agents that analyze your KPIs overnight, waking up with the final report to review.

That’s *“the goal”,* the ideal I am still trying to achieve. But my best attempt to truly understand how these background agents integrate into my daily workflows without throwing money at the problem is to build a simple solution from scratch.

Thus, we will take Decode, the coding harness we built during this course, and deploy it to the cloud as a background agent through three steps:

1. Switch from a TUI to a CLI headless interface
2. Ship it to Modal to run it as remote serverless jobs
3. Add support for parallel sessions to hook it to multiple projects in parallel

By the end, you will run:

```
uv run decode remote attempts "Add support to attach the agent to Slack" \
  --repo https://github.com//.git \
  --attempts 3 \
  --sandbox-mode modal
```

That will spin off 3 independent Decode agents implementing the same feature on Modal, each shipping its own `decode/` branch, which another coding agent can later compare, forwarding only the best one for your review.

[Try it yourself](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course)

Before anything runs remotely, we have to drop the TUI and make the harness headless.

## Making the harness.. headless

The **headless mode** runs the harness directly from the CLI and triggers the agent loop until the given goal is reached: `decode run ""`. It wraps the same `build_agent()` agent loop as the TUI, but under a new interface. This is easy to implement when adopting a clean architecture design that separates the app layer (the agent loop) from the serving layers (the TUI and CLI).

*Exposing the harness as a CLI will open up tons of possibilities, as you will soon see!* A CLI is also scriptable, which is what lets Mario Zechner run subagents as plain `pi` calls under `tmux` in [his minimal coding agent](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/).

Because the agent runs in the background, everything defaults to bypass permission mode, and the `ask_user` tool becomes a no-op. On top of that, stdout prints only the final answer, while the full traces are redirected only to [Opik](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul&utm_content=coding_agent_course), our observability platform.

This design is extremely similar to Claude Code’s `claude -p ""` interface.

[![The harness interface — a TUI, a CLI, an evals harness, and a remote launcher each drive the same loop by filling the same six fields; the loop has no opinion about any of them.](https://substackcdn.com/image/fetch/$s_!6idL!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F47b2533c-0dca-4aa9-9308-711cc7101aee_1200x1200.png "The harness interface — a TUI, a CLI, an evals harness, and a remote launcher each drive the same loop by filling the same six fields; the loop has no opinion about any of them.")](https://substackcdn.com/image/fetch/$s_!6idL!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F47b2533c-0dca-4aa9-9308-711cc7101aee_1200x1200.png)

*The headless harness has four modes: TUI, CLI, an evals harness, and the remote launcher.*

The **harness interface** is two things: `build_agent()` (the model, the tools, the instructions) and `AgentDeps` (the tool scope, an event sink, the gate, and two resolvers for when the loop needs a human). We can add a new serving layer by implementing this interface. As shown in the image above, we will use this design to support 4 modes: the TUI, the local CLI, remote background jobs, and an eval harness (built with [Opik](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul&utm_content=coding_agent_course) and [Kitaru](https://www.zenml.io/product/kitaru?utm_source=decodingai&utm_medium=referral&utm_campaign=coding-agent-course&utm_content=brand)).

💡 *The remote background jobs and eval harness will be layers on top of the CLI.*

*From [src/decode/agent/deps.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/agent/deps.py) and [src/decode/agent/factory.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/agent/factory.py):*

```
@dataclass(slots=True)
class AgentDeps:
    cwd: Path                                    # the tool scope
    emit: EventSink                              # stream events (eg, TUI)
    gate: PermissionGate                         # allow / ask / deny, per tool call
    resolve_permission: PermissionResolver       # who answers an "ask"
    resolve_user_question: UserQuestionResolver  # who answers the ask_user tool
    harness_home: Path | None = None             # sessions, memory, skills

def build_agent(*, model: str | None = None) -> Agent[AgentDeps, str | DeferredToolRequests]:
    agent = Agent(
        _build_model(model=model),               # gemini | openrouter | modal
        deps_type=AgentDeps,
        output_type=[str, DeferredToolRequests],
    )
    register_tools(agent)                        # read, edit, bash, agent, etc.
    _register_instructions(agent)
    return agent
```

Under the CLI, when running `decode run`, we implement the `AgentDeps` interface as follows: a sink that only logs, a gate in bypass mode, resolvers that deny any human interaction, and one `agent.run` agent loop in a single Python async loop.

*From [src/decode/runtime/headless.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/runtime/headless.py):*

```
def _build_headless_deps(cwd: Path, model: str | None = None) -> AgentDeps:
    return AgentDeps(
        cwd=cwd,
        harness_home=Path.cwd(),
        emit=_headless_emit,                              
        gate=PermissionGate(mode=PermissionMode.BYPASS),
        resolve_permission=_deny_permission_resolver,      
        # never reached under BYPASS
        resolve_user_question=deny_user_question_resolver, 
        # ask_user is a no-op
    )

async def _run_task(task: str, *, model: str | None, repo: str | None, max_requests: int | None) -> str:
    tool_scope = await _prepare_headless_tool_scope(repo, local)  
    # the Workspace in a sandbox mode, else cwd
    agent = build_agent(model=model)                       
    # the SAME agent the TUI builds
    deps = _build_headless_deps(tool_scope, model)
    result = await agent.run(task, deps=deps, usage_limits=UsageLimits(request_limit=max_requests))
    return result.output

def run_headless_task(task: str, ...) -> str:
    try:
        return asyncio.run(_run_task(task, ...))
    finally:
        ...
```

In retrospect, here is how we implemented the `AgentDeps` interface within the interactive mode plugged into the TUI: a sink that renders in the terminal, a gate loaded from your configs, resolvers that await the user, and a Runner that implements a steering queue that pours messages into the agent loop at the right time ([full implementation in Lesson 2](https://www.decodingai.com/p/the-coding-agent-loop)).

*From [src/decode/tui/app.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/tui/app.py):*

```
decisions = DecisionChannel()                 # mid-turn surface for permissions + ask_user
agent = build_agent()
gate = PermissionGate(user_rules=rules.load_rule_set(permissions_file))
deps = AgentDeps(
    cwd=tool_scope,
    harness_home=harness_home,
    emit=_make_event_sink(console),           # events render live in the terminal
    gate=gate,
    resolve_permission=_make_permission_resolver(decisions, console, gate=gate, ...),
    resolve_user_question=_make_user_question_resolver(decisions, console),
)

handler = AgentTurnHandler(agent, deps=deps, session_log=session_log, ...)
runner = Runner(handler, on_event=_on_event)  # steering queue
```

The two upcoming serving layers share this same clean architecture: an evals harness running `decode run` across benchmarks, and the remote background agents we build next.

In this CLI design, one key option is `--max-requests N`, which limits the maximum number of iterations in a single Pydantic AI agent loop to prevent it from running indefinitely. When running agents interactively, adding a limit is more of a curse than a blessing, but when not monitoring them at all, you want to avoid getting the agent stuck in a doom loop that just burns tokens — one of the failure modes Anthropic covers in its guide on [effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

Next stop: taking the laptop out of the loop via remote background agents on Modal.

## Running the headless harness remotely

The problem with running coding agents locally is that when you close your laptop lid, you are done. I’ve been trying to work around this issue with programs such as Amphetamine that hijack the sleeping processes of my Mac, but they don’t work properly. You always end up with your session stuck.

[![](https://substackcdn.com/image/fetch/$s_!UGNq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F85d91781-c24c-43b3-919e-7d409eda0941_640x668.png)](https://substackcdn.com/image/fetch/$s_!UGNq!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F85d91781-c24c-43b3-919e-7d409eda0941_640x668.png)

Instead of maintaining a server, we create a clear boundary between who triggers the harness and where it executes. Your laptop, a cron job, or a webhook only *launches* it, and [Modal](https://modal.com/?source=decodingai&campaign=harnesseng) *executes* in fire-and-forget containers with zero idle cost. Modal already served our models and sandboxes. Now it also hosts the harness under serverless functions.

[![The headless harness in the middle — a CLI, a cron and a webhook all start the same loop; the sandbox is optional.](https://substackcdn.com/image/fetch/$s_!9BWK!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8ff2b126-fc16-4e63-a738-1f713823a54c_1200x563.png "The headless harness in the middle — a CLI, a cron and a webhook all start the same loop; the sandbox is optional.")](https://substackcdn.com/image/fetch/$s_!9BWK!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8ff2b126-fc16-4e63-a738-1f713823a54c_1200x563.png)

*The remote system design of the headless harness that can be triggered via the local CLI, cron jobs or webhooks. All the options start the same headless harness while the agent loop runs its tool calls in an optional sandbox.*

Which means that now we have three ways to trigger the harness:

1. via `decode remote run` or `decode remote attempts` when we want to either manually trigger the harness or hook it into the CI/CD (or any other shell script)
2. a webhook POST that we can use from Slack, Discord or Telegram messages
3. a cron scheduler that we can connect to our Linear or Notion project manager to implement our tickets overnight for us to review them in the morning

All three are implemented as different entry points into the same Modal app:

[![](https://substackcdn.com/image/fetch/$s_!KX-K!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa0ba78b8-559c-467d-95a6-5bfb527c6d14_3032x798.png)](https://substackcdn.com/image/fetch/$s_!KX-K!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa0ba78b8-559c-467d-95a6-5bfb527c6d14_3032x798.png)

The headless harness per se runs within [a Modal app](https://modal.com/docs/guide/apps?source=decodingai&campaign=harnesseng) wrapped by one Python function that Modal runs in its own container on demand, each time it’s triggered. More exactly, it runs `decode run` as a subprocess, similar to what we’ve been running locally so far, inside a gVisor container (the user-space kernel Modal runs under every container).

Because of our modular design, we can hook the headless harness to a remote Modal sandbox that runs filesystem tools such as read, edit, write and bash. Passing `--sandbox-mode modal` clones `--repo` into the sandbox workspace runs the tools there and pushes a `decode/` branch to GitHub. Or, as seen in the image below, multiple branches if we choose to attempt multiple implementations of the same feature.

[![](https://substackcdn.com/image/fetch/$s_!orTq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F74a94e88-c98f-4dd3-8799-226596f2e19c_1354x326.png)](https://substackcdn.com/image/fetch/$s_!orTq!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F74a94e88-c98f-4dd3-8799-226596f2e19c_1354x326.png)

We deploy the Modal app defined in the code snippet below, via `decode remote deploy`, which builds a Debian image in code with all necessary dependencies and pushes it directly to Modal’s container registry.

In the `execute_run()` function, we mostly set up the environment, clone the repository if we’re not in a sandbox, and call `decode run <"goal ">` as a subprocess. That’s it. Modal mostly acts as a middleman between different ways to trigger our headless harness and where to execute it.

*From [src/decode/remote/app.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/remote/app.py) and [src/decode/remote/headless.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/remote/headless.py):*

```
IMAGE = build_image(extra_dirs=(REPO_CLONE_DIR,), extra_packages=WEB_PACKAGES)
app = modal.App("decode-headless")

@app.function(image=IMAGE, secrets=[modal.Secret.from_name("decode-headless")], timeout=3600)
def run_task(task: str, repo: str | None = None, sandbox_mode: str = "none",
             model: str | None = None, timeout_seconds: int = 1800, max_requests: int | None = None) -> dict:
    return execute_run(
	    task=task, 
	    repo=repo, 
	    sandbox_mode=sandbox_mode, 
	    model=model,
		timeout_seconds=timeout_seconds,
		max_requests=max_requests
		)

def execute_run(*, task, repo=None, sandbox_mode="none", model=None, timeout_seconds=1800, max_requests=None) -> dict:
    env = decode_run_env(os.environ, sandbox_mode=sandbox_mode)
    # inject env vars: SANDBOX_MODE, DECODE_ENV=prod, GITHUB_TOKEN, etc.
    
    if sandbox_mode == "none" and repo:
        clone_for_none_mode(repo, env)
        
    stdout, exit_code = stream_subprocess(
        decode_argv(
            task=task,
            sandbox_mode=sandbox_mode,
            repo=repo,
            model=model,
            max_requests=max_requests
        ),
        cwd=decode_cwd(sandbox_mode=sandbox_mode, repo=repo),
        env=env,
        timeout_seconds=timeout_seconds,
    ) # Run 'decode run "" ...' within a subprocess

    return build_result(sandbox_mode=sandbox_mode, repo=repo, exit_code=exit_code, stdout=stdout, log_text=read_child_log())
```

Next, we can interact with the deployed headless harness via `decode remote`, where we can start asking for specific goals via `decode remote run ""` or for multiple attemtps via `decode remote attemtps <"goal">`. Which under the hood will trigger the Modal `run_task()` serverless function once or multiple times in parallel.

In the image below, we can see how each remote attempt (3 in our use case) works in its own Modal container and optional sandbox:

[![](https://substackcdn.com/image/fetch/$s_!65Iw!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F08551dc2-edcc-45b8-b163-12e3b746c669_3048x1308.png)](https://substackcdn.com/image/fetch/$s_!65Iw!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F08551dc2-edcc-45b8-b163-12e3b746c669_3048x1308.png)

Each with its own branch and optional PR:

[![](https://substackcdn.com/image/fetch/$s_!orTq!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F74a94e88-c98f-4dd3-8799-226596f2e19c_1354x326.png)](https://substackcdn.com/image/fetch/$s_!orTq!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F74a94e88-c98f-4dd3-8799-226596f2e19c_1354x326.png)

The deployed Modal functions form [an autoscaling pool of containers](https://modal.com/docs/guide/scale?source=decodingai&campaign=harnesseng) that sits at zero. A client [looks up the Function by name](https://modal.com/docs/guide/trigger-deployed-functions?source=decodingai&campaign=harnesseng): `modal.Function.from_name("decode-headless", "run_task")`. It calls `.remote(...)` for a synchronous blocking call, or `.spawn(...)` for an async one.

Modal routes inputs to warm containers or boots new ones up to `max_containers`, automatically shutting down idle instances. The only latency in `modal` mode comes from [the started-versus-ready gap](https://modal.com/blog/unpacking-sandbox-startup-latency?source=decodingai&campaign=harnesseng) while the sandbox clones your repo and installs dependencies.

Using a similar strategy, we can implement the remaining two triggers. The **nightly cron** calls `run_task.local()` on [a schedule](https://modal.com/docs/guide/cron?source=decodingai&campaign=harnesseng) set by the `DECODE_NIGHTLY_CRON` env var.

For the **webhook**, we need to expose [a FastAPI endpoint](https://modal.com/docs/guide/webhooks?source=decodingai&campaign=harnesseng) with proxy auth (a key/secret header pair Modal checks at its edge before your code runs). This time, it spawns a `run_task` in the background as an async job and returns a call ID in milliseconds.

*From [src/decode/remote/app.py](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/blob/main/src/decode/remote/app.py):*

```
@app.function(image=IMAGE, secrets=[...], schedule=nightly_schedule(os.environ))
def nightly() -> dict:
    return run_task.local(**nightly_run_kwargs(os.environ))   # same container, same subprocess

@app.function(image=IMAGE)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def webhook(request: WebhookRequest) -> dict:
    call = run_task.spawn(**webhook_spawn_kwargs(request))    # start it, don't wait for it
    return webhook_response(call.object_id, request)          # the call id + where to watch
```

Below, you can see how the webhook triggered the `run_task` serverless function:

[![](https://substackcdn.com/image/fetch/$s_!FP-K!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F348bf7d9-ce20-4a91-8771-07e8db7563f2_3046x1252.png)](https://substackcdn.com/image/fetch/$s_!FP-K!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F348bf7d9-ce20-4a91-8771-07e8db7563f2_3046x1252.png)

Deploy once to publish `run_task`, `nightly`, and `webhook`:

```
uv run decode remote deploy
```

Fire a single synchronous run from your laptop:

```
uv run decode remote run "" --repo  --sandbox-mode modal
```

Launch N parallel attempts with `--detach` to exit immediately:

```
uv run decode remote attempts "" --repo  --attempts 3 --sandbox-mode modal --detach
```

Schedule a nightly cron via a UTC crontab. Without `DECODE_NIGHTLY_CRON` no schedule registers:

```
DECODE_NIGHTLY_CRON="0 2 * * *" \ 
DECODE_NIGHTLY_TASK="" \ 
DECODE_NIGHTLY_REPO= \
DECODE_NIGHTLY_SANDBOX_MODE=modal \
DECODE_NIGHTLY_MAX_REQUESTS=120 \
uv run decode remote deploy
```

Trigger the webhook over HTTP via authenticated POST:

```
curl -X POST "$WEBHOOK_URL" \
-H "Modal-Key: $MODAL_PROXY_TOKEN_ID" \
-H "Modal-Secret: $MODAL_PROXY_TOKEN_SECRET" \
-H 'content-type: application/json' \
-d '{"task": "…", "repo": "", "sandbox_mode": "modal", "max_requests": 60}'
```

Read every run’s answer and summary line, from anywhere:

```
uv run decode remote logs
```

Looking at the logs in the terminal can be super helpful for detecting build and runtime errors and warnings. But when we have to understand what’s going on inside the agent, a better way to look at its model and tool calls is to use an observability tool like [Opik](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul&utm_content=coding_agent_course):

[![](https://substackcdn.com/image/fetch/$s_!G71x!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fbdf79093-66fa-45a8-88c6-a7c8861c674d_1190x1668.png)](https://substackcdn.com/image/fetch/$s_!G71x!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fbdf79093-66fa-45a8-88c6-a7c8861c674d_1190x1668.png)

Which can quickly become super useful when running `decode remote attemps` and comparing their differences in costs (if using an API), latency and token usage:

[![](https://substackcdn.com/image/fetch/$s_!c4Ye!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff6c3205e-d445-4f88-9545-3ea19fafd825_2348x562.png)](https://substackcdn.com/image/fetch/$s_!c4Ye!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff6c3205e-d445-4f88-9545-3ea19fafd825_2348x562.png)

Because we deployed the whole coding agent to Modal (serving the LLM, the sandbox, and the harness), a pertinent question is whether it’s worth going full serverless versus choosing good old providers such as GCP or AWS.

As always, it depends.

## When should we go serverless?

First, **serverless simplifies infrastructure**: one command to deploy, automatic scale up and down, nothing billed while idle, and CPUs or GPUs one argument away.

Under [Modal](https://modal.com/?source=decodingai&campaign=harnesseng), you own no machines. On a hyperscaler like GCP or AWS, you maintain virtual machines plus managed services for scaling and monitoring. Bare-metal GPU clouds like RunPod and Lambda provide the cheapest hourly compute and full control, leaving every orchestrator and daemon for you to build.

In other words, if you choose an option other than serverless, you need to be prepared to invest time and resources in setting up and monitoring your infrastructure. For many small teams or early projects, that’s simply not worth it.

**Now what about pricing?** Isn’t [serverless](https://modal.com/blog/how-to-price-serverless?source=decodingai&campaign=harnesseng) a lot pricier than hyperscalers or bare metal?

Per H100-hour, on demand, at the time of writing:  
(That can serve a 7 B to 32B model at high throughput)

* [Modal](https://modal.com/pricing?source=decodingai&campaign=harnesseng) ≈ 3.95 (*serverless*)
* [RunPod](https://www.runpod.io/pricing) ≈ $3.49 (neocloud)
* [Lambda](https://lambda.ai/service/gpu-cloud) ≈ $3.99 (neocloud)
* [AWS p5.4xlarge](https://instances.vantage.sh/aws/ec2/p5.4xlarge) ≈ $6.88 on-demand, ≈ $2.63 spot (1×H100) (hyperscaler)

So, as you can see, only RunPod VMs are cheaper than serverless. Plus, with serverless, you pay only for what you use, as it automatically scales to 0 when idle (i.e., $0). The LLM endpoint, the remote sandboxes, the app itself. Everything. If your app mostly depends on bursty agent work, serverless fits like a glove.

On the other side of the spectrum, if you would need access only to interactive TUIs that run 24/7 by your team (hopefully!), you might want to consider other options.

As a small team, I usually start serverless and rent/buy GPUs only when I really need to invest in my own infrastructure.

## Running swarms of remote agents

Now, how does this design map to working on multiple coding projects, each with multiple tickets?

A background job can pull tickets from Linear, implement them overnight, and leave PRs waiting for your morning review. We can model this via the cron job or a [Linear agent](https://linear.app/developers/agents) and our webhook, which lists tickets tagged for the agent and passes along the ticket text, repo URL, and other metadata.

Modal spawns a dedicated container for each ticket. Each Decode session clones its repo into its own sandbox, implements the ticket, commits, pushes a `decode/` branch, and opens a PR, so you review finished work instead of watching agents run.

[![N projects, N tickets, one agent per ticket — every agent opens its own PR against its own repo.](https://substackcdn.com/image/fetch/$s_!o7Mz!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Feb782f29-d603-4cd5-8772-f9438087f714_1200x798.png "N projects, N tickets, one agent per ticket — every agent opens its own PR against its own repo.")](https://substackcdn.com/image/fetch/$s_!o7Mz!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Feb782f29-d603-4cd5-8772-f9438087f714_1200x798.png)

*Integrating the headless harness to pull and implement tickets from our Notion/Linear projects overnight.*

Each ticket session starts from scratch and is completely independent of the others. Ten tickets run in ten containers. It is important to model dependencies between tickets to know what to implement in parallel or sequentially.

[Ramp](https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal?source=decodingai&campaign=harnesseng) uses the same strategy at production scale with a routing queue and session locks. Review-ready PRs come out, and roughly half of Ramp’s merged PRs use this strategy. Which is huge for a fintech company that needs to be really careful about what code it pushes.

On top of running multiple parallel agents, you can take this step further and run multiple parallel subagents within a single harness session.

## One orchestrator, many GPU sandboxes

Let’s assume that we give a coding agent a task to fine-tune a Liquid LFM2.5 model.

It needs to run several fine-tuning experiments in parallel, push each to an experiment tracker, compare them, and let the next round optimize on the last until the target metric is reached. You fire one headless run on Modal, the **orchestrator**, with the task *“get eval accuracy above X on this dataset.”*

[![One orchestrator on Modal, N sandboxes, one experiment tracker — a loop that repeats with the best parameters.](https://substackcdn.com/image/fetch/$s_!Gd6u!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F95222bfb-fb1e-4117-b6e1-95009979c6d4_1200x669.png "One orchestrator on Modal, N sandboxes, one experiment tracker — a loop that repeats with the best parameters.")](https://substackcdn.com/image/fetch/$s_!Gd6u!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F95222bfb-fb1e-4117-b6e1-95009979c6d4_1200x669.png)

*Using an orchestrator agent and multiple subagents plugged into remote sandboxes to fine-tune LLMs.*

It plans a batch of experiments (learning rates, LoRA ranks, data mixes) and fans it out into multiple subagents. Each child’s tools run in its own Modal remote sandbox created with a GPU spec (eg `gpu="H200:4"`), so `bash` trains on an H200 while the orchestrator stays on a CPU container.

The orchestrator reads each run’s metrics, keeps the best configuration, plans the next batch, and stops when it meets the target or hits other thresholds, such as cost or max iterations. You wake up to a leaderboard and a winning checkpoint, not five terminals.

More on this in [Lesson 3](https://www.decodingai.com/p/run-coding-agents-safely) and [Lesson 5](https://www.decodingai.com/p/subagents-are-context-engineering).

## Next steps

Now that we’ve seen how to run swarms of agents in the cloud, it’s time to evaluate the coding agent and build the evals harness. In Lesson 7, we will leverage this infrastructure to run benchmarks, regression tests, and online evals at scale.

🧑‍💻 **Clone the [course repo](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course/tree/main)**, follow the **[deploy runbook](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course#-running-the-code)**(`running_the_code/04_deploy.md`), deploy the agent via **decode remote deploy once** and then put it to work.

Here is the course roadmap, lesson by lesson (see all in [GitHub](https://github.com/decodingai-magazine/building-a-coding-agent-from-scratch-course)):

1. [Building a Coding Agent From Scratch](https://www.decodingai.com/p/building-a-coding-agent-from-scratch-system-design)
2. [The Bare-Bones Coding Agent Loop](https://www.decodingai.com/p/the-coding-agent-loop)
3. [From a Raw Shell to a Sandboxed Coding Agent](https://www.decodingai.com/p/run-coding-agents-safely)
4. [Context Engineering for Coding Agents](https://www.decodingai.com/p/context-engineering-for-coding-agents)
5. [Subagents Are Context Engineering](https://www.decodingai.com/p/subagents-are-context-engineering)
6. **Swarm of Remote Agents** **←** ***You are here***
7. AI Evals Foundations: Benchmarks, Regression and Online ← *Available next week*
8. AI Evals on Steroids via Replays — links added as each lesson ships

*But here is what I’m wondering:*

> ***What would you give a coding agent to do overnight, without wasting your time and tokens?***

*Click the button below and tell me. I read every response.*

[Leave a comment](https://www.decodingai.com/p/coding-agents-in-remote-headless/comments)

---

*Enjoyed the article? The most sincere compliment is to restack this for your readers.*

[Share](https://www.decodingai.com/p/coding-agents-in-remote-headless?utm_source=substack&utm_medium=email&utm_content=share&action=share)

---

*Special thanks to **[Modal](https://modal.com?source=decodingai&campaign=harnesseng)**, **[Opik (by Comet)](https://www.comet.com/site/?utm_source=newsletter&utm_medium=partner&utm_campaign=paul&utm_content=coding_agent_course)**, and **[Kitaru (by ZenML)](https://www.zenml.io/product/kitaru?utm_source=decodingai&utm_medium=referral&utm_campaign=coding-agent-course&utm_content=brand)** for sponsoring this open-source course and keeping it free!*

[![](https://substackcdn.com/image/fetch/$s_!Uq-1!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F98999460-8389-40b0-9dda-73f934bbf55a_1200x400.png)](https://substackcdn.com/image/fetch/$s_!Uq-1!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F98999460-8389-40b0-9dda-73f934bbf55a_1200x400.png)

---
