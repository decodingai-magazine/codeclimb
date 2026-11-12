# 11: Coder prompt

**What to build:** A pure function from an experiment's inputs (the bundle's spec files, the config, the checkpoint's metrics, the optional direction, trajectory text, failures, hypothesis, the time and budget available, whether it is a repair) to the coder's user prompt, with the sections in the spec's order and every rule the spec says the prompt must carry.

**Spec sections:**
- "Coder" > "Prompt": the section table, the rules list, the task file format
- "Evaluator" > "Standard metrics": which optimized metrics are named to the coder
- "Coder" > "Send-backs, reserve and wrap-up": only the rule that no prompt text contains "You stopped with" or "change no more code"

**Not yet:** building the trajectory (ticket 16), which arrives here as text; the send-back and wrap-up messages (ticket 18); the short restart prompt after a crash or a pause (tickets 27, 29).

**Blocked by:** 02 (Scenario and night config loading); 05 (Weighted score, keep rule, noise margin and stop checks)

**Status:** ready-for-agent

- [ ] Sections appear in the table's order and each only when it has content; the task file (`SPEC.md` or `task.md`) comes first among the spec's `.md` files
- [ ] `<targets>` lists threshold metrics the checkpoint has not reached, largest weighted shortfall first, each with dev value, threshold and weight
- [ ] `<met>` and `<fragile>` split reached metrics by their `ci95_half`; a `<x>.mean` metric takes its half-width from `<x>.ci95_half`; a metric with none counts as met
- [ ] An unscored starter checkpoint lists every threshold metric as a target
- [ ] A metered config adds the endpoint variables, the models, the experiment's budget, the 402 and the replay rule; an unmetered config has none of it
- [ ] A standard metric that is not optimized stays out unless a gate or threshold names it
- [ ] The workflow has four steps for an experiment and the review step only for a repair; a repair prompt says to fix the failure and nothing else and that there is no second repair
- [ ] The intro names `/spec/spec` as the copy of the spec and `/spec/train` as the only labeled data; `<hypothesis>` holds the reviewer's hypothesis when the round has one
- [ ] Every rule of the spec's list of rules the prompt must carry is in the prompt, each checked by a unit test
- [ ] The prompt names the minutes available and the round's end time, and asks for the final `APPROACH:` line
- [ ] The prompt contains neither "You stopped with" nor "change no more code"
- [ ] Unit tests cover the above; `npm run typecheck` and `npm test` pass
