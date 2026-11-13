"""Job dirs -> trials.jsonl -> 2 x 2 effects (docs/codeclimb-eval-spec.md, Metrics). So far: the lever counts.

    python3 analyze.py counts <trajectory.json>...     # skill, MCP and doc-fetch calls per trajectory

A trajectory is Harbor's agent/trajectory.json: steps whose tool_calls name a function_name.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

# The MCP tools that search or read docs, per server; every other tool of a server is a platform tool.
# inngest-dev's three, measured in the #48 smoke trial (52 tools in all). A server listed with None is docs only.
DOCS_TOOLS: dict[str, frozenset[str] | None] = {
    "inngest-dev": frozenset({"grep_docs", "list_docs", "read_doc"}),
    "langchain-docs": None,
}
FETCH = re.compile(r"\b(curl|wget)\b[^|;&]*?https?://(?!(?:127\.0\.0\.1|localhost|0\.0\.0\.0)[:/])")


def lever_counts(trajectory: dict) -> dict[str, int]:
    """skill: Skill calls; mcp_platform / mcp_docs: MCP calls; web_fetch, web_search; bash_fetch: curl or wget of a
    non-local URL in a Bash command (a doc fetch past WebFetch)."""
    c: Counter[str] = Counter()
    for step in trajectory.get("steps", []):
        for call in step.get("tool_calls") or []:
            name = call.get("function_name", "")
            args = call.get("arguments") or {}
            if name == "Skill":
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
    return {k: c[k] for k in ("skill", "mcp_platform", "mcp_docs", "web_fetch", "web_search", "bash_fetch")}


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] != "counts":
        raise SystemExit(__doc__)
    for path in sys.argv[2:]:
        print(json.dumps({"trajectory": path, **lever_counts(json.loads(Path(path).read_text()))}))
