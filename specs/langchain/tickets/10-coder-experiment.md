# 10: Coder experiment

**What to build:** One experiment, end to end, outside the night: a fresh sandbox holds the checkpoint in `/repo` and the bundle in `/spec`; a Pi coder session gets its prompt and works through the sandbox tools; whatever it leaves becomes exactly one commit on the checkpoint in `experiments.git`; its state files are saved under `exps/<exp>/`; the sandbox is removed.

**Spec sections:**
- "Features": **Coder**
- "Architecture": the data flow of an experiment
- "Interfaces the build must honour" > "Files a night writes": the `exps/<exp>/` row, `code-state.json`, the coder files in the sandbox
- "Interfaces the build must honour" > "Stops": an experiment's `stop` in `code-state.json`
- "Interfaces the build must honour" > "Ids": experiment ids; the coder's sandbox `cc-<exp id>`
- "Interfaces the build must honour" > "Night config": `standard_metrics`, `timeouts.experiment_min`

**Not yet:** send-backs and the wrap-up (ticket 15); the check and scan (ticket 16); the trajectory, notes and history in the prompt (ticket 13); the dev ledger and budget (ticket 18); credit stops (ticket 26); session resume after a crash (ticket 24); the repair variant of the prompt (ticket 27).

**Blocked by:** 03 (Host commands, the bundle and masking); 05 (Decisions: weighted score, keep rule, noise margin and stop checks); 07 (Experiment repository); 09 (Pi sessions on mock models)

**Status:** ready-for-agent

- [ ] The prompt gives the coder the scenario's spec, the night so far, the threshold targets the checkpoint is still short of, the hypothesis (none in round 1: the coder picks its own), how the keep works, the standard metrics the config tells it to watch (`standard_metrics`: `latency` and `cost` on or off, `latency_metric`, `cost_metric`, `min_efficiency_gain`), and its time and budget; it asks for a plan in `/tmp/tasks.json`, notes for the next coder in `/tmp/notes.md`, a train measurement before and after in `/tmp/train-score.json` when the bundle has `train/`, and a final `APPROACH` line
- [ ] The coder's sandbox is `cc-<exp id>`, created from the checkpoint; it is removed when the experiment ends
- [ ] The experiment ends when the coder is done, on its time cap, when idle, on an infrastructure error or when cancelled; a failed model call is not an infrastructure error; every end but a cancel commits what the coder left
- [ ] The commit is exactly one commit on the checkpoint at `refs/exp/<exp id>`; files the coder left unchanged give an unchanged result, decided `no code change` later
- [ ] `exps/<exp>/` holds `session/` with Pi's session file, `code-state.json` (progress, spend, timings and, at the end, `stop`), `tasks.json` and `train-score.json` copied from the sandbox; `code-state.json` is rewritten as the coder works and not touched again once the coder finished
- [ ] `stop` is `done` when the coder finished; other values name the cap, idle, error or cancel that ended it
- [ ] A Docker test runs one mock experiment on `datenorm`: the commit's diff adds `MOCK.md`, `stop` is `done`, the session file exists, and no `cc-` container is left
- [ ] `npm run typecheck` and `npm test` pass
