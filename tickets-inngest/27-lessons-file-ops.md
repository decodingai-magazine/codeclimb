# 27: Lessons file: format, operations and gates

**What to build:** A scenario's `lessons.md` can be parsed into numbered bullets, written back in the one fixed layout, and changed by `add`, `edit` and `drop` operations that code applies, so an untouched lesson stays byte for byte. Every gate on what a coder would read is enforced, and rejected operations are reported with their reason. No model is involved here.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Lessons across nights", "Every number in one place"

**Blocked by:** 02 (Scenario contract: load, host commands, masking, scoring hashes, report flattening); 03 (Night config: parse, defaults, validation, night ids, results paths)

**Status:** ready-for-agent

- [ ] Parsing accepts a `# ` title, preamble paragraphs and `## ` sections holding only `- ` bullets with two-space continuation lines; anything else under a heading fails; writing wraps at 100 columns and leaves out empty sections; parse then write of a formatted file is the identity (unit tests, including the given scenarios' `lessons.md` where one exists)
- [ ] Operations: `add` (section, text), `edit` (id; new text, a move, or both), `drop` (id), each with a `reason`, at most one per bullet; every `edit` and `drop` is checked before the `add`s whatever the reply's order (unit tests)
- [ ] Reply reading: the object between the first `{` and the last `}`; a malformed op or one without `reason` is left out without failing the rest
- [ ] Gates, each unit-tested with accepting and rejecting cases: held-out names in a lesson or heading rejected and a reason masked (fake `scan`); the metric-value rule with the name exceptions (`jev-1.14`, `deepseek-v4.1-flash` pass; a decimal score and `12 %` fail); lesson ≤ 500 and heading ≤ 80 characters; at most 30 lessons; near-duplicates at ≥ 50% shared content words unless `distinct`; a heading the spec cites keeps at least one lesson; a new heading needs `new_section: true`
- [ ] The 200-line cap is detected, and prune operations are restricted to drops and to edits shorter than the lesson they replace, with bullets numbered again after the ops so far
- [ ] `changes.md` content is generated: each op beside the lesson it changes, rejected ops, prunes
- [ ] `npm run lessons -- format --config <yaml> [--check]` rewrites the scenario's file in the fixed layout, or with `--check` exits non-zero when it would change
