"""The maintenance task registry (docs/codeclimb-eval-spec.md, "Maintenance tasks"): each task's request or symptom,
target tests and commits, and the per-stack text its prompt is filled with. Read by assemble.py and gate.py."""

from dataclasses import dataclass, field

# The maintenance base (docs/codeclimb-eval-spec.md, "Maintenance tasks"): the reference commits every maintenance task
# starts from. Not the build tasks' reference pins (assemble.BUILD_PINS), which carry C7 and C6 on top of these.
BASES = {"inngest": "bcabd72", "langchain": "400bd40"}
# The prompt's first line per kind.
ASK = {"change": "Make this change:", "repair": "Something is broken. This is what was seen:"}
# The runs folder each stack's build writes, and the service commands the prompt names.
RUNS_DIRS = {"inngest": "runs-inngest", "langchain": "runs-langchain"}
SERVICES = {
    "inngest": "the Inngest dev server already runs at `http://127.0.0.1:8288` (use it, don't start another);"
    " start the worker with `npm run worker`, again after every code change",
    "langchain": "`npm run server`, until `curl -s http://127.0.0.1:8123/ok` answers, again after every code change;"
    " `/app/.env` holds the key it needs",
}


@dataclass(frozen=True)
class Maintenance:
    """One maintenance task: a change (a request) or a repair (a symptom), as one commit per stack on that stack's
    reference branch. `bases` are the builds its target tests pass on."""

    kind: str  # change | repair
    request: str  # the request or the symptom, the same words on both stacks; never a test name
    targets: tuple[str, ...]
    commits: dict[str, str]
    bases: dict[str, str] = field(default_factory=lambda: dict(BASES))
    # A trace task's incident: a folder on this branch holding `<stack>/` (a failed night's folder, its rows and the
    # services' logs, kept by the verifier's CODECLIMB_VERIFIER_KEEP), copied into the /app as `incident/`.
    incident: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in ASK:
            raise ValueError(f"unknown maintenance kind {self.kind!r}: one of {', '.join(ASK)}")


