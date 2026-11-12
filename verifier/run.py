"""The verifier: grades a build of CodeClimb by rerunning its done signal on a clean copy.

    python3 verifier/run.py --app <dir> --stack <inngest|langchain> --out <reward.json>

One suite for both stacks; everything stack-specific is in adapters/<stack>.py.
Writes `reward.json` (flat numbers, as Harbor requires: `reward`, `done`, `leak`, and
one `checks.<name>` key per check) and `checks.json` beside it with each check's detail.
"""

import argparse
import json
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adapters import ADAPTERS, Adapter  # noqa: E402

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

    def record(self, name: str, passed: bool, detail: str = "") -> bool:
        self.checks.append(Check(name, passed, detail[-2000:]))
        print(f"[verifier] {name}: {'pass' if passed else 'FAIL'}", flush=True)
        return passed


def sh(app: Path, cmd: list[str], timeout_s: int) -> tuple[bool, str]:
    """Run a command in the app; True when it exits 0 within the limit."""
    try:
        p = subprocess.run(cmd, cwd=app, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as e:
        return False, f"timed out after {timeout_s}s: {e.stdout or ''}{e.stderr or ''}"
    return p.returncode == 0, p.stdout + p.stderr


def npm_script(app: Path, script: str, timeout_s: int) -> tuple[bool, str]:
    """`npm run <script>`, failing (not erroring) when the script does not exist."""
    scripts = json.loads((app / "package.json").read_text()).get("scripts", {}) if (app / "package.json").exists() else {}
    if script not in scripts:
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

    started = run.adapter.start_services(app)
    up, detail = run.adapter.wait_until_up(started, run.adapter.SERVICES_UP_S)
    run.record("services-up", up, detail if up else detail + "\n" + run.adapter.service_logs(started))
    run.adapter.stop_services(started)


STAGES: list[Callable[[Run], None]] = [build_checks]


def reward_of(checks: list[Check], leak: int) -> dict[str, float | int]:
    passed = sum(c.passed for c in checks)
    out: dict[str, float | int] = {
        "reward": passed / len(checks),
        "done": int(passed == len(checks)),
        "leak": leak,
    }
    out.update({f"checks.{c.name}": int(c.passed) for c in checks})
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--stack", choices=sorted(ADAPTERS), required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    run = Run(app=args.app.resolve(), adapter=ADAPTERS[args.stack])
    started = time.monotonic()
    for stage in STAGES:
        stage(run)
    # The trajectory scan sets this (leak scan ticket); until then nothing is scanned.
    leak = 0

    reward = reward_of(run.checks, leak)
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
