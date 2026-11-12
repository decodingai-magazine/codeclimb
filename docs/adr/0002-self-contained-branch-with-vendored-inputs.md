# The benchmark branch is self-contained

Every file a trial or the verifier needs is a file on the `benchmark` branch: the build specs, the piles of build tickets, and the given inputs (`scenarios/`, `configs/`, the sandbox Dockerfiles), copied once from the `langchain` branch. No task image is built from a `git archive` of another branch, and no CodeClimb build is ever committed here: builds exist only as trial artifacts. We chose this so that a change on `main` or `langchain` cannot silently change what a harness is given or how it is graded, and so both stacks are scored on byte-identical scenarios and configs.

## Considered options

- **Build each task image from the stack's own branch** (`git archive langchain`, a new `inngest-scaffold` branch). Rejected: `langchain` became a full build, so archiving it would hand the harness the answer, and two branches' given inputs had already drifted apart (budgets, missing end-to-end configs).

## Consequences

- The two stacks' configs are byte-identical: a config's `results_path` is relative to the stack's runs folder (`runs-inngest/`, `runs-langchain/`), whose name each build spec fixes.
- The reference builds stay on their own branches and are named here only by commit SHA. When a build spec gains a check, the reference must be patched on its branch and re-pinned, or the check is dropped on both stacks.
- A change to a given input on `langchain` does not reach the benchmark until it is copied here.
