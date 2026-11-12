# CodeClimb benchmark

Measures how well a coding agent builds CodeClimb from a build spec, on Inngest and on LangChain, and what each kind of starting context adds. CodeClimb's own words (night, round, experiment, evaluation) keep the meaning the build specs give them; where one collides with a word below, the entry says so.

## Language

### What is built

**Stack**:
One of the two ecosystems CodeClimb is built on: Inngest or LangChain.
_Avoid_: ecosystem, framework, platform

**Build spec**:
The document that states everything needed to build CodeClimb on one stack. It is the contract a build is graded against.
_Avoid_: spec (bare), PRD

**Build ticket**:
One unit of work cut from a build spec, with the build tickets that block it. A stack's build tickets form its pile.
_Avoid_: issue, task, ticket (bare)

**Build phase**:
A group of consecutive build tickets in a pile.
_Avoid_: phase (bare), milestone

**Given inputs**:
The files a build starts from and never changes: the scenarios, the night configs and the sandbox image definitions.
_Avoid_: scaffold, fixtures

**Build**:
The application a harness produces in one trial.
_Avoid_: implementation, solution

**Reference build**:
A build made outside the benchmark and known to work, used only to prove the verifier before any trial is graded.
_Avoid_: oracle, golden solution

### What runs

**Benchmark**:
The tasks, the verifier and the job definitions that measure harnesses building CodeClimb.
_Avoid_: eval, layer 2, System 3

**Benchmark ticket**:
One unit of work on the benchmark itself.
_Avoid_: harness ticket, build ticket, ticket (bare)

**Harness**:
The coding agent under test, such as Claude Code or Codex.
_Avoid_: agent (CodeClimb's coder is one too), Harbor

**Harbor**:
The tool that runs trials.
_Avoid_: harness, runner

**Trial**:
One harness building CodeClimb once, from a clean start, with no human input.
_Avoid_: run, attempt, experiment (a CodeClimb word for a different thing)

**Arm**:
The extra context a harness starts a trial with.
_Avoid_: variant, condition

**Workflow**:
How a harness is told to proceed through a trial: from the build spec alone, or build ticket by build ticket.
_Avoid_: mode, strategy

**Phase**:
One stage of running the benchmark, each with its own stop rule.
_Avoid_: build phase, step

### What is measured

**Verifier**:
What grades a build after a trial, on a clean copy and out of the harness's reach.
_Avoid_: tests, grader, evaluator (a CodeClimb word for a different thing)

**Reward**:
The fraction of the verifier's checks a build passes.
_Avoid_: score, accuracy

**Stack comparison**:
The reading of trial results across the two stacks, on the checks both stacks share.
_Avoid_: night comparison
