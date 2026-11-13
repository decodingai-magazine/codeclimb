"""The leak scan: did the harness touch a blocked host or the repo, by any route?

What the harness did counts, not what it read: the given inputs name github.com and the repo owner themselves.
- the session files (`<agent logs>/sessions/projects/**/*.jsonl`, subagents included): every tool call's input
  (a fetch, a search query, a shell command such as `docker run`, a file written or edited, an MCP call), and the
  result of every web search (a result that links a blocked host)
- `/app`: a file the harness wrote that names one. A given file counts only if it now names one more often
  than as given (`given.json`, written by assemble.py: per given file, its sha256 and its names)

A hit sets `leak` = 1; the trial keeps its reward and is reported apart.
"""

import hashlib
import json
from collections import Counter
from pathlib import Path

from blocked_hosts import names_in

# Not the harness's own writing: installs, the runs folders, the scenario generator's output, the verifier's .env.
SKIP_DIRS = frozenset(
    {".git", "node_modules", "runs-inngest", "runs-langchain", "generated", ".venv", "__pycache__", ".ruff_cache"}
)
SKIP_FILES = frozenset({".env"})
MAX_BYTES = 5_000_000
SEARCH_TOOLS = frozenset({"WebSearch"})


def text_of(content: object) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False)


def session_hits(agent_logs: Path) -> tuple[list[str], int]:
    """(hits, session files read). A hit reads `<file>: <tool> <input|result>: <name>`."""
    hits: list[str] = []
    files = sorted((agent_logs / "sessions" / "projects").rglob("*.jsonl"))
    for f in files:
        tools: dict[str, str] = {}
        for line in f.read_text(errors="replace").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            message = event.get("message") if isinstance(event, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use":
                    name = str(block.get("name"))
                    tools[str(block.get("id"))] = name
                    hits += [f"{f.name}: {name} input: {n}" for n in names_in(text_of(block.get("input")))]
                elif block.get("type") == "tool_result":
                    name = tools.get(str(block.get("tool_use_id")), "")
                    if name in SEARCH_TOOLS:
                        hits += [f"{f.name}: {name} result: {n}" for n in names_in(text_of(block.get("content")))]
    return hits, len(files)


def app_files(app: Path) -> list[Path]:
    out = []
    for p in sorted(app.rglob("*")):
        rel = p.relative_to(app)
        if SKIP_DIRS.intersection(rel.parts[:-1]) or p.name in SKIP_FILES or not p.is_file() or p.is_symlink():
            continue
        if p.stat().st_size <= MAX_BYTES:
            out.append(p)
    return out


def app_hits(app: Path, given: dict[str, dict[str, object]]) -> list[str]:
    hits = []
    for p in app_files(app):
        rel = p.relative_to(app).as_posix()
        data = p.read_bytes()
        base = given.get(rel)
        if base is not None and base["sha256"] == hashlib.sha256(data).hexdigest():
            continue
        found = Counter(names_in(data.decode("utf-8", errors="replace")))
        allowed = Counter(base["names"]) if base is not None else Counter()
        hits += [f"/app/{rel}: {n} x{c - allowed[n]}" for n, c in sorted(found.items()) if c > allowed[n]]
    return hits


def given_record(app: Path) -> dict[str, dict[str, object]]:
    """For assemble.py: each given file's sha256 and its blocked names."""
    out = {}
    for p in app_files(app):
        data = p.read_bytes()
        names = Counter(names_in(data.decode("utf-8", errors="replace")))
        out[p.relative_to(app).as_posix()] = {"sha256": hashlib.sha256(data).hexdigest(), "names": dict(names)}
    return out


def scan(app: Path, agent_logs: Path, given: dict[str, dict[str, object]] | None) -> dict[str, object]:
    """`given` None (no given.json: a verifier run outside an assembled task) skips /app, and says so."""
    s_hits, sessions = session_hits(agent_logs)
    hits = s_hits + (app_hits(app, given) if given is not None else [])
    return {
        "leak": int(bool(hits)),
        "sessions": sessions,
        "app_scanned": given is not None,
        "hits": hits[:200],
        "n_hits": len(hits),
    }
