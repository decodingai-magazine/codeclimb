"""The code-quality judge (docs/codeclimb-eval-spec.md, Metrics): an LLM's yes/no answers to a short checklist about one
build, kept apart from the code checks. Each item has a deterministic check of its own, which is what the report leans
on; the judge answers the same question from the code, with evidence lines, for what a deterministic check cannot see.
Report only: never a check, never in `reward`. Off until it agrees with the operator on 5 builds (`agree`).

    python3 judge.py run --app <build dir> --stack <stack> --out <trial dir>/judge.json [--budget USD]
    python3 judge.py prompt --stack <stack>            # prints the prompt, no model call
    python3 judge.py agree <trial dir>...              # judge.json against the operator's judge-operator.json

The judge is Claude Code on Opus 5.5 at high effort (the operator's choice, 2026-11-19), on the operator's
subscription, with only the read tools (Read, Grep, Glob), no MCP server, no settings and no session kept, in a copy of
the build without `.env`, `node_modules`, `.git` and the runs folders. Every run spends the subscription: run it only
with the operator's go-ahead.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from assemble import STACKS

MODEL, EFFORT = "claude-opus-5-5", "high"
# (key, question, the deterministic check of the same item). A yes is the good answer for every item.
CHECKLIST = [
    ("durable-experiment",
     "Does every experiment (one coder session and the evaluation of its result) run inside a durable unit of the stack's"
     " runtime, so that after the runtime crashes and restarts, an experiment that had finished is not run again and"
     " one that was running resumes or reruns as one unit?",
     "the hidden durability tests (crash-mid-eval, crash-during-test-eval, kill-after-row, crash-resume)"),
    ("no-secrets-in-sandbox",
     "Is no provider key, token or other credential passed into a coder sandbox (its environment variables, its files"
     " or its mounts), the metering proxy's own address and token excepted?",
     "real.coder-sandbox-clean"),
    ("thresholds-from-config",
     "Are the night's thresholds and gates taken from the night config at run time, with no threshold or gate value"
     " written into the code?",
     "code_checks.hardcoded_thresholds in code-metrics.json"),
]
SKIP = {".env", "node_modules", ".git", ".venv", "generated", "__pycache__", ".next"}


def schema() -> dict:
    item = {"type": "object", "additionalProperties": False, "required": ["answer", "evidence", "why"],
            "properties": {"answer": {"type": "boolean"},
                           "evidence": {"type": "array", "items": {"type": "string"}},
                           "why": {"type": "string"}}}
    return {"type": "object", "additionalProperties": False, "required": [k for k, _, _ in CHECKLIST],
            "properties": {k: item for k, _, _ in CHECKLIST}}


def prompt(stack: str) -> str:
    items = "\n".join(f"- `{k}`: {q}" for k, q, _ in CHECKLIST)
    return (
        f"You are reviewing a build of CodeClimb on the {stack} stack, in the current directory. `SPEC.md` is the build"
        " spec it was built from. Read the code (not the tests alone) and answer each question below with yes or no."
        " Answer from what the code does, not from comments or the README. For each, give the evidence: the"
        " `path:line` places that decide the answer (for a no, the places where it fails), and one or two sentences"
        f" on why. Run nothing; only read.\n\n{items}\n"
    )


def copy_build(app: Path, dest: Path) -> None:
    shutil.copytree(app, dest, symlinks=True, dirs_exist_ok=True,
                    ignore=lambda d, names: {n for n in names if n in SKIP or n.startswith("runs-")})


def run(app: Path, stack: str, out: Path, budget: str = "5") -> dict:
    if stack not in STACKS:
        raise SystemExit(f"unknown stack {stack!r}")
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")}
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "app"
        copy_build(app, work)
        cmd = ["claude", "-p", prompt(stack), "--model", MODEL, "--effort", EFFORT, "--output-format", "json",
               "--json-schema", json.dumps(schema()), "--allowedTools", "Read,Grep,Glob",
               "--disallowedTools", "Bash,Edit,Write,WebFetch,WebSearch,Task", "--strict-mcp-config",
               "--setting-sources", "", "--no-session-persistence", "--max-budget-usd", budget]
        proc = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=3600)
    result = json.loads(proc.stdout) if proc.stdout.strip().startswith("{") else {}
    answers = result.get("structured_output")
    if answers is None and isinstance(result.get("result"), str):
        try:
            answers = json.loads(result["result"])
        except ValueError:
            answers = None
    judged = {
        "model": MODEL, "effort": EFFORT, "checklist": {k: {"question": q, "deterministic_check": c} for k, q, c in CHECKLIST},
        "answers": answers, "cost_usd": result.get("total_cost_usd"), "error": None if answers else (proc.stderr[-2000:] or result.get("result")),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(judged, indent=2) + "\n")
    return judged


def agree(trials: list[Path]) -> dict:
    """Per item and per build, whether the judge's answer equals the operator's (`judge-operator.json`: {item: true |
    false}). The judge is on once it agrees on every item of at least 5 builds and disagrees on none."""
    builds, per_item = {}, {k: [0, 0] for k, _, _ in CHECKLIST}
    for t in trials:
        try:
            mine = json.loads((t / "judge.json").read_text())["answers"] or {}
            theirs = json.loads((t / "judge-operator.json").read_text())
        except (OSError, ValueError, KeyError):
            continue
        same = {k: (mine.get(k) or {}).get("answer") == theirs.get(k) for k, _, _ in CHECKLIST if k in theirs}
        builds[str(t)] = all(same.values()) and len(same) == len(CHECKLIST)
        for k, ok in same.items():
            per_item[k][0 if ok else 1] += 1
    return {"builds": builds, "per_item": {k: {"agree": a, "disagree": d} for k, (a, d) in per_item.items()},
            "on": sum(builds.values()) >= 5 and all(builds.values())}


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["prompt"]:
        print(prompt(args[args.index("--stack") + 1]))
    elif args[:1] == ["agree"]:
        print(json.dumps(agree([Path(a) for a in args[1:]]), indent=2))
    elif args[:1] == ["run"]:
        get = lambda f, d=None: args[args.index(f) + 1] if f in args else d  # noqa: E731
        j = run(Path(get("--app")), get("--stack"), Path(get("--out")), get("--budget", "5"))
        print(json.dumps({"answers": {k: (v or {}).get("answer") for k, v in (j["answers"] or {}).items()},
                          "cost_usd": j["cost_usd"], "error": j["error"]}))
    else:
        sys.exit(__doc__)
