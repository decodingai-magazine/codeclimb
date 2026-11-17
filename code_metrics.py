"""The code and practice analysis step: one build -> one metrics file (docs/codeclimb-eval-spec.md, Metrics).

    python3 code_metrics.py --app <build dir> --stack <inngest|langchain> --out <trial dir>/code-metrics.json
                            [--reference <the stack's reference metrics.json>]

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

ROOT = Path(__file__).resolve().parent
ANALYSIS = ROOT / "analysis"
STACKS = ("inngest", "langchain")
SHARED = ("scenarios", "configs", "docker")
STUBS = ("SPEC.md", "E2E.md", "AGENTS.md", "LICENSE")
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


def context(stack: str) -> dict:
    """What the container needs from the benchmark: the given inputs, the dependency table, the SDK."""
    given_dir = ROOT / "specs" / stack / "given"
    given_files = sorted(p.relative_to(given_dir).as_posix() for p in given_dir.rglob("*") if p.is_file())
    tsconfig = (given_dir / "tsconfig.json").read_bytes()
    return {
        "stack": stack,
        "given_dirs": list(SHARED),
        "given_files": [*given_files, *STUBS],
        "agents_stub": (ROOT / "tasks/shared/instruction.md").read_text().splitlines()[0] + "\n",
        "given_tsconfig": tsconfig.decode(),
        "given_tsconfig_sha256": hashlib.sha256(tsconfig).hexdigest(),
        "dependency_table": dependency_table((ROOT / "specs" / stack / "spec.md").read_text()),
        "sdk": SDK[stack],
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--app", type=Path, required=True)
    ap.add_argument("--stack", required=True, choices=STACKS)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--reference", type=Path)
    a = ap.parse_args()
    m = measure(a.app, a.stack, a.out, a.reference)
    json.dump({k: m[k] for k in ("size", "glue") if k in m}, sys.stdout)
    print()
