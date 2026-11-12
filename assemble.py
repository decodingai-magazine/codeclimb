"""Build a task's /app from files on this branch only.

    python3 assemble.py <stack>     # inngest | langchain

Writes tasks/codeclimb-<stack>/environment/app/ (gitignored): the shared given inputs,
specs/<stack>/given/, SPEC.md (the build spec, wikilinks flattened), E2E.md and an
AGENTS.md stub. Also copies the parts both tasks share into the task, so each exists
once on the branch: tasks/shared/instruction.md -> instruction.md, verifier/ ->
tests/verifier/ (both gitignored). Records the sha256 of SPEC.md, of the given inputs and of the pile
in tasks/codeclimb-<stack>/assembled.json. Fails, naming each string and file, when
the output holds a string that would tell the harness where it is.
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STACKS = ("inngest", "langchain")
SHARED = ("scenarios", "configs", "docker")

INSTRUCTION = ROOT / "tasks/shared/instruction.md"
VERIFIER = ROOT / "verifier"
# One line, no guidance: every arm gets the same stub, the instruction's canary line.
AGENTS_STUB = INSTRUCTION.read_text().splitlines()[0] + "\n"

STUBS = frozenset({"SPEC.md", "E2E.md", "AGENTS.md"})

# Forbidden in every file of /app. The reference builds' commits, by 7-char prefix:
# update them when a reference is re-pinned (docs/codeclimb-eval-spec.md, "Reference builds").
EVERYWHERE = ("e384bb5", "bce6a16", "01-Projects", "codeclimb-eval-spec")
# Forbidden only in the files the benchmark writes (SPEC.md, E2E.md, AGENTS.md,
# specs/<stack>/given/). The shared given inputs are vendored unchanged, and the
# graphrag corpus discusses benchmarks and names skill authors.
AUTHORED_ONLY = (
    "benchmark",
    "pocock",
    "langchain-skills",
    "langsmith-skills",
    "langchain-mcp",
    "langsmith-mcp",
    "langchain-docs",
    "inngest-dev",
)

WIKILINK = re.compile(r"\[\[([^\]|\\]*)(?:\\?\|([^\]]*))?\]\]")


class ForbiddenString(Exception):
    pass


def flatten_wikilinks(text: str) -> str:
    """[[note|alias]] -> alias, [[#Section]] -> Section, [[note#Section]] -> Section."""

    def plain(m: re.Match[str]) -> str:
        if m.group(2) is not None:
            return m.group(2)
        return m.group(1).rsplit("#", 1)[-1]

    return WIKILINK.sub(plain, text)


def forbidden_terms(text: str, authored: bool) -> list[str]:
    lower = text.lower()
    terms = EVERYWHERE + (AUTHORED_ONLY if authored else ())
    return [t for t in terms if t.lower() in lower]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tree_sha256(path: Path, skip: frozenset[str] = frozenset()) -> str:
    """sha256 over the sorted `<relative path> <file sha256>` lines of a tree."""
    lines = sorted(
        f"{p.relative_to(path).as_posix()} {sha256_bytes(p.read_bytes())}\n"
        for p in path.rglob("*")
        if p.is_file() and p.relative_to(path).as_posix() not in skip
    )
    return sha256_bytes("".join(lines).encode())


def branch_files(path: Path) -> list[str]:
    """Files under `path` that are on the branch or about to be: tracked, or untracked and not ignored.
    Ignored files (.env, node_modules/, __pycache__/) never reach /app."""
    out = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "."],
        cwd=path, check=True, capture_output=True, text=True,
    ).stdout
    return sorted({f for f in out.split("\0") if f and (path / f).is_file()})


def copy_files(src: Path, dst: Path) -> list[str]:
    files = branch_files(src)
    for rel in files:
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / rel, dst / rel)
    return files


def assemble(stack: str, out: Path, spec_path: Path | None = None, record_path: Path | None = None) -> dict[str, str]:
    """Build `out`; write the record to `record_path` (default: the task folder, two levels above `out`)."""
    if stack not in STACKS:
        raise SystemExit(f"unknown stack {stack!r}: one of {', '.join(STACKS)}")
    stack_dir = ROOT / "specs" / stack
    spec_path = spec_path or stack_dir / "spec.md"

    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".app-", dir=out.parent))
    try:
        for shared in SHARED:
            copy_files(ROOT / shared, stage / shared)
        authored = STUBS | set(copy_files(stack_dir / "given", stage))
        (stage / "SPEC.md").write_text(flatten_wikilinks(spec_path.read_text()))
        shutil.copyfile(stack_dir / "e2e.md", stage / "E2E.md")
        (stage / "AGENTS.md").write_text(AGENTS_STUB)

        found = []
        for p in sorted(stage.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(stage).as_posix()
            terms = forbidden_terms(p.read_bytes().decode("utf-8", "replace"), rel in authored)
            found += [f"{rel}: {t}" for t in terms]
        if found:
            raise ForbiddenString("forbidden strings in the assembled /app:\n  " + "\n  ".join(found))

        record = {
            "stack": stack,
            "spec_sha256": sha256_bytes((stage / "SPEC.md").read_bytes()),
            "given_inputs_sha256": tree_sha256(stage, skip=STUBS),
            "pile_sha256": tree_sha256(stack_dir / "tickets"),
        }
        if out.exists():
            shutil.rmtree(out)
        stage.rename(out)
    finally:
        if stage.exists():
            shutil.rmtree(stage)

    (record_path or out.parent.parent / "assembled.json").write_text(json.dumps(record, indent=2) + "\n")
    return record


def assemble_task(stack: str) -> dict[str, str]:
    task = ROOT / "tasks" / f"codeclimb-{stack}"
    record = assemble(stack, task / "environment" / "app")
    shutil.copyfile(INSTRUCTION, task / "instruction.md")
    if (task / "tests" / "verifier").exists():
        shutil.rmtree(task / "tests" / "verifier")
    copy_files(VERIFIER, task / "tests" / "verifier")
    return record


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    try:
        result = assemble_task(sys.argv[1])
    except ForbiddenString as e:
        raise SystemExit(str(e))
    print(json.dumps(result, indent=2))
