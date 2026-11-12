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
from nights import FIRST_TABLE, FIRST_TABLE_NIGHTS, Night, run_night  # noqa: E402

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
    # Per-night results of the night checks: reported, not counted (a row counts once, in `checks`).
    per_night: dict[str, int] = field(default_factory=dict)
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


def first_table(run: Run) -> None:
    """Nights 1, 2, 3 and 6, then one check per row of the first table: a row passes only if it
    holds in every night it applies to."""
    nights: list[Night] = []
    if run.services_up:
        for n, config, extra in FIRST_TABLE_NIGHTS:
            night = run_night(run.app, run.adapter.RUNS, n, config, f"{run.tag}-n{n}", extra)
            print(f"[verifier] night {n} ({config}) exited {night.exit_code}", flush=True)
            nights.append(night)
    for row, applies_to, check in FIRST_TABLE:
        mine = [nt for nt in nights if applies_to is None or nt.name in applies_to]
        results = []
        for nt in mine:
            ok, detail = guarded(check, nt)
            run.per_night[f"night{nt.n}.{row}"] = int(ok)
            results.append((ok, f"night {nt.n}: {detail}"))
        passed = bool(results) and all(ok for ok, _ in results)
        detail = "\n".join(d for _, d in results) if results else "services not up: no night ran"
        run.record(row, passed, detail)


STAGES: list[Callable[[Run], None]] = [build_checks, first_table]


def reward_of(checks: list[Check], per_night: dict[str, int], leak: int) -> dict[str, float | int]:
    passed = sum(c.passed for c in checks)
    out: dict[str, float | int] = {
        "reward": passed / len(checks),
        "done": int(passed == len(checks)),
        "leak": leak,
    }
    out.update({f"checks.{c.name}": int(c.passed) for c in checks})
    out.update({f"checks.{k}": v for k, v in per_night.items()})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--stack", choices=sorted(ADAPTERS), required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    run = Run(app=args.app.resolve(), adapter=ADAPTERS[args.stack])
    started = time.monotonic()
    try:
        for stage in STAGES:
            try:
                stage(run)
            except Exception:
                # A crashed stage fails the checks it had not recorded; reward.json is still written.
                run.record(f"{stage.__name__}-crashed", False, traceback.format_exc())
    finally:
        if run.services is not None:
            run.adapter.stop_services(run.services)
    # The trajectory scan sets this (leak scan ticket); until then nothing is scanned.
    leak = 0

    reward = reward_of(run.checks, run.per_night, leak)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(reward, indent=1) + "\n")
    (args.out.parent / "checks.json").write_text(
        json.dumps(
            {
                "stack": args.stack,
                "wall_clock_s": round(time.monotonic() - started, 1),
                "checks": [c.__dict__ for c in run.checks],
            },
            indent=1,
        )
        + "\n"
    )
    print(json.dumps(reward, indent=1))


if __name__ == "__main__":
    main()