MAINTENANCE = {
    # The smoke task, never counted: the commits before the test hooks; the maintenance bases are the reference's own fix.
    "c1": Maintenance(
        kind="change",
        request=(
            "Add the three test hooks `SPEC.md` lists, read from the environment when the services start:"
            " `CODECLIMB_BACKSTOP_S` replaces the night backstop and `CODECLIMB_PAUSE_TIMEOUT_S` the pause timeout,"
            " both in seconds, and `CODECLIMB_MOCK_CREDIT=<who>:<n>` makes call number `n` of a mock night's calls by"
            " `who` (`coder`, `reviewer` or `program`) fail once with a credit error, so the night pauses for credits."
            " A night stopped by the backstop writes `stop.json` and leaves no sandbox, even while it is still"
            " starting."
        ),
        targets=("backstop-mid-step", "pause-timeout", "pause-resume", "fail-at-init"),
        commits={"inngest": "0c395fd", "langchain": "9567643"},
    ),
    # Changes on the maintenance base: the bases are the references' own patches (the gate's proof).
    "c7": Maintenance(
        kind="change",
        request=(
            "Add the night config key `hard_deadline` that `SPEC.md` lists: an ISO time, or a duration from the start"
            " (`90m`, `8h`, `30s`). When it passes, the night stops hard, even in the middle of a step: the running"
            " experiment or evaluation is aborted, the night's sandboxes are removed and `stop.json` has `reason`"
            " `hard_deadline`, with no test score. A night without the key runs as before."
        ),
        targets=("hard-deadline-mid-step",),
        commits=dict(BASES),
        bases={"inngest": "1452a93", "langchain": "9d04590"},
    ),
    "c6": Maintenance(
        kind="change",
        request=(
            "Refuse one more night config at load, as `SPEC.md` now says: a `budget_usd.experiment` above"
            " `budget_usd.night`. `run-night` exits non-zero and starts nothing, as for the configs it already refuses."
        ),
        targets=("config-rejects",),
        commits=dict(BASES),
        bases={"inngest": "1360cb4", "langchain": "9911231"},
    ),
    # Cuts: the task commit removes a feature the bases have; the bases are the maintenance bases.
    "c2": Maintenance(
        kind="change",
        request=(
            "Add `run-night continue --config <yaml> [--night ID] [--direction TEXT] [--rounds N]`, as `SPEC.md`"
            " describes it: more rounds on an ended night, one that finished `done` or was stopped, under the same id."
            " Rounds number on from the last one and start from its kept commit, with what the night learned so far;"
            " `--night` defaults to the newest ended night under the config's results, and `--rounds` adds rounds."
            " The command takes no `--mock`: a mock night is continued as a mock. The continued run ends `done` with a"
            " test row of its own. The worker API's continue route and the app's Continue form, which `SPEC.md` also"
            " lists, go back too."
        ),
        targets=("continue", "continue-after-stop"),
        commits={"inngest": "bc1ab93", "langchain": "5901318"},
    ),
    "c4": Maintenance(
        kind="change",
        request=(
            "Make a cancel of the night's run from outside CodeClimb, through the runtime's own API or dashboard"
            " rather than `run-night stop`, a hard stop, as `SPEC.md` says: the night's live agent sessions are"
            " aborted, its sandboxes are removed (no `cc-<night id>` container in `docker ps -a`) and `stop.json` is"
            " written with `reason` `cancelled`, with no test score. `run-night stop` works as before."
        ),
        targets=("outside-cancel",),
        commits={"inngest": "b16f688", "langchain": "87fa4a1"},
    ),
    "r14": Maintenance(
        kind="repair",
        request=(
            "A mock night was started with `run-night --mock`. After its last round, once the night's final test"
            " evaluation had begun (its sandbox `cc-<night id>-test-r<N>` was up in `docker ps`), the service that"
            " runs the night's steps was killed (`SIGKILL`) and started again, with nothing else touched. The night"
            " ended `done` with one test row, but it had done finished work of rounds 1 and 2 a second time: files"
            " those rounds had completed before the kill, such as `nights/<night id>/exps/<night id>-r1-e0/code-state.json`"
            " or `nights/<night id>/reviews/r1.json`, were written again after the restart."
        ),
        # Narrowed to test 24 (docs/codeclimb-eval-spec.md, "Maintenance tasks", R14).
        targets=("crash-during-test-eval",),
        commits={"inngest": "f76da25", "langchain": "c3a1ec3"},
    ),
    # Narrowed to test 53: the fault leaves `run-night stop` (20) working (docs/codeclimb-eval-spec.md, R2).
    "r2": Maintenance(
        kind="repair",
        request=(
            "A mock night was started with `CODECLIMB_BACKSTOP_S=30` in `.env` (the services restarted after it was"
            " set) on a copy of the scenario whose evaluation stage starts with `sleep 300`, so round 1's evaluation"
            " runs for minutes. The backstop did not stop it: 90 s after the start there was still no `stop.json` in"
            " `nights/<night id>/`, and round 1's evaluation sandbox `cc-<night id>-r1-...` was still running in"
            " `docker ps`."
        ),
        targets=("backstop-mid-step",),
        commits={"inngest": "a755560", "langchain": "9d70972"},
    ),
    # Re-targeted from the catalogue's meter and spend-zero, which a mock night cannot fail without breaking the
    # evaluation too: the targets are the measured failing set of the nop proof (docs/codeclimb-eval-spec.md, R12).
    "r12": Maintenance(
        kind="repair",
        request=(
            "A mock night whose config lists `allowed_models`, such as"
            " `run-night --config configs/capitals-smoke.yaml --mock`, ended `done`, but every experiment in"
            " `results.jsonl` has `decision` `error`. No commit was made, `nights/<night id>/exps/<exp id>/session/`"
            " is empty, and no round has a `nights/<night id>/bundle/history/r<N>.diff`. The night's evaluations ran"
            " normally and recorded their model calls in `nights/<night id>/evals/<eval id>/meter.jsonl`. Mock nights"
            " whose config has `allowed_models: []`, such as `configs/datenorm-smoke.yaml`, are fine."
        ),
        targets=("mock-commit", "code-state", "send-backs", "notes", "graphrag-sessions", "graphrag-notes",
                 "graphrag-check-json", "rejected-diff"),
        commits={"inngest": "d69493f", "langchain": "df40257"},
    ),
    # Re-targeted from the catalogue's 23, 25, row-per-experiment and notes, which cannot see a held row
    # (docs/codeclimb-eval-spec.md, "Maintenance tasks", R15).
    "r15": Maintenance(
        kind="repair",
        request=(
            "A mock night started with `run-night --mock` and followed by `run-night` printed no results row while"
            " its rounds ran: `results.jsonl` had no row for the night, and `nights/<night id>/bundle/history/notes/`"
            " no note, until `done.json` appeared, and then every row came at once. A night stopped with"
            " `run-night stop` after its first round never got a row or a note for that round."
        ),
        targets=("continue-after-stop", "kill-after-row"),
        commits={"inngest": "b15c8e1", "langchain": "9e18335"},
    ),
    # The trace task: R14's fault, with only the failed night's files and the services' logs as the symptom. The
    # incident is a verifier run of test 24 on R14's commits, kept with CODECLIMB_VERIFIER_KEEP.
    "r10": Maintenance(
        kind="repair",
        request=(
            "A mock night went wrong after the service that runs the night's steps was killed and started again."
            " `incident/` holds what is left of it: the night's folder (`incident/night/`), its rows from"
            " `results.jsonl` (`incident/results.jsonl`) and the services' logs (`incident/logs/`). Find what went"
            " wrong from these files and fix it."
        ),
        targets=("crash-during-test-eval",),
        commits={"inngest": "f76da25", "langchain": "c3a1ec3"},
        incident="maintenance/r10",
    ),
    # The control: nothing stack-specific in it.
    "r3": Maintenance(
        kind="repair",
        request=(
            "A mock night, started with `run-night --mock`, ended normally. Then"
            " `run-night continue --config <its config> --night <its id> --rounds 1`, with no `--mock` (the command"
            " takes none), did not go on with it as a mock night: it checked the real models first and stopped with"
            " `no github-copilot credentials`."
        ),
        targets=("continue",),
        commits={"inngest": "2c8eaa7", "langchain": "3f7793d"},
    ),
}
