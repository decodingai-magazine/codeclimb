"""Regrades once every trial of a run that did not pass, build and maintenance trials alike, on both stacks
(docs/codeclimb-eval-spec.md, Verifier: the regrade rule, decided 2026-11-19 for the LangChain verifier's flakes). A
build trial is regraded when it is not `done` = 1, a maintenance trial when it is not `resolved` against its base's
grades. The regrade's result counts: analyze.py puts a regrade in place of its source trial.

    python3 regrade.py <regrade dir> [--slots N] <job dir>...

The job dirs hold the trials and the reference grades of the maintenance bases (`resolved` needs them). Each regrade is
`harbor trial regrade <trial> -p tasks/<task> -o <regrade dir>`: the separate verifier reruns on the recorded artifacts,
$0, no new trial. A maintenance regrade runs the maintenance families (maintenance.FAMILIES), as its trial did. A trial
is regraded at most once: one that already has a regrade in the regrade dir is skipped. Trials stopped by the usage
limit, or whose `/app` was not collected, are infra and skipped; so are reference grades.
"""

import os
import subprocess
import sys
import time
from pathlib import Path

from analyze import collect
from assemble import STACKS
from maintenance import FAMILIES


def due(job_dirs: list[Path], regrade_dir: Path) -> list[tuple[Path, str, str | None]]:
    """The trials to regrade, with their task folder name (`codeclimb-<stack>[-<task id>]`) and the verifier families
    to set (None: the caller's)."""
    dirs = [*job_dirs, regrade_dir]
    paths = {(t.parent.name, t.name): t for d in dirs for t in [*d.glob("*/"), *d.glob("*/*/")]}
    out = []
    for r in sorted(collect(dirs), key=lambda r: (r["job"], r["trial"])):
        # Counted or graded without a reward; a regraded, infra or leak trial is not regraded; nor a reference grade.
        if r["regrade_of"] or r["status"] not in ("counted", "no-reward") or r["harness"] == "nop" or r["stack"] not in STACKS:
            continue
        trial = paths[(r["job"], r["trial"])]
        if not (trial / "artifacts" / "app").is_dir():
            continue
        if r["task"]:
            if r["reward"] is not None and r["resolved"] is None:
                print(f"no base grade for {trial}: not regraded", file=sys.stderr)
                continue
            if r["resolved"] is True:
                continue
        elif r["done"] == 1:
            continue
        out.append((trial, f"codeclimb-{r['stack']}" + (f"-{r['task']}" if r["task"] else ""), FAMILIES if r["task"] else None))
    return out


def main(regrade_dir: Path, job_dirs: list[Path], slots: int) -> int:
    regrade_dir.mkdir(parents=True, exist_ok=True)
    todo, running, failed = due(job_dirs, regrade_dir), [], 0
    print(f"{len(todo)} trials to regrade, {slots} at a time")
    while todo or running:
        while todo and len(running) < slots:
            trial, task, families = todo.pop(0)
            log = open(regrade_dir / f"{trial.parent.name}-{trial.name}.log", "w")
            cmd = ["harbor", "trial", "regrade", str(trial), "-p", f"tasks/{task}", "-o", str(regrade_dir)]
            env = {**os.environ, "CODECLIMB_VERIFIER_FAMILIES": families} if families else None
            running.append((trial, subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env)))
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
