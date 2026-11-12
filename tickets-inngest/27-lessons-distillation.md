# 27: Lessons distillation: what a night learned reaches the next night

**What to build:** A finished or stopped night sends the lessons event; `distill-lessons`, one at a time per scenario, reads the rounds past the last applied proposal, asks the lessons model for operations, runs the gates with one rewrite and up to two prune rounds, and writes the proposal folder. With `lessons: apply` it also writes the scenario's `lessons.md`. The same can be done by hand from the command line.

**Spec sections** (`docs/codeclimb-spec-inngest.md`): "Lessons across nights", "Events", "Cleanup", "Durable runtime on Inngest", "Mock mode", "Files a night writes", "Known gaps"

**Blocked by:** 21 (Done signal: both mock nights pass the end-to-end checks); 26 (Lessons file: format, operations and gates)

**Status:** ready-for-agent

- [ ] `codeclimb/night.finished` is sent by the night at its end (event id `lessons-<night>-r<round>`) and by the stop cleanup for a night that didn't finish (`lessons-<night>-stop`, config read from `night.json`), only when the mode is not `off` and the scenario declares lessons
- [ ] `distill-lessons` has 2 retries and a concurrency of 1 per scenario; a credit error fails it and the retries run it again
- [ ] A night is distilled when it has notes or reviews past its newest applied proposal, and skipped when a proposal folder for its last such round exists (unit tests on fabricated folders)
- [ ] The model input holds only notes and reviews (feedback, hypothesis) of those rounds, the spec without `lessons.md`, and `lessons.md` with numbered bullets; never `done.json`, a test evaluation or a review prompt (unit test asserting the absence)
- [ ] The session runs on the reviewer's model and effort, in memory with no tools; one retry when nothing parses; rejected ops get one rewrite of the whole list checked against the same file, an unparsable rewrite keeps the first list's accepted ops, ops rejected twice go to `changes.md`; over 200 lines there are up to 2 prune rounds and a proposal still over is never applied (unit tests with a scripted model)
- [ ] Output under `<results dir>/lessons/<night>-r<last round>/`: `lessons.md`, `changes.md`, `proposal.json` (ops, base sha256, cost, `applied`)
- [ ] `apply` writes the scenario's `lessons.md` unless that file changed since the proposal or the night was a mock; it never commits
- [ ] `npm run lessons -- distill --config … --night ID [--apply]` and `npm run lessons -- apply --config … --night ID` work by hand
- [ ] End-to-end, mock, dev server, on a scenario and config that declare lessons (the given ones if any does, else test-only copies (inside the checkout but outside `scenarios/` and `configs/`, gitignored, each with its own name and a `results_path` directly under `runs/`)): a finished mock night produces a proposal folder with an empty op list and `applied: false`, and the scenario's `lessons.md` is unchanged
- [ ] Kept as the reference has it, do not fix: a continued night stopped a second time reuses `lessons-<night>-stop`
- [ ] Both mock nights of ticket 21 still pass every check of "Goal and done signal"
