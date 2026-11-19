# 09: Coder experiment: from the prompt to one commit

**What to build:** One coder experiment runs end to end: a fresh sandbox holds the checkpoint and the bundle, a coder session works in it on the prompt the spec describes, and however the coder stops its partial work becomes exactly one commit in `experiments.git`, with the experiment's files on disk and the scenario's repository check and leak scan run on the host.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Coder; End of an experiment; Loop), "Architecture", "Files a night writes", "Ids and names", "Scenario contract"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, report metrics, scoring hash); 06 (Experiment repository: experiments.git, starter commit, experiment refs); 08 (Pi sessions with sandbox tools, and the mock models)

**Status:** ready-for-agent

- [ ] The coder session runs on `model` at `coder_thinking`, in a fresh sandbox `cc-<exp id>` holding the checkpoint (the last kept commit) in `/repo` and the bundle as `/spec`; the bundle is what the scenario's `bundle` command wrote, so no dev or test data, gold or evaluator reaches the coder
- [ ] The prompt carries the scenario's spec, the night so far, the metrics still short of their thresholds, the hypothesis (none in round 1, where the coder picks one), how the keep works, the time and budget it has, and the standard metrics the config tells the agents about; it asks for `/tmp/tasks.json`, `/tmp/notes.md`, `/tmp/train-score.json` when the bundle has `train/`, and a final message ending with `APPROACH: <one sentence>` (unit tests on the prompt builder)
- [ ] The coder stops as `done`, `timeout` (`timeouts.experiment_min`), `idle` (no session activity for longer than a limit the build chooses, longer while a tool runs), `budget` (`budget_usd.experiment`), `agent_error` (only a prompt call that threw), `credits` or `cancelled`; `code-state.json` is rewritten while the coder works, ends with its `stop`, and is never written again (unit tests with a fake session and clock)
- [ ] For every stop but `cancelled` the partial work is committed: whatever the coder committed itself is squashed into exactly one commit whose only parent is the commit the sandbox started from, at `refs/exp/<exp id>`. A cancelled experiment commits nothing
- [ ] `exps/<exp>/` holds `session/*.jsonl`, `code-state.json`, `tasks.json` and `train-score.json`; the coder's notes are kept for the note of ticket 13; nothing else is written under `exps/` but one folder per coder attempt
- [ ] The scenario's `check` reads the commit on the host and is saved as `exps/<exp>/check.json`; its `scan` counts the held-out names in the commit's diff for the keep rule
- [ ] Docker test with mock models on `datenorm`: the experiment ends with `stop: done`, `refs/exp/<exp id>` exists and its diff against the starter adds `MOCK.md`, and `exps/<exp>/` holds `code-state.json`, `tasks.json`, `train-score.json` and a session file
