# 03: Host commands, placeholders and masking

**What to build:** The build can run any command a `scenario.yaml` declares for the host: fill its placeholders, run it in the scenario directory under the spec's limits, and return its result or a failure with a safe tail of its output. On top of that: build a night's bundle, run `check` on a checkout of a commit's files, run `scan` on a text, and mask found names.

**Spec sections:**
- "Scenario contract" > "How a scenario is loaded": the bullets on placeholders, masking and host commands; the `bundle`, `check` and `scan` rows
- "Experiment lifecycle" > "Init": the bundle rebuild (move `history/` aside, delete, run, require `spec/`, move back)
- "Every number in one place": evaluator rows "host command timeout / output" and "error tail"

**Not yet:** calling these from a night (tickets 13, 15, 19); `check.json` (ticket 19). The host command takes an abort signal as a parameter; the step wrapper that supplies it is ticket 09.

**Blocked by:** 02 (Scenario and night config loading)

**Status:** ready-for-agent

- [ ] Placeholder values are shell-quoted; an unknown placeholder is an error; every host-side value is an absolute path
- [ ] A host command runs through `bash -c` in the scenario directory with a 30-minute timeout and a 64 MiB output limit, and stops when its abort signal fires
- [ ] A failed command throws with the last 2,000 characters of output, cut at a line start
- [ ] The bundle build on the given `datenorm` scenario writes a folder holding `spec/`; a second build over an existing bundle keeps an existing `history/` untouched; a command that writes no `spec/` fails
- [ ] `check` returns `errors` and `notes` from the report it wrote; `scan` returns `found`; without a `scan` command, or for empty text, nothing is found
- [ ] Masking replaces every found name by `[hidden]`, in any letter case, the longest name first
- [ ] Unit tests cover the above, using temporary scenario directories for the failure cases; `npm run typecheck` and `npm test` pass
