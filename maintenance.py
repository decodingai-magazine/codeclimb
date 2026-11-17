"""The maintenance task registry (docs/codeclimb-eval-spec.md, "Maintenance tasks"): each task's request or symptom,
target tests and commits, and the per-stack text its prompt is filled with. Read by assemble.py and gate.py."""

from dataclasses import dataclass, field

# The reference pins (docs/codeclimb-eval-spec.md, "Reference builds"), the base of every maintenance task.
PINS = {"inngest": "bcabd72", "langchain": "400bd40"}
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
    bases: dict[str, str] = field(default_factory=lambda: dict(PINS))

    def __post_init__(self) -> None:
        if self.kind not in ASK:
            raise ValueError(f"unknown maintenance kind {self.kind!r}: one of {', '.join(ASK)}")


MAINTENANCE = {
    # The smoke task, never counted: the commits before the test hooks; the pins are the reference's own fix.
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
        targets=("backstop-mid-step", "pause-timeout", "pause-resume"),
        commits={"inngest": "0c395fd", "langchain": "9567643"},
    ),
    # Changes on the pins: the bases are the references' own patches (the gate's proof).
    "c7": Maintenance(
        kind="change",
        request=(
            "Add the night config key `hard_deadline` that `SPEC.md` lists: an ISO time, or a duration from the start"
            " (`90m`, `8h`, `30s`). When it passes, the night stops hard, even in the middle of a step: the running"
            " experiment or evaluation is aborted, the night's sandboxes are removed and `stop.json` has `reason`"
            " `hard_deadline`, with no test score. A night without the key runs as before."
        ),
        targets=("hard-deadline-mid-step",),
        commits=dict(PINS),
        bases={"inngest": "1452a93", "langchain": "9d04590"},
    ),
    "c6": Maintenance(
        kind="change",
        request=(
            "Refuse one more night config at load, as `SPEC.md` now says: a `budget_usd.experiment` above"
            " `budget_usd.night`. `run-night` exits non-zero and starts nothing, as for the configs it already refuses."
        ),
        targets=("config-rejects",),
        commits=dict(PINS),
        bases={"inngest": "1360cb4", "langchain": "9911231"},
    ),
    "r14": Maintenance(
        kind="repair",
        request=(
            "A mock night was started with `run-night --mock`. Once its round 2 had begun, the service that runs the"
            " night's steps was killed (`SIGKILL`) and started again, with nothing else touched. The night then did"
            " round 1's finished work a second time: `docker ps -a` shows round 1's coder sandbox"
            " `cc-<night id>-r1-e0` created again after the restart, and round 1's"
            " `exps/<night id>-r1-e0/code-state.json` changed after it."
        ),
        targets=("crash-resume", "crash-mid-eval", "crash-during-test-eval", "crash-at-init", "row-identity"),
        commits={"inngest": "f76da25", "langchain": "c3a1ec3"},
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
