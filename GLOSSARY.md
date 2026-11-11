# CodeClimb

An optimization loop where a coding agent rewrites a program in a sandbox, round after round, until the program meets evaluation thresholds. Where a platform uses the same word for a different thing, the CodeClimb word stays bare and the platform's word gets a prefix.

## Language

### The loop

**Night**:
One optimization of one program on one scenario. A night keeps its id when it is continued.

**Variation**:
One start or one continue of a night. Each variation has its own deadline, its own token and plateau counters and its own test evaluation.
_Avoid_: run, leg, branch

**Round**:
One iteration of a night: one experiment, started from the checkpoint.

**Experiment**:
One attempt to improve the program in a round: the coder's change, its evaluation and its review, ending kept or reverted.
_Avoid_: child, child run, trial, LangSmith experiment (a different thing)

**Repair**:
The second experiment of a round, which only fixes the failure of the first.
_Avoid_: attempt, retry

**Evaluation**:
The scoring of one commit by the scenario's evaluators.
_Avoid_: child, child run

**Checkpoint**:
The last kept commit of a night, with the dev metrics of its own evaluation. Every round starts from it.
_Avoid_: graph checkpoint (a different thing), savepoint

**Savepoint**:
A commit the coder makes in its sandbox while it works, before the experiment is evaluated.
_Avoid_: checkpoint

**Task**:
One item of the coder's plan for an experiment.
_Avoid_: step

### Stopping and resuming

**Soft stop**:
The end of a night by one of its own rules (thresholds, rounds, deadline, budget, tokens, plateau, outage). The night still scores the test set.
_Avoid_: stop

**Hard stop**:
The end of a night from outside its rules: the operator, a failure, a cancel or a timeout. The night gets no test score.
_Avoid_: stop, cancel

**Credit stop**:
A report from the coder, the reviewer or the program that a model ran out of credits. It pauses the night.
_Avoid_: stop

**Stop operation**:
The one cleanup every hard stop goes through.

**Pause**:
A night waiting for credits, with no sandbox running.

**Resume**:
The operator's command that ends a pause.
_Avoid_: continue (that starts a new variation)

**Timer**:
A stop scheduled for later: it ends a pause after 3 days or a variation after 4, and does nothing if that pause or variation has already ended.

**Crash resume**:
The Agent Server running again a server run that a crash cut off.
_Avoid_: resume

**Session resume**:
The coder carrying on its agent session after a pause or a crash.
_Avoid_: resume

### The platform

**Step**:
A unit of a night's work whose result is saved once and reused when the night is replayed.
_Avoid_: task (`task()` names the LangGraph API only)

**Attempt**:
One try of a step. A step that fails is tried again as a new attempt.
_Avoid_: repair, server-run attempt (the server's own tries of a whole server run)

**Graph checkpoint**:
The state LangGraph saves for a thread.
_Avoid_: checkpoint

**Server run**:
One run of a graph on the Agent Server, on a thread.
_Avoid_: run

**Trace run**:
One node of a LangSmith trace.
_Avoid_: run, span

**LangSmith experiment**:
LangSmith's run of an application over a dataset. CodeClimb does not use it.
_Avoid_: experiment

**Agent Server**:
The process that runs the graphs and, inside them, the agent sessions. Here it is LangGraph's dev server on the operator's machine, the only mode.
_Avoid_: the worker, prod, cloud

**Worker API**:
The HTTP API the app uses to read nights and to stop, resume, continue and export them. A proper name: no other component is called "worker".

**Backend**:
The provider that runs the sandboxes. This build has one: Docker on the operator's machine.
_Avoid_: mode, environment
