"""The code and practice analysis step: one build -> one metrics file (docs/codeclimb-eval-spec.md, Metrics).

    python3 code_metrics.py --app <build dir> --stack <inngest|langchain> --out <trial dir>/code-metrics.json
                            [--reference <the stack's reference metrics.json>]
    python3 code_metrics.py jobs <job dir>...    # every build trial without a metrics file, against its stack's pin

The tools run at pinned versions in the benchmark's own container (analysis/Dockerfile), never in the build: the build
is mounted read-only and copied inside, where `npm ci --ignore-scripts` installs its own packages. This file knows the
benchmark side (the given inputs, the build spec's dependency table, the stack SDK); analysis/measure.py runs the
tools in the container. Report only: no metric is a check or part of `reward`.
"""

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from assemble import AGENTS_STUB, ROOT, SHARED, STACKS, STUBS

ANALYSIS = ROOT / "analysis"
# The stack SDK: a file importing one of these modules is glue. Tracing packages count on both stacks alike.
SDK = {"inngest": r"^(inngest|@inngest/[^/]+)(/.*)?$", "langchain": r"^(@langchain/[^/]+|langsmith)(/.*)?$"}
# Measured as a ratio to the same stack's reference build (spec, Metrics: "(ratio)").
RATIOS = (
    ("size", "code_lines"), ("size", "comment_lines"), ("size", "files"), ("size", "modules"),
    ("glue", "glue_lines"), ("glue", "domain_lines"),
    ("type_escapes", "per_kloc"), ("ruleset", "per_kloc"),
)


