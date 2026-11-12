# 34: Lessons distillation: graph, trigger and CLI

**What to build:** When a night finishes or is stopped, and lessons are on, a server run of the `lessons` graph distils the night's notes and reviews into a proposal under `<results dir>/lessons/<night>-r<last round>/`. With `lessons: apply` on a real-model night it also rewrites the scenario's `lessons.md`. Runs queue one at a time per scenario. The operator can do the same by hand with `npm run lessons`.

**Spec sections:**
- "Memory within and across nights" > "Lessons across nights": the bullets on the trigger, on when a night is distilled or skipped, on a credit error, on the input, on `apply`, on `night.json`, and "by hand"
- "Interfaces" > "Control operations": the `lessons` row
- "Durable runtime on LangGraph": the `lessons` row of the Graphs table; requirements row "Lessons one at a time"; the lessons thread
- "Durable runtime on LangGraph" > "Cleanup": the stop graph starts the lessons operation for a night that didn't finish
- "Experiment lifecycle" > "Round loop": the lessons run after `done.json`
- "CLI": `lessons` tells a mock night by its folder; "Mock mode": the lessons reply; lessons are never applied on a mock
- "Data and files" > "Files a night writes": `lessons/<night>-r<N>/`, `lessons_sha256`

**Not yet:** the seed refusal that reads applied proposals (ticket 36).

**Blocked by:** 17 (Reviewer); 25 (Check table: mock nights 1 to 3 as one repeatable check); 26 (Stop operation and cleanup; mock night 4 passes); 33 (Lessons file, operations and gates)

**Status:** ready-for-agent

- [ ] The night starts the lessons operation at its end, and the stop cleanup starts it for a night that didn't finish, reading the config from `night.json`; neither starts it when the mode is `off` or the scenario declares no lessons
- [ ] The lessons run goes to the scenario's lessons thread (UUID v5 of `lessons/<scenario>`, created if missing) with `enqueue` and `durability: "sync"`
- [ ] A night is distilled when it has notes or reviews for rounds past its newest applied proposal, and skipped when a proposal folder for its last such round exists; a second run for the same night changes nothing
- [ ] The model's input holds only those rounds' notes and reviews (feedback, hypothesis), the spec without `lessons.md`, and `lessons.md` with numbered bullets; never `done.json`, a test evaluation or a review prompt
- [ ] The session runs on the reviewer's model and effort, in memory, with no tools; a credit error fails the step and its retries run it again
- [ ] `apply` writes the scenario's `lessons.md` unless the file changed since the proposal or the night was a mock; it never commits; `propose` writes the proposal only; `proposal.json` records `applied`
- [ ] `night.json` records the sha256 of the `lessons.md` each variation's coders read
- [ ] `npm run lessons -- distill --config … --night ID [--apply]`, `lessons apply --config … --night ID` and `lessons format --config … [--check]` work; a night under `runs-langchain/mock/` is distilled as a mock
- [ ] Tests on mock models with a temporary scenario that declares lessons: after a mock night, `lessons/<id>-r<last round>/proposal.json` exists with `applied: false` and the scenario's `lessons.md` is unchanged; a stopped night gets a proposal too
- [ ] The three mock nights of ticket 25 still pass every check of "Goal and done signal"
- [ ] `npm run typecheck` and `npm test` pass
