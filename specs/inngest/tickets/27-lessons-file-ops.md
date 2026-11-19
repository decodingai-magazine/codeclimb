# 27: Lessons file: operations, gates and format

**What to build:** The pure half of the memory across nights. A scenario's `lessons.md` changes only through small operations (add, edit, drop) that code applies, so untouched lessons stay byte for byte. Gates keep out held-out names, metric values, near-duplicates and overlong files. `npm run lessons -- format` puts the file in one fixed layout.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Lessons across nights), "CLI", "Scenario contract"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, report metrics, scoring hash); 03 (Night config, night ids and the runs folder)

**Status:** ready-for-agent

- [ ] Operations `add`, `edit` and `drop` apply to a lessons file; every lesson no operation touches stays byte for byte (unit tests, including on a copy of `graphrag`'s `lessons.md`)
- [ ] Gates, each with accepting and rejecting cases: held-out names (through the scenario's `scan`, faked in tests), metric values, near-duplicates of an existing lesson, a file that grows too long (unit tests)
- [ ] `npm run lessons -- format --config <yaml>` rewrites the scenario's lessons file in one fixed layout; with `--check` it changes nothing and exits non-zero when the file would change
- [ ] What a proposal changed and what the gates rejected can be written as `changes.md` (unit test)
