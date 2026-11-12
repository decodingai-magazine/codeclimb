# 09: Coder experiment: from the prompt to one commit

**What to build:** Given a checkpoint commit, a bundle and a night config, a coder experiment creates its sandbox, builds the prompt, drives one Pi session until an end-of-experiment stop, reads the coder's files out of the sandbox, commits `/repo` as one commit on the parent, and then runs the scenario's `check` and leak `scan` on the host. This is a framework-free step body: no durable runtime yet, and no send-backs (ticket 14), crash resume (ticket 22) or web research (ticket 39).

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Coder", "Prompt", "End of an experiment", "Round loop", "Ids", "Files a night writes"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, scoring hashes, report flattening); 06 (Experiment repository: experiments.git, starter commit, refs, git bundles); 08 (Pi sessions with sandbox tools, mock models, the model check and credit detection)

**Status:** ready-for-agent

- [ ] The prompt has the sections of "Prompt" in order, each only when it has content, with `<targets>`, `<met>` and `<fragile>` computed from the checkpoint's metrics and `ci95_half`, and carries every rule of the list; a repair prompt has the review step only (unit tests on the builder, including largest weighted shortfall first)
- [ ] A unit test over all coder prompt text proves the literal strings `You stopped with` and `change no more code` appear nowhere in it
- [ ] Stops `done`, `timeout`, `idle`, `budget`, `agent_error`, `credits`, `cancelled` are detected as the table states (timer abort, the 10 / 25 minute watchdog checked every 30 s, the budget check after each assistant message); every stop but `cancelled` commits, `cancelled` destroys the sandbox and fails (unit tests with a fake session and clock)
- [ ] The experiment's clock starts before the sandbox is created
- [ ] Before the commit the worker saves `/tmp/notes.md` (cut to 3,000 characters), `tasks.json` and `train-score.json` under `exps/<exp>/`; the session file is under `exps/<exp>/session/`; `code-state.json` is rewritten on every assistant message with the keys the spec lists and ends with `finishedAt` and `stop`
- [ ] The commit follows the order in "End of an experiment": one commit on the parent whatever the coder committed, `.gitignore` applied, author `codeclimb <codeclimb@localhost>`, message `<exp id>: <hypothesis>`, imported as `refs/exp/<exp>`
- [ ] The recorded hypothesis follows the rule (the reviewer's, else the last `APPROACH` line cleaned and cut to 300 characters, else the last non-empty line, else `(no summary)`); an unchanged commit keeps the closing message cut to 1,000 characters (unit tests)
- [ ] `check` runs on a temporary checkout and is saved as `exps/<exp>/check.json`; `scan` runs on the lines the commit adds; both are skipped with no commit, on a credit stop, or when files are unchanged
- [ ] Docker test with mock models on `datenorm`: the experiment ends with `stop: done`, `refs/exp/<exp>` exists, its diff against the starter adds `MOCK.md`, and `exps/<exp>/` holds `code-state.json`, `tasks.json`, `train-score.json` and a session file
