"""The maintenance gate, at $0: is a task real, and equally hard on both stacks? (docs/codeclimb-eval-spec.md,
"Maintenance tasks").

    python3 gate.py <task id> <jobs dir or job dir>...

Reads the grade files (`verifier/reward.json`, `checks.json`) of the reference runs that
`job-configs/reference.sh <stack> <sha> -k 3` leaves under `jobs/reference-<stack>-<sha>-*/`, 3 on each stack's base and
3 on its task commit, run with `CODECLIMB_VERIFIER_ONLY` set to the task's target tests. Prints the verdict as JSON:
pass or fail with the reasons, and per stack the failing set, the fix size, the import hops from the CLI entry to the
changed lines, and the seconds to reproduce.
"""

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from maintenance import MAINTENANCE

ROOT = Path(__file__).resolve().parent
REPEATS = 3  # reference runs per side (base, task commit) and stack
JOB = re.compile(r"reference-(inngest|langchain)-([0-9a-f]{7})-\d+")
GREEN = ("typecheck", "unit-tests")
IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")
SOURCE = (".ts", ".tsx", ".mts")


def target_grade(reward: dict, target: str) -> int | None:
    """A target's grade in one run: a counted check (`checks.<name>`, e.g. `crash-resume`) or a hidden test
    (`hidden.<name>`); None when it did not run."""
    return reward.get(f"checks.{target}", reward.get(f"hidden.{target}"))


@dataclass
class Run:
    reward: dict
    seconds: dict[str, float]  # per target test, from checks.json


def _check_runs(stack: str, side: str, runs: list[Run], targets: tuple[str, ...]) -> list[str]:
    reasons = [] if len(runs) == REPEATS else [f"{stack}: {len(runs)} {side} runs, not {REPEATS}"]
    for i, r in enumerate(runs, 1):
        if r.reward.get("checks.services-up") != 1:
            reasons.append(f"{stack}: {side} run {i}: services not up")
            continue
        reasons += [f"{stack}: {side} run {i}: {c} failed" for c in GREEN if r.reward.get(f"checks.{c}") != 1]
        reasons += [f"{stack}: {side} run {i}: {t} did not run" for t in targets if target_grade(r.reward, t) is None]
    return reasons


def gate(targets: tuple[str, ...], runs: dict[str, dict[str, list[Run]]], fix: dict[str, dict[str, int]],
         hops: dict[str, int | None]) -> dict:
    """`runs[stack]` holds the "base" and "task" runs. A target that did not run counts as neither a pass nor a
    failure. The pair passes when, on both stacks, the base passes every target 3 of 3 and the task commit fails every
    target 3 of 3, typecheck and unit tests pass in every run, the failing sets are equal and the fix sizes are within
    2x of each other."""
    reasons: list[str] = []
    stacks: dict[str, dict] = {}
    for stack, sides in runs.items():
        base, task = sides["base"], sides["task"]
        reasons += _check_runs(stack, "base", base, targets) + _check_runs(stack, "task", task, targets)
        failing = []
        for t in targets:
            passed = sum(target_grade(r.reward, t) == 1 for r in base)
            failed = sum(target_grade(r.reward, t) == 0 for r in task)
            if passed != REPEATS:
                reasons.append(f"{stack}: base passes {t} {passed} of {REPEATS}")
            if failed == REPEATS:
                failing.append(t)
            else:
                reasons.append(f"{stack}: task commit fails {t} {failed} of {REPEATS}")
        spent = [sum(r.seconds.get(t, 0.0) for t in targets) for r in task if r.seconds]
        stacks[stack] = {"failing": sorted(failing), "fix": fix[stack], "hops": hops[stack],
                         "reproduce_s": median(spent) if spent else None}
    if len({tuple(s["failing"]) for s in stacks.values()}) > 1:
        reasons.append("failing sets differ: " + ", ".join(f"{k} {v['failing']}" for k, v in sorted(stacks.items())))
    lines = {k: v["fix"]["lines"] for k, v in sorted(stacks.items())}
    if lines and min(lines.values()) * 2 < max(lines.values()):
        reasons.append("fix sizes differ more than 2x: " + ", ".join(f"{k} {n} lines" for k, n in lines.items()))
    return {"pass": not reasons, "reasons": reasons, "stacks": stacks}


