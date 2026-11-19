"""Regrades once every build trial of a run that is not `done` = 1, on both stacks (docs/codeclimb-eval-spec.md,
Verifier: the regrade rule, decided 2026-11-19 for the LangChain verifier's flakes). The regrade's result counts:
analyze.py puts a regrade in place of its source trial.

    python3 regrade.py <regrade dir> [--slots N] <job dir>...

Each regrade is `harbor trial regrade <trial> -p tasks/codeclimb-<stack> -o <regrade dir>`: the separate verifier
reruns on the recorded artifacts, $0, no new trial. A trial is regraded at most once: one that already has a regrade in
the regrade dir is skipped. Trials stopped by the usage limit, or whose `/app` was not collected, are infra and skipped.
"""

import json
import subprocess
import sys
import time
from pathlib import Path

from analyze import stream_facts
from assemble import STACKS


def _config(trial: Path) -> dict:
    try:
        return json.loads((trial / "config.json").read_text())
    except (OSError, ValueError):
        return {}


def due(job_dirs: list[Path], regrade_dir: Path) -> list[tuple[Path, str]]:
    """The build trials to regrade, with their stack."""
    done_before = {str(Path(p).resolve()) for t in regrade_dir.glob("*/")
                   if (p := (_config(t).get("source_trial") or {}).get("path"))}
    out = []
    for job in job_dirs:
        for trial in sorted(job.glob("*/")):
            cfg = _config(trial)
            stack = Path((cfg.get("task") or {}).get("path") or "").name.removeprefix("codeclimb-")
            if stack not in STACKS or cfg.get("source_trial") or str(trial.resolve()) in done_before:
                continue
            try:
                result = json.loads((trial / "result.json").read_text())
            except (OSError, ValueError):
                continue
            rewards = (result.get("verifier_result") or {}).get("rewards") or {}
            if not result.get("finished_at") or rewards.get("done") == 1:
                continue
            if stream_facts(trial / "agent" / "claude-code.txt")["usage_limit"]:
                continue
            if not (trial / "artifacts" / "app").is_dir():
                continue
            out.append((trial, stack))
    return out


def main(regrade_dir: Path, job_dirs: list[Path], slots: int) -> int:
    regrade_dir.mkdir(parents=True, exist_ok=True)
    todo, running, failed = due(job_dirs, regrade_dir), [], 0
    print(f"{len(todo)} trials to regrade, {slots} at a time")
    while todo or running:
        while todo and len(running) < slots:
            trial, stack = todo.pop(0)
            log = open(regrade_dir / f"{trial.parent.name}-{trial.name}.log", "w")
            cmd = ["harbor", "trial", "regrade", str(trial), "-p", f"tasks/codeclimb-{stack}", "-o", str(regrade_dir)]
            running.append((trial, subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)))
            print(f"regrade {trial}")
        time.sleep(10)
        for trial, proc in [r for r in running if r[1].poll() is not None]:
            running.remove((trial, proc))
            failed += proc.returncode != 0
            print(f"{'ok' if proc.returncode == 0 else 'FAILED'} {trial}")
    return failed


if __name__ == "__main__":
    args = sys.argv[1:]
    slots = 1
    if "--slots" in args:
        i = args.index("--slots")
        slots = int(args[i + 1])
        del args[i:i + 2]
    sys.exit(1 if main(Path(args[0]), [Path(a) for a in args[1:]], slots) else 0)
