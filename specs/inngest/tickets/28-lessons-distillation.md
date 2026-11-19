# 28: Lessons distillation: what a night learned reaches the next night

**What to build:** A night's notes die with it; the scenario's `lessons.md`, part of every bundle, is the only memory between nights. After a night ends, a model proposes operations on that file from the night's notes and reviews, the gates of ticket 27 filter them, and the proposal is written to the results directory and, when the mode says so, applied. One distillation at a time per scenario; a mock night proposes and never applies.

**Spec sections** (`specs/inngest/spec.md`): "Features" (Lessons across nights; Mock mode), "Architecture", "Night config", "CLI", "Files a night writes", "Mock mode", "Runtime and tools"

**Blocked by:** 21 (Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes); 27 (Lessons file: operations, gates and format)

**Status:** ready-for-agent

- [ ] After a night ends, a distillation runs when `lessons` is not `off` and the scenario declares lessons
- [ ] The model reads the night's notes and reviews and the current `lessons.md`; nothing from test reaches it (unit test on the input builder)
- [ ] Output under `<results dir>/lessons/<night>-r<N>/`: `lessons.md`, `changes.md` and `proposal.json` (`ops`; `applied: true` only once applied)
- [ ] `lessons: propose` writes the proposal only; `apply` also applies it to the scenario's `lessons.md`; a mock night proposes and never applies (unit tests)
- [ ] At most one distillation runs at a time per scenario
- [ ] `npm run lessons -- distill --config … --night ID [--apply]` and `npm run lessons -- apply --config … --night ID` work by hand
- [ ] `night.json`'s `lessons_sha256` records the lessons file the night started with
- [ ] End to end on a mock night, with a test-only copy of `datenorm` that declares a lessons file and its config: within a minute of `done`, `lessons/<id>-r<last round>/` holds the three files, the proposal has an empty `ops` list and is not marked applied, and the copy's lessons file is unchanged
- [ ] Nights 1 to 3 still pass the check of ticket 20
