"""Build a task's /app from files on this branch only.

    python3 assemble.py <stack> [--pile <dir>]     # inngest | langchain; --pile: another pile of build tickets
    python3 assemble.py maintenance <task> <stack> [--pocock]  # a maintenance task: tasks/codeclimb-<stack>-<task>/

Writes tasks/codeclimb-<stack>/environment/app/ (gitignored): the shared given inputs,
specs/<stack>/given/, SPEC.md (the build spec, wikilinks flattened), E2E.md and an
AGENTS.md stub. Also copies the parts both tasks share into the task, so each exists
once on the branch: tasks/shared/instruction.md -> instruction.md, verifier/blocked_hosts.py's deny rules ->
environment/managed-settings.json, verifier/ -> tests/verifier/ plus the leak scan's given.json, and the pocock
workflow's files -> tasks/codeclimb-<stack>/pocock/ (all gitignored). Records the sha256 of SPEC.md, of the given
inputs, of the pile and of the pocock files in tasks/codeclimb-<stack>/assembled.json. Fails, naming each string and file, when
the output holds a string that would tell the harness where it is.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "verifier"))

from blocked_hosts import managed_settings  # noqa: E402
from leak import given_record  # noqa: E402

from gate import fix_size
from maintenance import ASK, MAINTENANCE, RUNS_DIRS, SERVICES as MAINTENANCE_SERVICES, Maintenance

STACKS = ("inngest", "langchain")
# The shared given inputs, in every /app.
SHARED = ("scenarios", "configs", "docker")

INSTRUCTION = ROOT / "tasks/shared/instruction.md"
# The build tasks' fake Pi Copilot login (#71, docs/codeclimb-eval-spec.md, Trial environment): the shape of a real
# `github-copilot` entry with fake tokens, the models of the given configs, and an expiry far ahead, so Pi neither
# refreshes it nor finds it missing. A build's model check passes on it; the first model call fails (GitHub is
# blocked in a trial, and Copilot rejects the token). Written to environment/pi-auth.json; FAKE_PI_LOGIN, in both
# build Dockerfiles, copies it in. Maintenance tasks drop both: their trials ran without it.
FAKE_PI_AUTH = {"github-copilot": {"type": "oauth", "refresh": "fake-refresh-token-no-login", "access": "fake-access-token-no-login",
                                   "expires": 4102444800000, "availableModelIds": ["claude-haiku-4.5", "claude-haiku-5.5"]}}
FAKE_PI_LOGIN = ("# A fake Pi Copilot login at Pi's default path (assemble.py, FAKE_PI_LOGIN; #71): fake tokens, so a night without\n"
                 "# --mock passes its model check and fails at its first model call. The verifier's container gets the real login.\n"
                 "COPY --chmod=600 pi-auth.json /root/.pi/agent/auth.json\n")
VERIFIER = ROOT / "verifier"
POCOCK = ROOT / "context" / "pocock"
# One line, no guidance: every arm gets the same stub, the instruction's canary line.
AGENTS_STUB = INSTRUCTION.read_text().splitlines()[0] + "\n"

# The stack's external services, running before the harness starts (the task's docker-compose.yaml), for the
# instruction's "What you have" list. The verifier starts its own.
SERVICES = {
    "inngest": "- the Inngest dev server, already running at `http://127.0.0.1:8288`, started as `npm run dev:inngest`"
    " starts it. It keeps running for the whole session: use it, don't start another\n",
    "langchain": "",
}

# The files the benchmark writes into every build /app beside the given inputs.
STUBS = frozenset({"SPEC.md", "E2E.md", "AGENTS.md"})

# The build tasks' reference pins (docs/codeclimb-eval-spec.md, "Reference builds"): the maintenance base
# (maintenance.BASES) with the C7 and C6 patches on top. job-configs/reference.sh defaults to them.
BUILD_PINS = {"inngest": "5a81c07", "langchain": "3612892"}

# Forbidden in every file of /app. The reference builds' commits, by 7-char prefix:
# update them when a reference is re-pinned (docs/codeclimb-eval-spec.md, "Reference builds").
# The maintenance tasks' commits and patches (maintenance.py) are reference commits too, and so are the build pins and
# the C7 commits under them (5c7150b, 5ac7f82).
EVERYWHERE = ("e384bb5", "bce6a16", "bab033e", "4a71177", "0c395fd", "2ab1ad3", "bcabd72", "400bd40", "9567643",
              "1452a93", "1360cb4", "9d04590", "9911231", "f76da25", "c3a1ec3", "2c8eaa7", "3f7793d",
              "5a81c07", "3612892", "5c7150b", "5ac7f82", "b16f688", "87fa4a1", "bc1ab93", "5901318", "b15c8e1", "9e18335", "a755560", "9d70972", "d69493f", "df40257",
              "01-Projects", "codeclimb-eval-spec")
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

# A maintenance task's /app leaves out the reference's own guidance (docs/codeclimb-eval-spec.md, "Maintenance tasks").
GUIDANCE = ("AGENTS.md", ".mcp.json", ".claude", "notes")
# Per workflow, as for build tasks: one-shot also drops all of docs/ and the glossary; pocock keeps the glossary and the
# docs its skills write (docs/adr/, docs/agents/), never a spec copy.
WORKFLOW_DROPS = {
    "one-shot": GUIDANCE + ("docs", "GLOSSARY.md", "CONTEXT.md"),
    "pocock": GUIDANCE,
}
POCOCK_DOCS = ("docs/adr/", "docs/agents/")
# The one fresh commit of a maintenance /app: the image's identity and a fixed date, so a rebuild is identical.
COMMIT_ENV = {
    "GIT_AUTHOR_NAME": "codeclimb", "GIT_AUTHOR_EMAIL": "codeclimb@localhost",
    "GIT_COMMITTER_NAME": "codeclimb", "GIT_COMMITTER_EMAIL": "codeclimb@localhost",
    "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
}

MAINTENANCE_TEMPLATE = ROOT / "tasks/shared/maintenance.md"
# The build task's image commits the /app it copies; a maintenance /app already holds its one commit.
IMAGE_COMMIT = 'RUN git init -q && git add -A && git commit -q -m "given inputs"\n'

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


def assemble_pocock(stack: str, out: Path, pile: Path | None = None) -> dict[str, str]:
    """The pocock workflow's files for /app, in `out`: the stack's pile at .scratch/codeclimb/issues/ with the spec
    path rewritten to SPEC.md and nothing else changed, the setup skill's docs/agents/ and the AGENTS.md stub with
    its `## Agent skills` block. A trial copies `out` into its /app before the harness starts."""
    pile = pile or ROOT / "specs" / stack / "tickets"
    spec_ref = f"specs/{stack}/spec.md"
    stage = Path(tempfile.mkdtemp(prefix=".pocock-", dir=out.parent if out.parent.exists() else None))
    try:
        issues = stage / ".scratch" / "codeclimb" / "issues"
        for rel in branch_files(pile):
            (issues / rel).parent.mkdir(parents=True, exist_ok=True)
            (issues / rel).write_text((pile / rel).read_text().replace(spec_ref, "SPEC.md"))
        copy_files(POCOCK / "scaffold" / "docs", stage / "docs")
        (stage / "AGENTS.md").write_text(AGENTS_STUB + (POCOCK / "scaffold" / "agent-skills-block.md").read_text())
        found = [
            f"{p.relative_to(stage).as_posix()}: {t}"
            for p in sorted(stage.rglob("*")) if p.is_file()
            for t in forbidden_terms(p.read_text(), authored=True)
        ]
        if found:
            raise ForbiddenString("forbidden strings in the pocock files:\n  " + "\n  ".join(found))
        record = {"pile_sha256": tree_sha256(pile), "pocock_files_sha256": tree_sha256(stage)}
        if out.exists():
            shutil.rmtree(out)
        stage.rename(out)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return record


@dataclass(frozen=True)
class Source:
    """Where a maintenance /app comes from: its stack, the repository holding the reference commits, and the workflow
    whose rule decides what the /app leaves out."""

    stack: str
    repo: Path = ROOT
    workflow: str = "one-shot"

    def __post_init__(self) -> None:
        if self.stack not in STACKS:
            raise SystemExit(f"unknown stack {self.stack!r}: one of {', '.join(STACKS)}")
        if self.workflow not in WORKFLOW_DROPS:
            raise ValueError(f"unknown workflow {self.workflow!r}: one of {', '.join(WORKFLOW_DROPS)}")


def assemble_maintenance_app(src: Source, commit: str, out: Path, incident: Path | None = None) -> dict[str, str]:
    """A maintenance task's /app in `out`: the `git archive` of `commit` without the reference's guidance files
    (WORKFLOW_DROPS; pocock also drops every file under docs/ outside docs/adr/ and docs/agents/),
    plus SPEC.md and the AGENTS.md stub, as a fresh repository with one commit (neither `git log` nor `git diff`
    shows the change)."""
    stack, workflow = src.stack, src.workflow
    out.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".app-", dir=out.parent))
    try:
        archive = subprocess.run(["git", "-C", str(src.repo), "archive", commit], check=True, capture_output=True).stdout
        subprocess.run(["tar", "-x", "-C", str(stage)], input=archive, check=True)
        for rel in WORKFLOW_DROPS[workflow]:
            p = stage / rel
            if p.is_dir():
                shutil.rmtree(p)
            elif p.exists():
                p.unlink()
        if workflow == "pocock" and (stage / "docs").is_dir():
            for p in sorted((stage / "docs").rglob("*")):
                if p.is_file() and not p.relative_to(stage).as_posix().startswith(POCOCK_DOCS):
                    p.unlink()
        (stage / "SPEC.md").write_text(flatten_wikilinks((ROOT / "specs" / stack / "spec.md").read_text()))
        (stage / "AGENTS.md").write_text(AGENTS_STUB)
        if incident is not None:
            shutil.copytree(incident, stage / "incident")
        found = [
            f"{p.relative_to(stage).as_posix()}: {t}"
            for p in sorted(stage.rglob("*")) if p.is_file()
            for t in forbidden_terms(p.read_bytes().decode("utf-8", "replace"), p.relative_to(stage).as_posix() in STUBS)
        ]
        if found:
            raise ForbiddenString("forbidden strings in the maintenance /app:\n  " + "\n  ".join(found))
        subprocess.run(["git", "init", "-q", "-b", "main", str(stage)], check=True)
        if not (stage / ".git").is_dir():
            raise RuntimeError(f"git init made no repository in {stage}")
        env = {**os.environ, **COMMIT_ENV}
        subprocess.run(["git", "-C", str(stage), "add", "-A"], check=True, env=env)
        subprocess.run(["git", "-C", str(stage), "commit", "-q", "--no-gpg-sign", "-m", "initial commit"],
                       check=True, env=env)
        record = {"stack": stack, "commit": commit, "workflow": workflow, "spec_sha256": sha256_bytes((stage / "SPEC.md").read_bytes())}
        if out.exists():
            shutil.rmtree(out)
        stage.rename(out)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return record


def maintenance_prompt(stack: str, task: Maintenance) -> str:
    """The task's instruction: one template for both stacks, filled with the request or symptom, the runs folder and
    the service commands. It never names a test."""
    return MAINTENANCE_TEMPLATE.read_text().format(
        canary=AGENTS_STUB.rstrip("\n"), ask=ASK[task.kind], request=task.request, runs=RUNS_DIRS[stack],
        services=MAINTENANCE_SERVICES[stack],
    )


def assemble_maintenance_task(task_id: str, src: Source, task: Maintenance | None = None,
                              tasks_dir: Path = ROOT / "tasks") -> Path:
    """tasks/codeclimb-<stack>-<task id>/ (gitignored): the stack's build task with the maintenance /app baked in,
    its prompt, and the leak baseline taken from that /app. Returns the folder."""
    task = task or MAINTENANCE[task_id]
    d = tasks_dir / f"codeclimb-{src.stack}-{task_id}"
    if d.exists():
        shutil.rmtree(d)
    try:
        _write_maintenance_task(d, task_id, task, src)
    except BaseException:
        shutil.rmtree(d, ignore_errors=True)
        raise
    return d


def _write_maintenance_task(d: Path, task_id: str, task: Maintenance, src: Source) -> None:
    stack = src.stack
    build = ROOT / "tasks" / f"codeclimb-{stack}"
    for part in ("environment", "tests"):
        copy_files(build / part, d / part)
    dockerfile = d / "environment" / "Dockerfile"
    text = dockerfile.read_text()
    if IMAGE_COMMIT not in text:
        raise RuntimeError(f"{dockerfile}: no {IMAGE_COMMIT!r} line to replace")
    if FAKE_PI_LOGIN not in text:
        raise RuntimeError(f"{dockerfile}: no fake Pi login block to drop")
    text = text.replace(FAKE_PI_LOGIN, "")
    (d / "environment" / "pi-auth.json").unlink(missing_ok=True)
    dockerfile.write_text(text.replace(IMAGE_COMMIT, "# /app arrives as a repository with one commit (assemble.py).\n"))
    toml = (build / "task.toml").read_text()
    toml = toml.replace(f'name = "codeclimb/codeclimb-{stack}"', f'name = "codeclimb/{d.name}"')
    toml = re.sub(r'(?m)^description = .*$', f'description = "Maintenance task {task_id} ({task.kind}) on the {stack} reference build."', toml)
    (d / "task.toml").write_text(toml)
    app = d / "environment" / "app"
    incident = ROOT / task.incident / stack if task.incident else None
    record = assemble_maintenance_app(src, task.commits[stack], app, incident)
    prompt = maintenance_prompt(stack, task)
    found = forbidden_terms(prompt, authored=True)
    if found:
        raise ForbiddenString(f"forbidden strings in the {task_id} prompt: {found}")
    (d / "instruction.md").write_text(prompt)
    (d / "environment" / "managed-settings.json").write_text(json.dumps(managed_settings(), indent=2) + "\n")
    copy_files(VERIFIER, d / "tests" / "verifier")
    given = given_record(app)
    (d / "tests" / "verifier" / "given.json").write_text(json.dumps(given, indent=1, sort_keys=True) + "\n")
    record = {"kind": task.kind, "task": task_id, "base": task.bases[stack], "targets": list(task.targets),
              "fix": fix_size(task.bases[stack], task.commits[stack], src.repo)[0], **record}
    (d / "assembled.json").write_text(json.dumps(record, indent=2) + "\n")


def assemble_task(stack: str, pile: Path | None = None) -> dict[str, str]:
    task = ROOT / "tasks" / f"codeclimb-{stack}"
    record = assemble(stack, task / "environment" / "app")
    # The pocock workflow's files, outside the image's build context: a job overlay copies them into /app.
    record |= assemble_pocock(stack, task / "pocock", pile)
    (task / "assembled.json").write_text(json.dumps(record, indent=2) + "\n")
    (task / "instruction.md").write_text(INSTRUCTION.read_text().replace("{services}\n", SERVICES[stack]))
    (task / "environment" / "managed-settings.json").write_text(json.dumps(managed_settings(), indent=2) + "\n")
    (task / "environment" / "pi-auth.json").write_text(json.dumps(FAKE_PI_AUTH, indent=2) + "\n")
    if (task / "tests" / "verifier").exists():
        shutil.rmtree(task / "tests" / "verifier")
    copy_files(VERIFIER, task / "tests" / "verifier")
    # The leak scan's baseline: each given file's sha256 and the blocked names it holds.
    given = given_record(task / "environment" / "app")
    (task / "tests" / "verifier" / "given.json").write_text(json.dumps(given, indent=1, sort_keys=True) + "\n")
    return record


if __name__ == "__main__":
    if sys.argv[1:2] == ["maintenance"] and len(sys.argv) in (4, 5) and sys.argv[4:] in ([], ["--pocock"]):
        try:
            src = Source(sys.argv[3], workflow="pocock" if sys.argv[4:] else "one-shot")
            print(assemble_maintenance_task(sys.argv[2], src).relative_to(ROOT))
        except ForbiddenString as e:
            raise SystemExit(str(e))
        raise SystemExit(0)
    if len(sys.argv) not in (2, 4) or (len(sys.argv) == 4 and sys.argv[2] != "--pile"):
        raise SystemExit(__doc__)
    try:
        result = assemble_task(sys.argv[1], Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else None)
    except ForbiddenString as e:
        raise SystemExit(str(e))
    print(json.dumps(result, indent=2))
