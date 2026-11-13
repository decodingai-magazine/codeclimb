"""The leak scan: did the harness reach a blocked host, or the repo, by a route that touches the network?

What the harness did counts, not what it read: the given inputs name github.com and the repo owner themselves.
And a blocked host counts only where it can reach the network: a build is asked to name GitHub hosts in its own
code (the coder sandbox's web block), and npm lockfiles carry github.com metadata. The repo owner counts anywhere
the harness wrote it.

- the session files (`<agent logs>/sessions/projects/**/*.jsonl`, subagents included):
  - blocked hosts in the input of a network tool (`WebFetch`, `WebSearch`, `Bash`, any MCP tool) and in
    `WebSearch` results (a result that links a blocked host)
  - the owner in any tool's input (a file written or edited included) and in `WebSearch` results
- `/app`: in each file the harness wrote or changed, the owner anywhere, and blocked hosts only where the build
  fetches: a Dockerfile's `RUN` and `ADD` instructions, `package.json` dependency specs (`github:`, `git+`, URLs),
  `package-lock.json` `resolved` URLs. A given file counts only for names beyond those it held as given
  (`given.json`, written by assemble.py: per given file, its sha256 and these names)

A hit sets `leak` = 1; the trial keeps its reward and is reported apart.
"""

import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from blocked_hosts import hosts_in, names_in, owner_in

# Not the harness's own writing: installs, the runs folders, the scenario generator's output, the verifier's .env.
SKIP_DIRS = frozenset(
    {".git", "node_modules", "runs-inngest", "runs-langchain", "generated", ".venv", "__pycache__", ".ruff_cache"}
)
SKIP_FILES = frozenset({".env"})
MAX_BYTES = 5_000_000
NETWORK_TOOLS = frozenset({"WebFetch", "WebSearch", "Bash"})
SEARCH_TOOLS = frozenset({"WebSearch"})
DEP_FIELDS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides")
DOCKER_FETCH = re.compile(r"^\s*(RUN|ADD)\b", re.IGNORECASE)


def text_of(content: object) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False)


def is_network_tool(name: str) -> bool:
    return name in NETWORK_TOOLS or name.startswith("mcp__")


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
                    text = text_of(block.get("input"))
                    found = names_in(text) if is_network_tool(name) else owner_in(text)
                    hits += [f"{f.name}: {name} input: {n}" for n in found]
                elif block.get("type") == "tool_result":
                    name = tools.get(str(block.get("tool_use_id")), "")
                    if name in SEARCH_TOOLS:
                        hits += [f"{f.name}: {name} result: {n}" for n in names_in(text_of(block.get("content")))]
    return hits, len(files)


def dockerfile_fetches(text: str) -> str:
    """The RUN and ADD instructions of a Dockerfile, continuation lines joined."""
    joined = re.sub(r"\\\r?\n", " ", text)
    return "\n".join(line for line in joined.splitlines() if DOCKER_FETCH.match(line))


def package_fetches(text: str, lockfile: bool) -> str:
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return text  # unparsable: every host in it counts
    if not isinstance(data, dict):
        return ""
    if lockfile:
        packages = data.get("packages") if isinstance(data.get("packages"), dict) else {}
        return "\n".join(str(p.get("resolved", "")) for p in packages.values() if isinstance(p, dict))
    specs = []
    for field in DEP_FIELDS:
        deps = data.get(field)
        if isinstance(deps, dict):
            specs += [text_of(v) for v in deps.values()]
    # `github:owner/repo` names no host but fetches from GitHub.
    return "\n".join(re.sub(r"^github:", "https://github.com/", s) for s in specs)


def route_names(rel: str, text: str) -> list[str]:
    """The names in a file that count: the owner anywhere, blocked hosts only where the build fetches."""
    base = rel.rsplit("/", 1)[-1]
    if base.startswith("Dockerfile") or base.endswith(".dockerfile"):
        fetches = dockerfile_fetches(text)
    elif base in ("package.json", "package-lock.json"):
        fetches = package_fetches(text, base == "package-lock.json")
    else:
        fetches = ""
    return hosts_in(fetches) + owner_in(text)


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
        found = Counter(route_names(rel, data.decode("utf-8", errors="replace")))
        allowed = Counter(base["names"]) if base is not None else Counter()
        hits += [f"/app/{rel}: {n} x{c - allowed[n]}" for n, c in sorted(found.items()) if c > allowed[n]]
    return hits


def given_record(app: Path) -> dict[str, dict[str, object]]:
    """For assemble.py: each given file's sha256 and the names in it that count."""
    out = {}
    for p in app_files(app):
        rel = p.relative_to(app).as_posix()
        data = p.read_bytes()
        names = Counter(route_names(rel, data.decode("utf-8", errors="replace")))
        out[rel] = {"sha256": hashlib.sha256(data).hexdigest(), "names": dict(names)}
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
