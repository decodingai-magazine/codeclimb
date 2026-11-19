# 29: Lessons file, operations and gates

**What to build:** The scenario's `lessons.md` is the only memory between nights. This ticket is its file format and the code that applies a proposal to it: `add`, `edit` and `drop` operations, applied by code so that untouched lessons stay byte for byte, behind gates. A proposal is written to `lessons/<night>-r<N>/` as `lessons.md`, `changes.md` and `proposal.json`.

**Spec sections:**
- "Features": **Lessons across nights** (the operations, "untouched lessons stay byte for byte", the gates)
- "Interfaces the build must honour" > "Files a night writes": the `lessons/<night>-r<N>/` row; the `lessons.md` format
- "Interfaces the build must honour" > "Scenario contract": `lessons`

**Not yet:** the distillation that proposes the operations, when it runs, and the `lessons` command (ticket 30).

**Blocked by:** 03 (Host commands, the bundle and masking)

**Status:** ready-for-agent

- [ ] `lessons.md` is parsed and written as a `# ` title, a preamble, and `## ` sections holding only `- ` bullets, a bullet going on over lines indented two spaces; a file that breaks the format is reported, not rewritten
- [ ] `add`, `edit` and `drop` apply to named bullets of named sections; every lesson the operations do not touch stays byte for byte (unit test on a real `lessons.md` of `scenarios/`)
- [ ] An operation is refused by a gate when it holds a held-out name (the scenario's scan), a metric value, more text than the build's size bound, or a near-duplicate of an existing lesson; a refused operation is recorded with its gate
- [ ] A proposal directory holds `lessons.md` (the file after the accepted operations), `changes.md` (what changed and what was refused, readable by a person) and `proposal.json` (`ops`, the base file's sha256, the cost, `applied`)
- [ ] An empty `ops` list gives a proposal with an unchanged `lessons.md`
- [ ] `npm run typecheck` and `npm test` pass
