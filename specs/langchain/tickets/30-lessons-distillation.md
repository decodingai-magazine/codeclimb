# 30: Lessons distillation

**What to build:** When a night ends or is stopped, a distillation reads its new notes and reviews (never test), asks a Pi session with no tools for add, edit and drop operations on the scenario's `lessons.md`, and writes the proposal to disk. In `apply` mode it also updates the scenario's file, never for a mock night and never as a commit. One distillation runs at a time per scenario. `npm run lessons -- distill|apply|format` does the same by hand.

**Spec sections:**
- "Features": **Lessons across nights**
- "Architecture": the data flow of a night ("the lessons distillation starts"); isolation invariant "nothing from test reaches a coder, the reviewer or a lesson"
- "Interfaces the build must honour" > "CLI": the `lessons` row
- "Interfaces the build must honour" > "Night config": `lessons`
- "Interfaces the build must honour" > "Mock mode": the lessons row; "lessons are never applied"
- "Runtime and tools": "lessons runs for one scenario never overlap"
- "Numbers": proposal on disk after `done` within 1 min

**Not yet:** nothing.

**Blocked by:** 21 (Gate: nights 1 to 3 as one repeatable check); 22 (Stop command and cleanup: night 4 passes); 29 (Lessons file, operations and gates)

**Status:** ready-for-agent

- [ ] For a scenario that declares `lessons` and a night whose `lessons` is not `off`, a distillation starts after `done.json` and after a `stop.json`, and the proposal is on disk under `lessons/<night>-r<last round>/` within a minute
- [ ] It reads the night's notes and reviews and nothing from a test evaluation (test that a test-only string never reaches the prompt)
- [ ] `propose` writes the proposal only; `apply` also writes the scenario's `lessons.md` and marks the proposal applied; neither makes a git commit
- [ ] A mock night's proposal is never applied, whatever the config says
- [ ] Two distillations for the same scenario never overlap (test with two nights of one scenario ending together)
- [ ] A failed distillation leaves the night's `done.json` or `stop.json` as it was
- [ ] `lessons distill` writes a proposal for a named night, `lessons apply` applies a written proposal, and `lessons format` rewrites a `lessons.md` into the canonical format
- [ ] With a temporary `datenorm` copy that declares lessons (outside `scenarios/`), a mock night ends with `lessons.md`, `changes.md` and `proposal.json` holding an empty `ops` list, not applied, and the copy's `lessons.md` unchanged
- [ ] The gate of ticket 21 still passes
- [ ] `npm run typecheck` and `npm test` pass
