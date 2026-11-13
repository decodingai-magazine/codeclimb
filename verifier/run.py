"""The verifier: grades a build of CodeClimb by rerunning its done signal on a clean copy.

    python3 verifier/run.py --app <dir> --stack <inngest|langchain> --out <reward.json>

One suite for both stacks; everything stack-specific is in adapters/<stack>.py.
Writes `reward.json` (flat numbers, as Harbor requires: `reward`, `done`, `leak`, and
one `checks.<name>` key per check) and `checks.json` beside it with each check's detail.
"""

import argparse
import json
import shutil
import sys
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import ADAPTERS, Adapter, Services, guarded, run_group  # noqa: E402
from leak import scan  # noqa: E402
from nights import (  # noqa: E402
    FIRST_TABLE,
    FIRST_TABLE_NIGHTS,
    NIGHT7_CARRIES,
    NIGHT7_TABLE,
    Night,
    crash_resume,
    hard_stop,
    lost_connection,
    plateau_stop,
    run_night,
    run_night7,
)

# Seconds. A command past its limit fails its check.
INSTALL_S = 900
TYPECHECK_S = 600
UNIT_TESTS_S = 1200
IMAGE_S = 1200


@dataclass
class Check:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class Run:
    app: Path
    adapter: Adapter
    checks: list[Check] = field(default_factory=list)
    # Reported, not counted: per-night results of the night checks (a row counts once, in `checks`) and the
    # stages that crashed.
    reported: dict[str, int] = field(default_factory=dict)
    services: Services | None = None
    services_up: bool = False
    tag: str = field(default_factory=lambda: f"v{int(time.time()) % 10**8}")

    def record(self, name: str, passed: bool, detail: str = "") -> bool:
        self.checks.append(Check(name, passed, detail[-2000:]))
        print(f"[verifier] {name}: {'pass' if passed else 'FAIL'}", flush=True)
        return passed


def sh(app: Path, cmd: list[str], timeout_s: int) -> tuple[bool, str]:
    """Run a command in the app; True when it exits 0 within the limit. On a timeout the whole
    process group is killed, so a hung `npm test` leaves no child holding a port."""
    code, out = run_group(cmd, app, timeout_s)
    return code == 0, out


def npm_script(app: Path, script: str, timeout_s: int) -> tuple[bool, str]:
    """`npm run <script>`, failing (not erroring) when the script does not exist."""
    try:
        scripts = json.loads((app / "package.json").read_text()).get("scripts", {})
    except (OSError, ValueError, AttributeError) as e:
        return False, f"package.json unreadable: {e!r}"
    if not isinstance(scripts, dict) or script not in scripts:
        return False, f"no npm script {script!r}"
    return sh(app, ["npm", "run", script], timeout_s)


def build_checks(run: Run) -> None:
    """The five build checks, in build order, so a half-built app scores above empty given inputs."""
    app = run.app
    run.record("install", *sh(app, ["npm", "ci", "--ignore-scripts"], INSTALL_S))
    run.record("typecheck", *npm_script(app, "typecheck", TYPECHECK_S))
    run.record("unit-tests", *npm_script(app, "test", UNIT_TESTS_S))

    ok, out = npm_script(app, "build:image", IMAGE_S)
    if ok:
        ok, more = sh(app, ["docker", "image", "inspect", "codeclimb-python"], 60)
        out += more
    run.record("image", ok, out)

    # The services stay up for the nights; main() stops them.
    shutil.rmtree(app / run.adapter.RUNS, ignore_errors=True)
    run.services = run.adapter.start_services(app)
    up, detail = run.adapter.wait_until_up(run.services, run.adapter.SERVICES_UP_S)
    run.services_up = run.record("services-up", up, detail if up else detail + "\n" + run.adapter.service_logs(run.services))