def resolved(grade: dict, bases: list[dict], targets: list[str]) -> tuple[bool | None, list[str]]:
    """A maintenance trial's outcome against its base's grades: (resolved, regressions). Resolved: every target test
    passes and every other check or test that passed in every base grade still passes. None with no base grade."""
    if not bases:
        return None, []
    keys = {f"{f}.{t}" for t in targets for f in ("checks", "hidden")}
    held = sorted(k for k in set.intersection(*(set(b) for b in bases)) - keys
                  if k.startswith(("checks.", "hidden.", "real.")) and all(b[k] == 1 for b in bases))
    regressions = [k for k in held if grade.get(k) != 1]
    return all(target_grade(grade, t) == 1 for t in targets) and not regressions, regressions


def _resolve(spec: str, importer: str, files: dict[str, str]) -> str | None:
    parts = (Path(importer).parent / spec).as_posix().split("/")
    path: list[str] = []
    for p in parts:
        if p == "..":
            path = path[:-1]
        elif p not in (".", ""):
            path.append(p)
    rel = "/".join(path)
    stem = re.sub(r"\.(m?js|jsx)$", "", rel)
    candidates = [rel, *(stem + ext for ext in SOURCE), *(f"{rel}/index{ext}" for ext in SOURCE)]
    return next((c for c in candidates if c in files), None)


def import_hops(files: dict[str, str], entry: str, changed: list[str]) -> int | None:
    """Fewest relative imports from `entry` to any of the `changed` files; None when none is reachable."""
    goal, seen, frontier, hops = set(changed), {entry}, [entry], 0
    while frontier:
        if goal.intersection(frontier):
            return hops
        nxt = []
        for f in frontier:
            for spec in IMPORT.findall(files.get(f, "")):
                dep = _resolve(spec, f, files)
                if dep and dep not in seen:
                    seen.add(dep)
                    nxt.append(dep)
        frontier, hops = nxt, hops + 1
    return None


def runs_from_jobs(dirs: list[Path]) -> dict[tuple[str, str], list[Run]]:
    """Every graded reference trial under `dirs`, by (stack, 7-character commit), in trial order."""
    out: dict[tuple[str, str], list[Run]] = {}
    jobs = {j for d in dirs for j in [d, *d.iterdir()] if j.is_dir() and JOB.fullmatch(j.name)}
    for job in sorted(jobs):
        stack, sha = JOB.fullmatch(job.name).groups()
        for reward_file in sorted(job.glob("*/verifier/reward.json")):
            try:
                checks = json.loads((reward_file.parent / "checks.json").read_text())
            except (OSError, ValueError):
                checks = {}
            seconds = {f["name"].removeprefix("hidden."): f["seconds"] for f in checks.get("families", [])}
            out.setdefault((stack, sha), []).append(Run(json.loads(reward_file.read_text()), seconds))
    return out


def _git(*args: str, repo: Path = ROOT) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout


def fix_size(base: str, commit: str, repo: Path = ROOT) -> tuple[dict[str, int], list[str]]:
    """The reference's own fix (task commit -> base): lines added plus removed and files, and the changed paths."""
    lines, changed = 0, []
    for row in _git("diff", "--numstat", commit, base, repo=repo).splitlines():
        added, removed, path = row.split("\t")
        lines += int(added) + int(removed) if added != "-" else 0
        changed.append(path)
    return {"lines": lines, "files": len(changed)}, changed


def _short(sha: str) -> str:
    """A commit's 7-character name, as the reference jobs' folders carry it."""
    return _git("rev-parse", "--short=7", f"{sha}^{{commit}}").strip()


def fix_and_hops(base: str, commit: str) -> tuple[dict[str, int], int | None]:
    """The fix (task commit -> base): lines added plus removed and files; and the import hops, in the base, from the
    `run-night` script's entry to the nearest changed source file."""
    fix, changed = fix_size(base, commit)
    tree = [p for p in _git("ls-tree", "-r", "--name-only", base).splitlines() if p.endswith(SOURCE)]
    files = {p: _git("show", f"{base}:{p}") for p in tree}
    script = json.loads(_git("show", f"{base}:package.json"))["scripts"]["run-night"]
    entry = next(w for w in script.split() if w.endswith(SOURCE))
    return fix, import_hops(files, entry, changed)


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    task = MAINTENANCE[sys.argv[1]]
    found = runs_from_jobs([Path(a) for a in sys.argv[2:]])
    runs, fix, hops = {}, {}, {}
    for stack, commit in task.commits.items():
        base = task.bases[stack]
        runs[stack] = {"base": found.get((stack, _short(base)), []), "task": found.get((stack, _short(commit)), [])}
        fix[stack], hops[stack] = fix_and_hops(base, commit)
    print(json.dumps(gate(task.targets, runs, fix, hops), indent=1))


if __name__ == "__main__":
    main()
