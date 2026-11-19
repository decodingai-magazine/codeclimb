# 03: Host commands, the bundle and masking

**What to build:** CodeClimb runs a scenario's host commands and never reads its data. A host command runs through `bash -c` in the scenario directory with its placeholders filled in; the `bundle` command writes the coder's bundle; `check` and `scan` write their reports; masking turns every held-out name a scan found into `[hidden]`.

**Spec sections:**
- "Interfaces the build must honour" > "Scenario contract": "CodeClimb never reads a scenario's data"; the `bundle`, `check`, `scan` rows; the bullets on host commands, `{split}` and masking
- "Architecture": isolation invariants ("only train reaches a coder"; "everything a coder reads that came from the evaluation side is scanned for held-out names first")
- "Interfaces the build must honour" > "Files a night writes": `nights/<id>/bundle/`

**Not yet:** running `check` and `scan` on commits and reviews (tickets 14, 16); the bundle's `history/` (ticket 13).

**Blocked by:** 02 (Night config and scenario loading)

**Status:** ready-for-agent

- [ ] A host command runs through `bash -c` with the scenario directory as its working directory; every placeholder value is absolute and shell-quoted, so a path with spaces or quotes reaches the command intact (unit test); an unknown placeholder is an error before anything runs
- [ ] A host command's exit status, stdout and stderr are kept; a non-zero exit is a failure the caller sees
- [ ] `{split}` is only ever `dev` or `test`; asking a host command for `train` is an error
- [ ] The bundle is built by the scenario's `bundle` command into `nights/<id>/bundle/`; a bundle without `spec/` is an error; a `train/` in it switches the train measurement on, and its absence switches it off
- [ ] `check` runs on a commit's files in `{repo}` and its `{report}` is read as `errors` and `notes`; `scan` runs on `{text}` and its `{report}` is read as `found`; a scenario without `check` or `scan` skips them
- [ ] Masking replaces every found name with `[hidden]` in any letter case, longest name first, so a name inside a longer one is masked as the longer one (unit tests)
- [ ] The bundles of `datenorm` and `capitals` build and hold `spec/` (test); `graphrag`'s host commands, which need `uv` on the Agent Server's side, are proven in ticket 31
- [ ] `npm run typecheck` and `npm test` pass
