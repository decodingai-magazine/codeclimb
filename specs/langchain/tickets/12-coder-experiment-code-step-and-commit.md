# 12: Coder experiment: code step and commit

**What to build:** One experiment's coder, as a step body: create the sandbox `cc-<exp id>` from the parent commit with the bundle as `/spec`, run the coder's Pi session on the prompt, stop it by the spec's rules, read its notes and files, commit `/repo` as one commit on the parent, and land that commit in `experiments.git` as `refs/exp/<exp id>`. It returns a small result (stop, SHA, unchanged, hypothesis, cost, tokens, timings) and leaves the experiment's files under `exps/<exp>/`.

**Spec sections:**
- "Coder" > "End of an experiment": the stop table and every bullet
- "Coder": intro and session storage
- "Coder" > "Send-backs, reserve and wrap-up": only the last bullet (the clock starts before the sandbox is created)
- "Data and files" > "Files a night writes": the `exps/<exp>/` row
- "Every number in one place": coder rows "idle watchdog", "notes", "`APPROACH`; unchanged closing message"

**Not yet:** send-backs and the wrap-up (ticket 18): the coder gets one prompt and stops; the dev ledger and meter variables (ticket 22), so `devUsd` is 0; a rerun that finds a state file (ticket 27) beyond returning a stored `code-result.json`; the `credits` stop and `paused` state (ticket 29).

**Blocked by:** 03 (Host commands, placeholders and masking); 07 (Experiment repository); 09 (Step wrapper, abort signal and live registry); 10 (Pi sessions: mock models and sandbox tools); 11 (Coder prompt)

**Status:** ready-for-agent

- [ ] Stops `done`, `timeout`, `idle`, `budget`, `agent_error` and `cancelled` behave as the table says; every stop but `cancelled` commits; `cancelled` destroys the sandbox and fails the step
- [ ] The idle check runs every 30 s with the 10-minute and 25-minute limits; the budget check runs after each assistant message
- [ ] Before the commit, `/tmp/notes.md` (cut to 3,000 characters), `/tmp/tasks.json` and `/tmp/train-score.json` are read; the last two are saved under `exps/<exp>/`
- [ ] The commit follows the spec's order in the sandbox and squashes anything the coder committed; its message is `<exp id>: <hypothesis>` and its author `codeclimb <codeclimb@localhost>`; an empty commit is allowed
- [ ] The recorded hypothesis is the given one, else the last `APPROACH` line (cleaned, 300 characters), else the closing message's last non-empty line, else `(no summary)`
- [ ] A commit whose tree equals its parent's is reported `unchanged` with the closing message cut to 1,000 characters, or `(no closing message)`
- [ ] `code-state.json` is rewritten on every assistant message with the spec's keys and gets `finishedAt` and `stop` at the end; `code-result.json` is written before the finished state; a rerun that finds both returns the stored result without coding
- [ ] The sandbox is destroyed when the step ends; the result carries `tCode` and `tProvision`
- [ ] Integration test with the mock coder on Docker and the `datenorm` starter: `refs/exp/<exp id>` exists, its diff against the starter adds `MOCK.md`, `code-state.json` has `stop: done`, `exps/<exp>/session/` holds a session file, `tasks.json` and `train-score.json` exist, no container is left
- [ ] `npm run typecheck` and `npm test` pass