def nights(run: Run) -> None:
    """The seven nights in order, one at a time, then one check per row: a row of the first table passes only if
    it holds in every night it applies to (nights 1, 2, 3, 6, and 7 for the rows it carries); each added row of
    nights 3 to 6 and each row of night 7's own table counts once."""
    app, runs, tag = run.app, run.adapter.RUNS, run.tag
    first: dict[int, Night] = {}
    added: dict[str, tuple[bool, str]] = {}
    night7: Night | None = None
    night7_detail = "services not up: no night ran"
    if run.services_up:
        assert run.services is not None
        configs = {n: (config, extra) for n, config, extra in FIRST_TABLE_NIGHTS}
        for n in range(1, 8):
            started = time.monotonic()
            if n in configs:
                config, extra = configs[n]
                first[n] = run_night(app, runs, n, config, f"{tag}-n{n}", extra)
                note = f"exited {first[n].exit_code}"
            elif n == 4:
                added["hard-stop"] = guarded(hard_stop, app, runs, run.adapter.LOGS, f"{tag}-n4")
                note = "pass" if added["hard-stop"][0] else "FAIL"
            elif n == 5:
                added["crash-resume"] = guarded(crash_resume, app, runs, run.adapter, run.services, tag)
                note = "pass" if added["crash-resume"][0] else "FAIL"
            else:
                night7, night7_detail = run_night7(app, runs, f"{tag}-n7")
                note = f"exited {night7.exit_code}" if night7 else "no night: graphrag image not built"
            print(f"[verifier] night {n}: {note} ({time.monotonic() - started:.0f}s)", flush=True)

    for row, applies_to, check in FIRST_TABLE:
        mine = [nt for nt in first.values() if applies_to is None or nt.name in applies_to]
        if row in NIGHT7_CARRIES:
            mine += [night7] if night7 else []
        results = []
        for nt in mine:
            ok, detail = guarded(check, nt)
            run.reported[f"night{nt.n}.{row}"] = int(ok)
            results.append((ok, f"night {nt.n}: {detail}"))
        missing = run.services_up and row in NIGHT7_CARRIES and night7 is None
        if missing:
            results.append((False, f"night 7: {night7_detail}"))
        passed = bool(results) and all(ok for ok, _ in results)
        detail = "\n".join(d for _, d in results) if results else "services not up: no night ran"
        run.record(row, passed, detail)

    no_night = (False, "services not up: no night ran")
    run.record("plateau-stop", *(guarded(plateau_stop, first[3]) if 3 in first else no_night))
    run.record("hard-stop", *added.get("hard-stop", no_night))
    run.record("crash-resume", *added.get("crash-resume", no_night))
    run.record("lost-connection", *(guarded(lost_connection, first[6]) if 6 in first else no_night))
    for row, check in NIGHT7_TABLE:
        run.record(row, *(guarded(check, night7) if night7 else (False, night7_detail)))


STAGES: list[Callable[[Run], None]] = [build_checks, nights]

# Every counted check, in order: N is this list's length on both stacks.
BUILD_CHECKS = ["install", "typecheck", "unit-tests", "image", "services-up"]
ADDED_ROWS = ["plateau-stop", "hard-stop", "crash-resume", "lost-connection"]
CHECKS = BUILD_CHECKS + [row for row, _, _ in FIRST_TABLE] + ADDED_ROWS + [row for row, _ in NIGHT7_TABLE]


def reward_of(checks: list[Check], reported: dict[str, int], leak: dict[str, object]) -> dict[str, float | int]:
    passed = sum(c.passed for c in checks)
    out: dict[str, float | int] = {
        "reward": passed / len(checks),
        "done": int(passed == len(checks)),
        "leak": int(leak["leak"]),
        "leak_sessions": int(leak["sessions"]),
    }
    out.update({f"checks.{c.name}": int(c.passed) for c in checks})
    out.update({f"checks.{k}": v for k, v in reported.items()})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--stack", choices=sorted(ADAPTERS), required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--agent-logs", type=Path, default=Path("/logs/agent"), help="the trial's agent logs, for the leak scan")
    args = ap.parse_args()

    run = Run(app=args.app.resolve(), adapter=ADAPTERS[args.stack])
    started = time.monotonic()
    # Before any stage writes to /app. given.json is written by assemble.py into the task's copy of the verifier.
    given_path = Path(__file__).resolve().parent / "given.json"
    try:
        leak = scan(run.app, args.agent_logs, json.loads(given_path.read_text()) if given_path.exists() else None)
    except Exception:
        # reward.json is always written; a scan that crashed is not a clean trial.
        leak = {"leak": 1, "sessions": 0, "crashed": traceback.format_exc()}
        run.reported["leak-scan-crashed"] = 0
    try:
        for stage in STAGES:
            try:
                stage(run)
            except Exception:
                # A crashed stage fails the checks it had not recorded; reward.json is still written.
                crash = traceback.format_exc()
                run.reported[f"{stage.__name__}-crashed"] = 0
                print(f"[verifier] {stage.__name__} crashed\n{crash}", flush=True)
                done = {c.name for c in run.checks}
                for name in CHECKS:
                    if name not in done and (stage is not build_checks or name in BUILD_CHECKS):
                        run.record(name, False, f"not reached: {stage.__name__} crashed\n{crash}")
    finally:
        if run.services is not None:
            run.adapter.stop_services(run.services)
    if [c.name for c in run.checks] != CHECKS:
        print(f"[verifier] warning: checks differ from CHECKS: {[c.name for c in run.checks]}", flush=True)
    reward = reward_of(run.checks, run.reported, leak)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(reward, indent=1) + "\n")
    (args.out.parent / "checks.json").write_text(
        json.dumps(
            {
                "stack": args.stack,
                "wall_clock_s": round(time.monotonic() - started, 1),
                "checks": [c.__dict__ for c in run.checks],
                "leak": leak,
            },
            indent=1,
        )
        + "\n"
    )
    print(json.dumps(reward, indent=1))


if __name__ == "__main__":
    main()
