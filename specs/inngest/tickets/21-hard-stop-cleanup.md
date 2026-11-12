# 21: Hard stop and cleanup: every dead night ends in stop.json; mock night 4 passes

**What to build:** An operator can stop a night, and a night that fails or times out stops itself. Every hard stop goes through one path, so no Pi session keeps spending, no sandbox is left running, and `run-night` never hangs: it prints `stopped` and exits 0. This ticket replaces ticket 11's interim failure handling. It includes mock nights under `runs-inngest/mock/` and nights that failed before `night.json` existed.

**Spec sections** (`specs/inngest/spec.md`): "Goal and done signal", "Cleanup", "Stops", "Crash and resume", "CLI", "Events", "Durable runtime on Inngest", "Deployment and environment", "Known gaps", "Platform facts found while building"

**Blocked by:** 11 (Tracer night: one mock round on the Inngest dev server); 20 (Check table: mock nights 1 to 3 as one repeatable check)

**Status:** ready-for-agent

- [ ] `run-night stop --night ID` sends `codeclimb/night.stop` with reason `manual`, waits for the night's `stop.json`, then prints `stopped` and exits 0 (for a night that finished first it prints `done`); `run-night`, `run-experiment` and `run-evaluator` each cancel on the stop event for their night
- [ ] The live registry maps run id to an abort function and carries the night id; a stop aborts the night's running Pi session, which ends as `cancelled`, destroys its sandbox and fails the step
- [ ] `night-stop-cleanup` aborts the night's live sessions, sweeps `cc-<night>` and writes `stop.json` with `at` and `reason` (`manual`, `app`, `failed`, `cancelled`, or `stop` when the event names none); it writes nothing when `done.json` exists, and the first stop wins
- [ ] `run-cancelled-cleanup` handles the platform's function-cancelled event: it aborts that run's session, sweeps the sandboxes that run created, and sends the stop event when the cancelled run was the night's parent (told apart by the triggering event it carries). Neither cleanup function sets a retry count
- [ ] The night's failure handler sends the stop event; when `night.json` is missing it first creates `nights/<id>/` from the start event's results directory and writes `stop.json` with reason `failed`
- [ ] A night's folder is found by scanning `<root>/runs-inngest/*/nights/<id>/night.json` and `<root>/runs-inngest/mock/*/nights/<id>/night.json` (the spec asks for the mock path although the reference lacks it)
- [ ] The follower prints `stopped` with `stop.json` and exits 0
- [ ] Docker test: calling a running mock coder experiment's abort function from the live registry ends it as `cancelled`, with its sandbox destroyed and no commit
- [ ] Night 4, with the dev server and the worker up: `datenorm-smoke --mock --no-wait`, then `run-night stop --night <id>` once `exps/<id>-r1-e0/` exists; the stop command prints `stopped` and exits 0; within 30 s of it `stop.json` has `reason: manual`, there is no `done.json` and no `test` row for the night, and no `cc-<id>` container is left
- [ ] End-to-end on the dev server, mock: (a) the same night started without `--no-wait` and stopped from a second shell: its `run-night` prints `stopped` and exits 0; (b) a mock night whose init fails (a test-only config and scenario copy whose `bundle` command fails, kept outside `scenarios/` and `configs/` with a `results_path` folder of its own) ends with `stop.json` reason `failed` and no `night.json`, and `run-night` exits
- [ ] The night backstop's test hook: the worker reads `CODECLIMB_BACKSTOP_S` when it starts, a positive integer of seconds in place of the 4 days; unset or empty means 4 days (unit test on the reader). End-to-end on the dev server, mock, with the worker started with a value shorter than a mock round: a night still running then is cancelled and ends with `stop.json`, no `done.json` and no `cc-<id>` container, and its `run-night` prints `stopped`. The worker is started again without the variable afterwards
- [ ] Kept as the reference has it, do not fix: the sweep prefix `cc-<night>` of night `a1` also matches night `a10`
- [ ] Mock nights 1 to 3 of ticket 20 still pass every check "Goal and done signal" lists for them
