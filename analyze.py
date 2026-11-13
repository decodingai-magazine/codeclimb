"""Job dirs -> trials.jsonl -> 2 x 2 effects (docs/codeclimb-eval-spec.md, Metrics). So far: the lever counts.

    python3 analyze.py counts <trajectory.json>...     # skill, MCP and doc-fetch calls per trajectory
    python3 analyze.py pile <app artifact dir>...       # pocock: tickets, tickets done, commits

A trajectory is Harbor's agent/trajectory.json: steps whose tool_calls name a function_name.
"""

import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

# The MCP tools that search or read docs, per server; every other tool of a server is a platform tool.
# inngest-dev's three, measured in the #48 smoke trial (52 tools in all). A server listed with None is docs only.
DOCS_TOOLS: dict[str, frozenset[str] | None] = {
    "inngest-dev": frozenset({"grep_docs", "list_docs", "read_doc"}),
    "langchain-docs": None,
}
# The pocock workflow's skills (context/pocock/skills/): counted per name, apart from the skills lever.
WORKFLOW_SKILLS = frozenset(
    {"implement", "tdd", "code-review", "diagnosing-bugs", "research", "domain-modeling", "codebase-design", "prototype"}
)
STATUS = re.compile(r"^\*\*Status:\*\*\s*(\S+)", re.MULTILINE)
FETCH = re.compile(r"\b(curl|wget)\b[^|;&]*?https?://(?!(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[:/])")


def lever_counts(trajectory: dict) -> dict:
    """skill: Skill calls outside the workflow's skills; workflow_skills: those calls per skill name;
    mcp_platform / mcp_docs: MCP calls; web_fetch, web_search; bash_fetch: curl or wget of a non-local URL in a
    Bash command (a doc fetch past WebFetch)."""
    c: Counter[str] = Counter()
    workflow: Counter[str] = Counter()
    for step in trajectory.get("steps", []):
        for call in step.get("tool_calls") or []:
            name = call.get("function_name", "")
            args = call.get("arguments") or {}
            if name == "Skill":
                skill = str(args.get("skill", "")).split(":")[-1]
                if skill in WORKFLOW_SKILLS:
                    workflow[skill] += 1
                else:
                    c["skill"] += 1
            elif name.startswith("mcp__"):
                server, _, tool = name[len("mcp__"):].partition("__")
                docs = DOCS_TOOLS.get(server, frozenset())
                c["mcp_docs" if docs is None or tool in docs else "mcp_platform"] += 1
            elif name == "WebFetch":
                c["web_fetch"] += 1
            elif name == "WebSearch":
                c["web_search"] += 1
            elif name == "Bash" and FETCH.search(str(args.get("command", ""))):
                c["bash_fetch"] += 1
    counts: dict = {k: c[k] for k in ("skill", "mcp_platform", "mcp_docs", "web_fetch", "web_search", "bash_fetch")}
    counts["workflow_skills"] = dict(sorted(workflow.items()))
    return counts


def pile_progress(app: Path) -> dict[str, int]:
    """The pocock workflow's progress in a trial's /app artifact: tickets in .scratch/codeclimb/issues/ (README.md
    excluded), those set to done, and the commits after the given-inputs commit."""
    tickets = [p for p in sorted((app / ".scratch/codeclimb/issues").glob("*.md")) if p.name != "README.md"]
    done = sum(1 for p in tickets if (m := STATUS.search(p.read_text())) and m.group(1) == "done")
    log = subprocess.run(["git", "-C", str(app), "rev-list", "--count", "HEAD"], capture_output=True, text=True)
    commits = int(log.stdout.strip()) - 1 if log.returncode == 0 else -1
    return {"tickets": len(tickets), "tickets_done": done, "commits": commits}


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("counts", "pile"):
        raise SystemExit(__doc__)
    for path in sys.argv[2:]:
        if sys.argv[1] == "counts":
            print(json.dumps({"trajectory": path, **lever_counts(json.loads(Path(path).read_text()))}))
        else:
            print(json.dumps({"app": path, **pile_progress(Path(path))}))
