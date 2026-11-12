# 32: Lessons file, operations and gates

**What to build:** The pure half of the memory across nights. Given a `lessons.md`, a model's reply holding operations, a `scan` function and the spec text, the build parses the file, applies the accepted `add`, `edit` and `drop` operations so untouched lessons stay byte for byte, rejects what a gate forbids, and renders the new file, `changes.md` and `proposal.json`.

**Spec sections:**
- "Memory within and across nights" > "Lessons across nights": the bullets on the file format, the operations, the gates, reading the reply, the order of checks, the rewrite, the prune rounds and the output files
- "Every number in one place": the lessons rows

**Not yet:** calling a model, the `lessons` graph, when a night is distilled, the `lessons` command (ticket 33). The model is a function parameter here.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The parser accepts a `# ` title, preamble paragraphs and `## ` sections holding only `- ` bullets with two-space continuation lines; anything else under a heading fails
- [ ] The writer uses one layout: wrapped at 100 columns, empty sections left out; formatting a formatted file changes nothing
- [ ] Bullets are numbered for the model; `edit` and `drop` address a bullet by id; at most one op per bullet; an op that is malformed or has no `reason` is left out without failing the rest
- [ ] Gates, each with a test: a held-out name in a lesson or heading (rejected) or in a reason (masked); a metric value by the spec's number rule, including the cases that do not count (`jev-1.14`, `deepseek-v4.1-flash`); lesson over 500 characters; heading over 80; an `add` to a file holding 30 lessons; a near-duplicate `add` at 50% overlap unless marked `distinct`; a heading the spec cites losing its last lesson; a new heading without `new_section: true`
- [ ] Every `edit` and `drop` is checked before the `add`s, whatever their order in the reply
- [ ] Rejected ops get one rewrite: the corrected list replaces the first and is checked against the same file; an unparsable rewrite keeps the first list's accepted ops; ops rejected twice are listed in `changes.md`
- [ ] Over 200 lines: up to 2 prune rounds of drops and shortening edits, with bullets renumbered; a proposal still over is marked never to be applied
- [ ] `proposal.json` holds the ops, the base sha256, the cost and `applied`
- [ ] Unit tests cover the above; the given scenarios' `lessons.md` files, where a scenario declares one, parse and reformat without change; `npm run typecheck` and `npm test` pass