def dependency_table(spec: str) -> dict[str, str]:
    """The build spec's `## Dependencies` table: package -> exact version. A cell may name several packages, with one
    version for all or one each."""
    section = re.search(r"^## Dependencies\n(.*?)(?=^## |\Z)", spec, re.S | re.M)
    table: dict[str, str] = {}
    for line in (section.group(1) if section else "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 2 or not cells[0].startswith("`"):
            continue
        names = re.findall(r"`([^`]+)`", cells[0])
        versions = [v.strip() for v in re.sub(r"\(.*?\)", "", cells[1]).split(",") if v.strip()]
        for i, name in enumerate(names):
            table[name] = versions[i] if len(versions) == len(names) else versions[0]
    return table


def threshold_names() -> list[str]:
    """The metric names the given night configs put under `thresholds:` and `gates:`: a build that writes one of them
    beside a number in its code has a threshold the config should set (Metrics, code checks)."""
    names = set()
    for config in sorted((ROOT / "configs").rglob("*.yaml")):
        block = False
        for line in config.read_text().splitlines():
            if re.match(r"^(thresholds|gates):\s*$", line):
                block = True
            elif block and (m := re.match(r"^\s+([A-Za-z_][A-Za-z0-9_]*)\s*:", line)):
                names.add(m.group(1))
            elif line.strip() and not line.startswith((" ", "#")):
                block = False
    return sorted(names)


def context(stack: str) -> dict:
    """What the container needs from the benchmark: the given inputs, the dependency table, the SDK."""
    given_dir = ROOT / "specs" / stack / "given"
    given_files = sorted(p.relative_to(given_dir).as_posix() for p in given_dir.rglob("*") if p.is_file())
    tsconfig = (given_dir / "tsconfig.json").read_bytes()
    return {
        "stack": stack,
        "given_dirs": list(SHARED),
        "given_files": [*given_files, *sorted(STUBS)],
        "agents_stub": AGENTS_STUB,
        "given_tsconfig": tsconfig.decode(),
        "given_tsconfig_sha256": hashlib.sha256(tsconfig).hexdigest(),
        "dependency_table": dependency_table((ROOT / "specs" / stack / "spec.md").read_text()),
        "sdk": SDK[stack],
        "threshold_names": threshold_names(),
    }


def image() -> str:
    """The analysis image, tagged by the digest of its inputs, built when missing."""
    digest = hashlib.sha256()
    for name in ("Dockerfile", "package.json", "package-lock.json", "eslint.measure.mjs", "eslint.ruleset.mjs", "measure.py"):
        digest.update(name.encode() + b"\0" + (ANALYSIS / name).read_bytes())
    tag = f"codeclimb-analysis:{digest.hexdigest()[:12]}"
    if subprocess.run(["docker", "image", "inspect", tag], capture_output=True).returncode != 0:
        subprocess.run(["docker", "build", "-q", "-t", tag, str(ANALYSIS)], check=True, stdout=subprocess.DEVNULL)
    return tag


def ratios(metrics: dict, reference: dict) -> dict:
    out = {}
    for group, key in RATIOS:
        mine, ref = (metrics.get(group) or {}).get(key), (reference.get(group) or {}).get(key)
        out[f"{group}.{key}"] = round(mine / ref, 3) if isinstance(mine, (int, float)) and ref else None
    return out


def measure(app: Path, stack: str, out: Path, reference: Path | None = None) -> dict:
    if stack not in STACKS:
        raise SystemExit(f"unknown stack {stack!r}: one of {', '.join(STACKS)}")
    app = app.resolve()
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "context.json").write_text(json.dumps(context(stack)))
        subprocess.run(
            ["docker", "run", "--rm", "-v", f"{app}:/app:ro", "-v", f"{tmp}:/io", image(),
             "python3", "/tools/measure.py", "/io/context.json", "/io/metrics.json"],
            check=True,
        )
        metrics = json.loads((Path(tmp) / "metrics.json").read_text())
    if reference is not None:
        metrics["reference"] = str(reference)
        metrics["ratios"] = ratios(metrics, json.loads(reference.read_text()))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(metrics, indent=2) + "\n")
    return metrics


def build_trials(job_dirs: list[Path]) -> list[tuple[Path, str]]:
    """The trials of build tasks (`tasks/codeclimb-<stack>`, not a maintenance task) whose `/app` was collected and
    that have no metrics file yet, with their stack."""
    out = []
    for job in job_dirs:
        for config in sorted(job.glob("*/config.json")):
            trial, cfg = config.parent, json.loads(config.read_text())
            if cfg.get("source_trial"):  # a regrade: its build is its source trial's, measured there
                continue
            task = Path((cfg.get("task") or {}).get("path") or "").name
            stack = task.removeprefix("codeclimb-")
            if stack in STACKS and (trial / "artifacts" / "app").is_dir() and not (trial / "code-metrics.json").exists():
                out.append((trial, stack))
    return out


def reference_metrics(stack: str, cache: Path) -> Path:
    """The metrics file of the stack's build-task pin (assemble.BUILD_PINS), measured once from its `git archive`."""
    from assemble import BUILD_PINS

    path = cache / f"{stack}-{BUILD_PINS[stack]}.json"
    if not path.exists():
        with tempfile.TemporaryDirectory() as tmp:
            archive = subprocess.run(["git", "-C", str(ROOT), "archive", BUILD_PINS[stack]], check=True,
                                     capture_output=True).stdout
            subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
            measure(Path(tmp), stack, path)
    return path


def measure_jobs(job_dirs: list[Path], cache: Path) -> int:
    """Measures every build trial of the jobs that has no metrics file yet, against its stack's pin. Returns the count of
    trials that failed; a failure is reported and the next trial goes on."""
    failed = 0
    for trial, stack in build_trials(job_dirs):
        try:
            measure(trial / "artifacts" / "app", stack, trial / "code-metrics.json", reference_metrics(stack, cache))
            print(f"ok {trial}")
        except (subprocess.CalledProcessError, OSError, ValueError) as e:
            failed += 1
            print(f"FAILED {trial}: {e}", file=sys.stderr)
    return failed


if __name__ == "__main__":
    if sys.argv[1:2] == ["jobs"]:
        # python3 code_metrics.py jobs <job dir>...: every build trial in them, the reference files cached in jobs/.
        sys.exit(1 if measure_jobs([Path(p) for p in sys.argv[2:]], ROOT / "jobs" / "reference-metrics") else 0)
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--stack", required=True, choices=STACKS)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--reference", type=Path)
    a = ap.parse_args()
    m = measure(a.app, a.stack, a.out, a.reference)
    json.dump({k: m[k] for k in ("size", "glue") if k in m}, sys.stdout)
    print()
