"""Job dirs -> trials.jsonl -> the tables the benchmark reports (docs/codeclimb-eval-spec.md, Metrics).

    python3 analyze.py <jobs dir>...                    # every trial -> <first dir>/trials.jsonl, then the report
    python3 analyze.py report <trials.jsonl>            # the report of an existing trials.jsonl
    python3 analyze.py counts <trajectory.json>...      # skill, MCP and doc-fetch calls per trajectory
    python3 analyze.py pile <app artifact dir>...       # pocock: tickets, tickets done, commits

The report: outcome per cell, the hidden and real tests per cell (beside the reward, never in it), the 2 x 2 effects
within a stack (exact permutation tests), the stack comparison on shared checks, the process metrics of the build trials
from their session files (per stack, old specs apart), their runtime metrics from the verifier's checks.json and their
code metrics (beside the build-pin reference runs: a reference run of another commit is its own cell), and the trials
kept out of every mean
(leaks, infra errors). A trajectory is Harbor's
agent/trajectory.json: steps whose tool_calls name a function_name.
"""

import itertools
import json
import math
import os
import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, median

sys.path.insert(0, str(Path(__file__).resolve().parent / "verifier"))
sys.path.insert(0, str(Path(__file__).resolve().parent / "analysis"))
from leak import without_heredocs  # noqa: E402
from measure import GENERATED, is_test  # noqa: E402

from assemble import BUILD_PINS, SHARED, STUBS
from code_metrics import RATIOS
from gate import resolved, target_grade

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
# A web URL: a dotted host name that is not this machine or the Docker host (a daemon probe such as http://h:2375 or
# http://$(ip route ...):2375 is not a web call).
FETCH = re.compile(r"\b(curl|wget)\b[^|;&]*?https?://(?!(?:127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)[:/])[\w-]+(?:\.[\w-]+)+")


def lever_counts(trajectory: dict, arm_skills: frozenset[str] = frozenset()) -> dict:
    """skill: Skill calls of the arm's own skills (the trial lock's); other_skill: Claude Code's built-in ones;
    workflow_skills: calls of the workflow's skills per skill name;
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
                    c["skill" if skill in arm_skills else "other_skill"] += 1
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
    counts: dict = {k: c[k] for k in ("skill", "other_skill", "mcp_platform", "mcp_docs", "web_fetch", "web_search", "bash_fetch")}
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


# --- trials.jsonl --------------------------------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
ARMS = {(False, False): "bare", (True, False): "skills", (False, True): "mcp-docs", (True, True): "full"}
# Harbor's error policy (harbor/models/trial/error_policy.py, Harbor 0.25.0): the exception types whose cause makes the
# reward a valid measurement of the agent (AGENT_EXHAUSTED_BUDGET, AGENT_REFUSED_TASK). Harbor computes
# `reward_valid` and does not store it.
REWARD_VALID_TYPES = frozenset(
    {
        "AgentTimeoutError",
        "ContextWindowExceededError",
        "OutputTokenExceededError",
        "ContextLengthExceededError",
        "OutputLengthExceededError",
        "AgentSafetyRefusalError",
        "ContentPolicyViolationError",
    }
)
# Infra errors (spec, "Jobs, repeats, cost"): the sandbox, the model provider, Harbor, a cancel. Listed with their
# cost, in no mean. The same policy table's SANDBOX_FAILED, MODEL_PROVIDER_FAILED, HARBOR_FAILED and CANCELLED groups.
INFRA_TYPES = frozenset(
    {
        "EnvironmentStartTimeoutError", "SandboxBuildFailedError", "AgentSetupTimeoutError", "HealthcheckError",
        "SandboxLikelyOutOfMemoryError", "MemoryLimitExceededError", "SSHAccessError", "RuntimeRequestError",
        "AddTestsDirError", "DownloadVerifierDirError",
        "ApiError", "ApiRateLimitError", "ApiInternalServerError", "ApiOverloadedError", "ApiConnectionClosedError",
        "ApiResponseStalledError", "UnknownApiError", "NetworkConnectionError", "ApiConnectionError",
        "ApiUsageLimitError", "AgentAuthenticationError", "ModelNotFoundError", "ApiProviderResourceNotFoundError",
        "ServiceOperationsUnsupportedError", "MissingExtraError", "RegradeError", "CancelledError",
    }
)  # fmt: skip


# Trials started before this ran on the old build specs (phases B to D2; the rewritten specs' first trials, e1, started
# 2026-11-14T17:49). A regrade keeps its source's label.
CURRENT_SPECS_SINCE = "2026-11-14T17:45:00Z"


def _seconds(phase: dict | None) -> float | None:
    if not phase or not phase.get("started_at") or not phase.get("finished_at"):
        return None
    parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))  # noqa: E731
    return round((parse(phase["finished_at"]) - parse(phase["started_at"])).total_seconds(), 1)


def _json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def stream_facts(path: Path) -> dict:
    """From Claude Code's stream (agent/claude-code.txt): the last `result` event's subtype and terminal_reason,
    and whether the subscription's usage limit stopped the run (an assistant event with error `rate_limit` or
    `billing_error`, or a result with api_error_status 429).

    A session that a background task wakes after it ends emits one `result` per segment. `total_cost_usd` is
    cumulative, so cost is the last one's; `num_turns` is per segment, so turns are their sum."""
    facts: dict = {"num_turns": None, "cost_usd": None, "results": 0, "subtype": None, "terminal_reason": None,
                   "usage_limit": False}
    if not path.exists():
        return facts
    for line in path.read_text(errors="replace").splitlines():
        if not line.startswith("{"):
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if e.get("type") == "assistant" and e.get("error") in ("rate_limit", "billing_error"):
            facts["usage_limit"] = True
        if e.get("type") == "result":
            if e.get("num_turns") is not None:
                facts["num_turns"] = (facts["num_turns"] or 0) + e["num_turns"]
            facts.update(cost_usd=e.get("total_cost_usd", facts["cost_usd"]), results=facts["results"] + 1,
                         subtype=e.get("subtype"), terminal_reason=e.get("terminal_reason"))
            if e.get("api_error_status") == 429:
                facts["usage_limit"] = True
    return facts


# --- process metrics, from the session files (spec, Metrics: developer-experience metrics, process) --------------------


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def _session_calls(sessions: Path) -> tuple[list[dict], list[dict]]:
    """(calls, messages) of every session file under `sessions` (subagents' included). A call: tool name, input, start
    and end times, output text, toolUseResult, whether it ran in a subagent. A message: the time and final usage of one
    assistant message (Claude Code writes a message once per content block; the last line holds its usage)."""
    calls: list[dict] = []
    messages: dict[str, dict] = {}
    for f in sorted(sessions.rglob("*.jsonl")) if sessions.is_dir() else []:
        pending: dict[str, dict] = {}
        side = "subagents" in f.parts
        for line in f.read_text(errors="replace").splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            msg, at = e.get("message") or {}, e.get("timestamp")
            if not isinstance(msg, dict) or not at:
                continue
            content = msg.get("content") if isinstance(msg.get("content"), list) else []
            if e.get("type") == "assistant":
                if msg.get("id") and msg.get("usage"):
                    messages[f"{f}:{msg['id']}"] = {"at": _ts(at), "usage": msg["usage"]}
                for c in content:
                    if c.get("type") == "tool_use":
                        pending[c.get("id")] = {"name": c.get("name", ""), "input": c.get("input") or {}, "start": _ts(at), "side": side}
            elif e.get("type") == "user":
                for c in content:
                    if c.get("type") == "tool_result" and (call := pending.pop(c.get("tool_use_id"), None)):
                        result = e.get("toolUseResult") if isinstance(e.get("toolUseResult"), dict) else {}
                        # A long output reaches the model as a 2 KB preview; toolUseResult keeps all of it.
                        out = c.get("content")
                        out = out if isinstance(out, str) else "\n".join(x.get("text", "") for x in out or [] if isinstance(x, dict))
                        if isinstance(result.get("stdout"), str):
                            out = result["stdout"] + (f"\n{result['stderr']}" if result.get("stderr") else "")
                        calls.append({**call, "end": _ts(at), "out": out, "result": result})
    return sorted(calls, key=lambda c: c["start"]), sorted(messages.values(), key=lambda m: m["at"])


def _union_s(spans: list[tuple[float, float]]) -> float:
    total, edge = 0.0, float("-inf")
    for a, b in sorted(spans):
        if b > edge:
            total += b - max(a, edge)
            edge = b
    return total


RUN_NIGHT = re.compile(r"\bnpm run (?:-s )?run-night\b")
SERVICE_START = re.compile(r"\bnpm run (?:-s )?(?:worker|server|dev:inngest)\b")
# Token prices relative to an input token (Anthropic's list prices: a cache read 0.1x, a cache write 1.25x for 5 min and
# 2x for 1 h, an output token 5x). The $ to a milestone is the trial's $ times the priced share of tokens spent by then.
PRICE = {"input_tokens": 1.0, "cache_read_input_tokens": 0.1, "output_tokens": 5.0}
# Services up, as the verifier's adapters probe them: the Inngest worker API (`/api/nights`, the dev server already runs
# in a trial) and the Agent Server's `/ok`, once the build has started its own services (`npm run worker` or `server`:
# a hand-rolled spike's server answers `/ok` too). A night that printed a row, `done` or `stopped` had them up as well.
SERVICES_UP = {"inngest": re.compile(r'\{\s*"nights"\s*:'), "langchain": re.compile(r'"ok"\s*:\s*true|/ok answers')}
NIGHT_OUTPUT = re.compile(r"^(?:row|done|stopped)\b", re.MULTILINE)
DONE_LINE = re.compile(r"^done\b", re.MULTILINE)
NIGHT_ID = re.compile(r"""--night-id[= ]["']?(\$\{?\w+\}?|[\w.-]+)""")
KILL = re.compile(r"\b(?:pkill|kill|killall)\b|\bdocker(?: compose\b[^;&|]*)? (?:kill|stop|restart)\b")
SCRIPT = re.compile(r">\s*(\S+)\s*<<")  # `cat > <file> <<EOF`: the file a heredoc writes


def _night_id(cmd: str) -> str | None:
    """The `--night-id` of a command, a shell variable resolved from an assignment in the same command."""
    if not (m := NIGHT_ID.search(cmd)):
        return None
    if not m[1].startswith("$"):
        return m[1]
    v = re.search(rf"\b{re.escape(m[1].strip('${}'))}=[\"']?([\w.-]+)", cmd)
    return v[1] if v else None


def _priced(usage: dict) -> float:
    cache = usage.get("cache_creation") or {}
    write = (1.25 * cache.get("ephemeral_5m_input_tokens", 0) + 2.0 * cache.get("ephemeral_1h_input_tokens", 0)) if cache \
        else 1.25 * (usage.get("cache_creation_input_tokens") or 0)
    return write + sum(w * (usage.get(k) or 0) for k, w in PRICE.items())


def milestones(calls: list[dict], stack: str) -> dict[str, float | None]:
    """Time of the first `services-up`, the first night 1 `done` (a `run-night` of `capitals-smoke` that printed
    `done` on a line of its own) and the first night 5 pass: a `--no-wait` start of `datenorm-smoke`, a kill of the
    runtime in that call or a later one (directly, or by running a script whose heredoc kills), then output listing
    that night's `done.json`."""
    out: dict[str, float | None] = {"services_up": None, "night1_done": None, "night5_pass": None}
    night5: dict[str, bool] = {}  # night id -> killed since its start
    killers: set[str] = set()  # scripts written by a heredoc that kills
    started = False
    for c in calls:
        if c["name"] != "Bash":
            continue
        full = str(c["input"].get("command", ""))
        cmd = without_heredocs(full)
        if KILL.search(full) and not KILL.search(cmd):
            killers |= set(SCRIPT.findall(full))
        started = started or bool(SERVICE_START.search(cmd))
        night = bool(RUN_NIGHT.search(cmd))
        if out["services_up"] is None and ((started and SERVICES_UP[stack].search(c["out"])) or (night and NIGHT_OUTPUT.search(c["out"]))):
            out["services_up"] = c["end"]
        if out["night1_done"] is None and night and "capitals-smoke" in cmd and DONE_LINE.search(c["out"]):
            out["night1_done"] = c["end"]
        if night and "datenorm-smoke" in cmd and "--no-wait" in cmd and (n := _night_id(cmd)):
            night5[n] = False
        if KILL.search(cmd) or any(k in cmd for k in killers):
            night5 = dict.fromkeys(night5, True)
        if out["night5_pass"] is None and "done.json" in c["out"]:
            if any(killed and re.search(rf"\b{re.escape(n)}\b", cmd + "\n" + c["out"]) for n, killed in night5.items()):
                out["night5_pass"] = c["end"]
    return out


TS_ERROR = re.compile(r"\berror (TS\d+)\b")
TEST_FAIL = re.compile(r"^(?:#|ℹ)\s*fail\s+(\d+)", re.MULTILINE)  # TAP, or the node spec reporter
ERROR_LINE = re.compile(r"\berror\b|^(?:#|ℹ)\s*fail\s+[1-9]|\bFAIL\b", re.IGNORECASE)
# The stack SDK (code_metrics.SDK's packages, tracing included): its package folders, and the names a type error carries when it is about an SDK symbol.
SDK_PATHS = {"inngest": re.compile(r"node_modules/(?:inngest|@inngest)(?![\w-])"), "langchain": re.compile(r"node_modules/(?:@langchain|langsmith)(?![\w-])")}
SDK_SYMBOL = {
    "inngest": re.compile(r"""['"](?:inngest|@inngest/[\w-]+)['"]|\bInngest\w*|\bGetStepTools\b|\bGetEvents\b"""),
    "langchain": re.compile(r"""['"]@langchain/[\w-]+(?:/[\w-]+)?['"]|\bLangGraph\w*|\b(?:Compiled)?StateGraph\b|\bPregel\w*|\bBaseCheckpointSaver\b|\bAnnotation\w*\b"""),
}
SDK_TYPE_ERRORS = frozenset({"TS2339", "TS2305", "TS2554"})
LOOKUP_TOOLS = frozenset({"Read", "Grep", "Glob", "Bash"})


def _written(call: dict) -> list[tuple[str, int]]:
    """(path, lines added) per file a call wrote: Edit and Write (`structuredPatch`, or a new file's content) and
    writes through Bash (`bashEditDiff`)."""
    r = call["result"]
    plus = lambda hunks: sum(1 for h in hunks for x in h.get("lines") or [] if x.startswith("+"))  # noqa: E731
    out = []
    if r.get("filePath") and ("structuredPatch" in r):
        out.append((r["filePath"], plus(r["structuredPatch"]) if r["structuredPatch"] else len(str(r.get("content") or "").splitlines())))
    for f in (r.get("bashEditDiff") or {}).get("files") or []:
        out.append((f.get("filePath", ""), plus(f.get("hunks") or [])))
    return out


def _failures(calls: list[dict], stack: str) -> dict:
    """Typecheck and test failures, SDK type errors and thrash, from Bash output. Output lines that repeat a heredoc
    body of the command are cut first: the body is file content, echoed back, not a failure."""
    f = Counter()
    seen: set[str] = set()  # error lines since the last file change
    for c in calls:
        if _written(c):
            seen.clear()
        if c["name"] != "Bash":
            continue
        cmd = str(c["input"].get("command", ""))
        body = set(cmd.splitlines()) - set(without_heredocs(cmd).splitlines())
        out = "\n".join(x for x in c["out"].splitlines() if x not in body)
        ts = [(m[1], line) for line in out.splitlines() if (m := TS_ERROR.search(line))]
        f["ts_errors"] += len(ts)
        f["ts_failed_runs"] += bool(ts)
        f["sdk_type_errors"] += sum(code in SDK_TYPE_ERRORS and bool(SDK_SYMBOL[stack].search(line)) for code, line in ts)
        fails = sum(int(n) for n in TEST_FAIL.findall(out))
        f["test_failures"] += fails
        f["test_failed_runs"] += fails > 0
        errors = {x.strip() for x in out.splitlines() if ERROR_LINE.search(x)}
        f["thrash"] += bool(errors & seen)
        seen |= errors
    return {k: f[k] for k in ("thrash", "ts_errors", "ts_failed_runs", "test_failures", "test_failed_runs", "sdk_type_errors")}


def _lookups(calls: list[dict], stack: str) -> dict:
    """Calls that read the stack SDK's own package or the Pi docs (`/docs/pi`): Read, Grep, Glob, or a Bash command."""
    c = Counter()
    for call in calls:
        if call["name"] in LOOKUP_TOOLS:
            i = call["input"]
            text = without_heredocs(str(i.get("command", ""))) + " " + " ".join(str(i.get(k, "")) for k in ("file_path", "path", "pattern"))
            c["sdk_reads"] += bool(SDK_PATHS[stack].search(text))
            c["pi_doc_reads"] += "/docs/pi" in text
    return {"sdk_reads": c["sdk_reads"], "pi_doc_reads": c["pi_doc_reads"]}


def _in_build(rel: Path) -> bool:
    """Whether a path of /app is part of the final build: not the shared given inputs, the benchmark's stubs,
    generated folders (the code metrics' GENERATED, the runs folders) or npm's lockfile. Both sides of the rework
    ratio use it."""
    dirs = rel.parts[:-1]
    return not ((dirs and dirs[0] in SHARED) or rel.as_posix() in STUBS or rel.name == "package-lock.json"
                or any(d in GENERATED or d.startswith("runs-") for d in dirs))


def _build_lines(app: Path) -> int:
    """Text lines of the final build (`_in_build`), binary files left out."""
    total = 0
    for here, dirs, names in os.walk(app):
        top = Path(here) == app
        dirs[:] = [d for d in dirs if d not in GENERATED and not d.startswith("runs-") and not (top and d in SHARED)]
        for name in names:
            p = Path(here) / name
            if p.is_symlink() or not _in_build(p.relative_to(app)):
                continue
            data = p.read_bytes()
            total += 0 if b"\0" in data else len(data.decode(errors="replace").splitlines())
    return total


def _rework(calls: list[dict], app: Path) -> dict:
    """Lines written into /app during the session against the lines in the final build (`_build_lines`). A Bash
    call's `bashEditDiff` lists some of the files it changed and counts the rest in `moreFiles`: those writes are
    unseen, so the ratio is a floor. Writes outside the final build (npm's lockfile, a runs folder) are out of both sides."""
    written = [(p, n) for c in calls for p, n in _written(c) if p.startswith("/app/") and _in_build(Path(p[len("/app/"):]))]
    final = _build_lines(app) if app.is_dir() else 0
    lines = sum(n for _, n in written)
    return {"lines_written": lines, "final_lines": final if app.is_dir() else None,
            "rework_ratio": round(lines / final, 3) if app.is_dir() and final else None,
            "unseen_bash_writes": sum((c["result"].get("bashEditDiff") or {}).get("moreFiles") or 0 for c in calls)}


def process_metrics(sessions: Path, stack: str, app: Path, cost_usd: float | None) -> dict:
    """The process metrics of one trial from its session files. Time split from the main session only (a subagent
    runs inside the main session's Agent call)."""
    calls, messages = _session_calls(sessions)
    main = [c for c in calls if not c["side"]]
    stamps = [c["start"] for c in main] + [c["end"] for c in main]
    span = max(stamps) - min(stamps) if stamps else None
    tool_s = _union_s([(c["start"], c["end"]) for c in main]) if main else None
    feedback = [c["end"] - c["start"] for c in main if c["name"] == "Bash" and not c["input"].get("run_in_background")
                and (lambda cmd: RUN_NIGHT.search(cmd) or SERVICE_START.search(cmd))(without_heredocs(str(c["input"].get("command", ""))))]
    row: dict = {
        "tool_s": None if tool_s is None else round(tool_s, 1),
        "outside_tool_s": None if span is None else round(span - tool_s, 1),
        "feedback_s": round(median(feedback), 1) if feedback else None,
    }
    priced = sum(_priced(m["usage"]) for m in messages)
    reached = milestones(calls, stack)
    # A maintenance /app has no node_modules or images: its time is counted from the first services-up to the end.
    row["from_services_up_min"] = None if reached["services_up"] is None else round((max(stamps) - reached["services_up"]) / 60, 2)
    for name, at in reached.items():
        spent = sum(_priced(m["usage"]) for m in messages if m["at"] <= at) if at is not None else 0
        row[f"{name}_min"] = None if at is None else round((at - min(stamps)) / 60, 2)
        row[f"{name}_usd"] = None if at is None or cost_usd is None or not priced else round(cost_usd * spent / priced, 2)
    return {**row, **_rework(calls, app), **_failures(calls, stack), **_lookups(calls, stack)}


def _change(app: Path) -> dict | None:
    """A maintenance trial's change: its final /app against the /app's own first commit (the task as given), committed
    or not, untracked files counted whole; gitignored files and npm's lockfile left out. Lines are added plus removed,
    as for the reference fix. A regression test is added when a test file (code metrics' rule) gains lines. None
    without the /app's repository."""
    if not (app / ".git").is_dir():
        return None
    git = ["git", "-C", str(app), "-c", "safe.directory=*"]
    root = subprocess.run(git + ["rev-list", "--max-parents=0", "HEAD"], capture_output=True, text=True)
    if root.returncode != 0 or not root.stdout.split():
        return None
    added: dict[str, tuple[int, int]] = {}
    for line in subprocess.run(git + ["diff", "--numstat", root.stdout.split()[-1]], capture_output=True, text=True).stdout.splitlines():
        plus, minus, path = line.split("\t", 2)
        added[path] = (int(plus) if plus != "-" else 0, int(minus) if minus != "-" else 0)
    untracked = subprocess.run(git + ["ls-files", "--others", "--exclude-standard", "-z"], capture_output=True, text=True).stdout
    for path in filter(None, untracked.split("\0")):
        data = (app / path).read_bytes() if (app / path).is_file() else b""
        added[path] = (0 if b"\0" in data else len(data.decode(errors="replace").splitlines()), 0)
    added = {p: n for p, n in added.items() if Path(p).name != "package-lock.json"}
    return {"lines": sum(a + r for a, r in added.values()), "files": len(added),
            "test_added": any(is_test(p) and a > 0 for p, (a, _) in added.items())}


def runtime(checks: Path) -> dict:
    """The runtime metrics of the verifier's checks.json (its `runtime` key, report only): seconds per graded night
    by night number, cold start (`services-up`'s duration) and resume latency (night 5), in seconds. Null when the
    verifier did not record them (an older grade, or the night never ran)."""
    rt = _json(checks).get("runtime") or {}
    return {"night_s": rt.get("night_s") or None, "cold_start_s": rt.get("cold_start_s"), "resume_latency_s": rt.get("resume_latency_s")}


# A reference job's name (`job-configs/reference.sh`: reference-<stack>-<sha>-<time>; older jobs lack the time).
REFERENCE_JOB = re.compile(r"reference-(?:inngest|langchain)-([0-9a-f]{7})(?:-\d+)?")


def cell_arm(row: dict) -> str:
    """The arm a report cell shows: only a reference run of its stack's build pin is the build tasks' reference; a
    run of another commit (a maintenance base, a task commit, a patch) or of none named is its own cell."""
    if row["arm"] != "reference" or row.get("reference_commit") == BUILD_PINS[row["stack"]]:
        return row["arm"]
    return f"reference {row.get('reference_commit') or 'unknown'}"


def families(rewards: dict) -> dict[str, int]:
    """The `hidden.*` and `real.*` keys of reward.json: the verifier's tests beside the reward. A test that did not
    run has no key."""
    return {k: v for k, v in rewards.items() if k.startswith(("hidden.", "real."))}


def classify(row: dict) -> str:
    """counted | infra | leak | no-reward. Infra: a usage-limit stop in the stream whatever Harbor's type, an infra
    exception type, or an artifact that failed to collect (the verifier graded a partial copy; Harbor calls that
    best-effort and records no exception). A leak counts only for a harness: a reference build's own files quote
    the owner."""
    if row["usage_limit"] or row["exception_type"] in INFRA_TYPES or row["artifacts_failed"]:
        return "infra"
    if row["reward"] is None:
        return "no-reward"
    if row["leak"] and row["harness"] != "nop":
        return "leak"
    return "counted"


def trial_row(trial: Path) -> dict | None:
    """One row of trials.jsonl from a Harbor trial folder, or None for a trial of another task or one unfinished."""
    result = _json(trial / "result.json")
    # A maintenance task is codeclimb-<stack>-<task id> (assemble.py maintenance).
    m = re.fullmatch(r"(?:.*/)?codeclimb-(inngest|langchain)(?:-([a-z0-9]+))?", result.get("task_name") or "")
    if not m or not result.get("finished_at"):
        return None
    cfg = result.get("config") or {}
    source = cfg.get("source_trial") or {}
    if source.get("action") == "regrade" and source.get("path"):
        # A regrade reran the verifier on a recorded trial: the trial is the source's, the rewards are new.
        row = trial_row(Path(source["path"]))
        if row is None:
            return None
        rewards = (result.get("verifier_result") or {}).get("rewards") or {}
        row.update(
            job=trial.parent.name, trial=trial.name, regrade_of=f"{row['job']}/{row['trial']}",
            reward=rewards.get("reward"), done=rewards.get("done"), leak=rewards.get("leak"),
            checks={k[len("checks."):]: v for k, v in rewards.items() if k.startswith("checks.")},
            families=families(rewards), partial=bool(rewards.get("partial")),
            reward_valid=bool(rewards) and (row["exception_type"] is None or row["exception_type"] in REWARD_VALID_TYPES),
            verifier_s=_seconds(result.get("verifier")), started_at=result.get("started_at"),
            **runtime(trial / "verifier" / "checks.json"),
            job_retries=(_json(trial.parent / "result.json").get("stats") or {}).get("n_retries"),
        )
        row["status"] = classify(row)
        return row
    agent = cfg.get("agent") or {}
    kwargs = agent.get("kwargs") or {}
    overlays = [str(p) for p in (cfg.get("environment") or {}).get("extra_docker_compose") or []]
    lock = _json(trial / "lock.json")
    if agent.get("name") == "nop":
        arm = "reference" if any(p.endswith("reference.compose.yaml") for p in overlays) else "nop"
    else:
        arm = ARMS[(bool(agent.get("skills")), bool(agent.get("mcp_servers")))]
    template = str(kwargs.get("prompt_template_path") or "")
    workflow = "pocock" if any(p.endswith("pocock.compose.yaml") for p in overlays) else "probe" if "probes/" in template else "one-shot"
    rewards = (result.get("verifier_result") or {}).get("rewards") or {}
    exc = (result.get("exception_info") or {}).get("exception_type")
    ar = result.get("agent_result") or {}
    traj = _json(trial / "agent" / "trajectory.json")
    stream = stream_facts(trial / "agent" / "claude-code.txt")
    assembled = _json(ROOT / (result.get("task_id") or {}).get("path", f"tasks/codeclimb-{m[1]}") / "assembled.json")
    app = trial / "artifacts" / "app"
    try:
        manifest = json.loads((trial / "artifacts" / "manifest.json").read_text())
    except (OSError, ValueError):
        manifest = []
    row = {
        "job": trial.parent.name,
        "trial": trial.name,
        "stack": m[1],
        "arm": arm,
        "workflow": workflow,
        "harness": agent.get("name"),
        "harness_version": (result.get("agent_info") or {}).get("version"),
        "model": ((result.get("agent_info") or {}).get("model_info") or {}).get("name") or agent.get("model_name"),
        "effort": kwargs.get("reasoning_effort"),
        "attempt": None,
        "exception_type": exc,
        "reward_valid": bool(rewards) and (exc is None or exc in REWARD_VALID_TYPES),
        "reward": rewards.get("reward"),
        "done": rewards.get("done"),
        "checks": {k[len("checks."):]: v for k, v in rewards.items() if k.startswith("checks.")},
        "families": families(rewards),
        "leak": rewards.get("leak"),
        "agent_s": _seconds(result.get("agent_execution")),
        "verifier_s": _seconds(result.get("verifier")),
        # Runtime, from the verifier's checks.json (spec, Metrics: runtime).
        **runtime(trial / "verifier" / "checks.json"),
        # A reference run's graded commit: only the build pin is the build tasks' reference (cell_arm).
        "reference_commit": m2[1] if arm == "reference" and (m2 := REFERENCE_JOB.fullmatch(trial.parent.name)) else None,
        "tokens_in": ar.get("n_input_tokens"),
        "tokens_out": ar.get("n_output_tokens"),
        "tokens_cache_read": ar.get("n_cache_tokens"),
        "tokens_cache_creation": ((traj.get("final_metrics") or {}).get("extra") or {}).get("total_cache_creation_input_tokens"),
        "cost_usd": stream["cost_usd"] if stream["cost_usd"] is not None else ar.get("cost_usd"),  # Harbor reads the first result
        "turns": stream["num_turns"],
        "tool_calls": sum(len(s.get("tool_calls") or []) for s in traj.get("steps", [])),
        "result_subtype": stream["subtype"],
        "terminal_reason": stream["terminal_reason"],
        "usage_limit": stream["usage_limit"],
        "artifacts_failed": [a.get("source") for a in manifest if a.get("status") == "failed"],
        **lever_counts(traj, frozenset(s["name"] for s in lock.get("skills", []))),
        "pile": pile_progress(app) if workflow == "pocock" and app.exists() else None,
        # The code and practice analysis step's output (code_metrics.py), when it has been run on this trial.
        "code_metrics": _json(trial / "code-metrics.json") or None,
        "skill_digests": {s["name"]: s["digest"] for s in lock.get("skills", [])},
        "task_digest": (lock.get("task") or {}).get("digest"),
        # From the task's assembled.json as it is now: task_digest shows whether the task changed since the trial.
        "spec_sha256": assembled.get("spec_sha256"),
        "given_inputs_sha256": assembled.get("given_inputs_sha256"),
        "harbor_version": (_json(trial.parent / "lock.json").get("harbor") or {}).get("version"),
        "started_at": result.get("started_at"),
        "regrade_of": None,
        # Harbor deletes a retried attempt's folder; only the job's count of retries is left.
        "job_retries": ((_json(trial.parent / "result.json").get("stats") or {}).get("n_retries")),
        # Maintenance trials: the task, its base and target tests; `resolved` is set by collect against the base.
        "task": m[2],
        "kind": assembled.get("kind") if m[2] else None,
        "base": assembled.get("base") if m[2] else None,
        "targets": assembled.get("targets") if m[2] else None,
        # The trial's change against the task's /app, beside the reference's own fix (assemble.py records its size).
        "change": _change(app) if m[2] else None,
        "reference_fix": assembled.get("fix") if m[2] else None,
        "resolved": None,
        "regressions": None,
        # Not all 34 ran (`basic` off): such a grade is no base for `resolved`.
        "partial": bool(rewards.get("partial")),
    }
    fix = row["reference_fix"] or {}
    row["fix_ratio"] = round(row["change"]["lines"] / fix["lines"], 3) if row["change"] and fix.get("lines") else None
    row["specs"] = "old specs" if row["started_at"] and _ts(row["started_at"]) < _ts(CURRENT_SPECS_SINCE) else "current"
    row.update(process_metrics(trial / "agent" / "sessions" / "projects" / "-app", m[1], app, row["cost_usd"]))
    row["status"] = classify(row)
    return row


def collect(jobs_dirs: list[Path]) -> list[dict]:
    """Every finished trial under the folders (a jobs folder or job folders), numbered by start time within its job
    and cell."""
    rows = [r for d in jobs_dirs for t in sorted([*d.glob("*/"), *d.glob("*/*/")]) if (r := trial_row(t))]
    # The latest regrade of a trial replaces it in every mean; the rows it replaced stay, as `regraded`.
    latest: dict[str, dict] = {}
    for r in sorted(rows, key=lambda r: r["started_at"] or ""):
        if r["regrade_of"]:
            latest[r["regrade_of"]] = r
    for r in rows:
        key = r["regrade_of"] or f"{r['job']}/{r['trial']}"
        if key in latest and latest[key] is not r:
            r["status"] = "regraded"
    seen: dict[tuple, int] = defaultdict(int)
    for r in sorted(rows, key=lambda r: r["started_at"] or ""):
        key = (r["job"], r["stack"], r["arm"], r["workflow"])
        seen[key] += 1
        r["attempt"] = seen[key]
    resolve_maintenance(rows)
    return rows


def grade_of(row: dict) -> dict:
    return {**{f"checks.{k}": v for k, v in row["checks"].items()}, **row["families"]}


def resolve_maintenance(rows: list[dict]) -> None:
    """`resolved` of each maintenance trial, against the grades of its base: the full reference runs of the base
    commit (`job-configs/reference.sh`, jobs named reference-<stack>-<sha>-*) in the same folders. The gate's runs,
    the target tests only, are partial and never a base."""
    for r in rows:
        if not r.get("task") or r["reward"] is None:
            continue
        bases = [grade_of(b) for b in rows if b["arm"] == "reference" and b["status"] == "counted" and not b.get("partial") and b["stack"] == r["stack"]
                 and r["base"] and re.match(rf"reference-{r['stack']}-{r['base'][:7]}-", b["job"])]
        r["resolved"], r["regressions"] = resolved(grade_of(r), bases, r["targets"] or [])


def maintenance_table(rows: list[dict]) -> list[str]:
    """Maintenance trials, apart from build trials: `resolved` and the metrics beside it, per task, stack and arm."""
    cells: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r["status"] == "counted":
            cells[(r["stack"], r["task"], r["arm"])].append(r)
    # The summary: resolved / counted attempts per task and stack, then per kind (repair, change) and over all tasks.
    def tally(rs: list[dict]) -> str:
        return f"{sum(r['resolved'] is True for r in rs)}/{len(rs)}" if rs else "-"

    counted = [r for rs in cells.values() for r in rs]
    stacks = ("inngest", "langchain")
    out = [f"{'task':4} {'kind':7} " + " ".join(f"{s:9}" for s in stacks)]
    groups = [(t, k, lambda r, t=t: r["task"] == t) for t, k in sorted({(r["task"], r.get("kind") or "?") for r in counted})]
    groups += [("all", k, lambda r, k=k: (r.get("kind") or "?") == k) for k in sorted({r.get("kind") or "?" for r in counted})]
    groups += [("all", "all", lambda r: True)] if counted else []
    for name, kind, keep in groups:
        out.append(f"{name:4} {kind:7} " + " ".join(f"{tally([r for r in counted if r['stack'] == s and keep(r)]):9}" for s in stacks).rstrip())
    for (stack, task, arm), rs in sorted(cells.items()):
        out.append(f"{stack:9} {task} {arm:9} n={len(rs)} resolved {sum(r['resolved'] is True for r in rs)}/{len(rs)}"
                   + (f" (no base grade: {sum(r['resolved'] is None for r in rs)})" if any(r["resolved"] is None for r in rs) else ""))
        for r in rs:
            state = {True: "resolved", False: "unresolved", None: "no base"}[r["resolved"]]
            change, fix = r.get("change"), r.get("reference_fix")
            diff = "no change measured" if not change else (
                f"diff {change['lines']} lines in {change['files']} files"
                + (f" ({r['fix_ratio']:.2f}x the reference fix, {fix['lines']} lines in {fix['files']} files)" if r.get("fix_ratio") is not None else "")
                + (", regression test added" if change["test_added"] else ", no regression test"))
            g = grade_of(r)  # a target is a basic check (`checks.<t>`) or a hidden test (`hidden.<t>`)
            failed = [f"checks.{t}" if f"checks.{t}" in g else f"hidden.{t}" for t in r["targets"] or [] if target_grade(g, t) != 1]
            out.append(f"    {r['job']}/{r['trial']} {state} ${_fmt(r['cost_usd'], 2)} {_fmt(r['agent_s'], 0)} s"
                       f" turns {r['turns']}, {_fmt(r.get('from_services_up_min'), 1)} min from services-up, {diff}"
                       + (f" regressions {', '.join(r['regressions'])}" if r["regressions"] else "")
                       + (f" targets failed {', '.join(failed)}" if failed else ""))
    kept = Counter(r["status"] for r in rows if r["status"] != "counted")
    out += [f"kept out: {', '.join(f'{s} {n}' for s, n in sorted(kept.items()))}"] if kept else []
    return out or ["no maintenance trials"]


# --- effects -------------------------------------------------------------------------------------------------------

# One-sided directions, fixed before the run (spec, Metrics: `full` > `bare`): the lever on scores higher, on reward
# and on agent $. Interaction: positive.
DIRECTION = {"reward": "greater", "cost_usd": "greater"}
ALPHA = 0.05
EXACT_LIMIT = 2_000_000


def _p(stats: list[float], observed: float, direction: str) -> float:
    eps = 1e-12
    hits = sum(1 for s in stats if (s >= observed - eps if direction == "greater" else s <= observed + eps))
    return hits / len(stats)


def permutation_p(on: list[float], off: list[float], direction: str = "greater") -> tuple[float, bool]:
    """Exact one-sided permutation test of mean(on) - mean(off), over every split of the pooled trials. (p, exact)"""
    pooled, k = on + off, len(on)
    total = sum(pooled)
    observed = mean(on) - mean(off)
    stat = lambda idx: (s := sum(pooled[i] for i in idx)) / k - (total - s) / (len(pooled) - k)  # noqa: E731
    return _p([stat(idx) for idx in itertools.combinations(range(len(pooled)), k)], observed, direction), True


def interaction(cells: dict[str, list[float]]) -> float:
    m = {a: mean(v) for a, v in cells.items()}
    return (m["full"] - m["mcp-docs"]) - (m["skills"] - m["bare"])


def interaction_p(cells: dict[str, list[float]], direction: str = "greater", seed: int = 0) -> tuple[float, bool]:
    """Exact one-sided permutation test of the interaction, over every assignment of the trials to the four cells with
    the cells' sizes kept; past EXACT_LIMIT assignments, 200k random ones. (p, exact)"""
    arms = ["bare", "skills", "mcp-docs", "full"]
    sizes = [len(cells[a]) for a in arms]
    if len(set(sizes)) == 1:
        # Equal cells of size s: the interaction is (sum of full and bare - sum of skills and mcp-docs) / s, and every
        # split of the pooled trials into those two halves has the same number of cell assignments, so the exact test
        # is the two-sample one over the halves.
        return permutation_p(cells["full"] + cells["bare"], cells["skills"] + cells["mcp-docs"], direction)
    values = [v for a in arms for v in cells[a]]
    observed = interaction(cells)
    n_total = math.factorial(len(values)) // math.prod(math.factorial(s) for s in sizes)
    coef = [1 / sizes[0], -1 / sizes[1], -1 / sizes[2], 1 / sizes[3]]
    if n_total <= EXACT_LIMIT:
        stats: list[float] = []

        def assign(rest: tuple[int, ...], i: int, acc: float) -> None:
            if i == 3:
                stats.append(acc + coef[3] * sum(values[j] for j in rest))
                return
            for idx in itertools.combinations(rest, sizes[i]):
                assign(tuple(j for j in rest if j not in idx), i + 1, acc + coef[i] * sum(values[j] for j in idx))

        assign(tuple(range(len(values))), 0, 0.0)
        return _p(stats, observed, direction), True
    rng = random.Random(seed)
    stats = []
    for _ in range(200_000):
        shuffled = values[:]
        rng.shuffle(shuffled)
        it = iter(shuffled)
        stats.append(interaction({a: [next(it) for _ in range(s)] for a, s in zip(arms, sizes)}))
    return _p(stats, observed, direction), False


def effects(rows: list[dict], metric: str) -> list[dict]:
    """The 2 x 2 effects of one stack's counted one-shot trials on a metric (spec, Arms): skills = mean of
    (skills - bare, full - mcp-docs); MCP + docs = mean of (mcp-docs - bare, full - skills); interaction =
    (full - mcp-docs) - (skills - bare). Main effects are tested pooled, 6 vs 6 at n = 3."""
    cells = {a: [r[metric] for r in rows if r["arm"] == a and r[metric] is not None] for a in ARMS.values()}
    if any(not v for v in cells.values()):
        return [{"effect": e, "metric": metric, "value": None, "p": None, "call": f"missing cells: {[a for a, v in cells.items() if not v]}"} for e in ("skills", "mcp-docs", "interaction")]
    m = {a: mean(v) for a, v in cells.items()}
    n = min(len(v) for v in cells.values())
    direction = DIRECTION.get(metric, "greater")
    out = []
    for name, (on, off), value in (
        ("skills", (("skills", "full"), ("bare", "mcp-docs")), ((m["skills"] - m["bare"]) + (m["full"] - m["mcp-docs"])) / 2),
        ("mcp-docs", (("mcp-docs", "full"), ("bare", "skills")), ((m["mcp-docs"] - m["bare"]) + (m["full"] - m["skills"])) / 2),
    ):
        p, exact = permutation_p([x for a in on for x in cells[a]], [x for a in off for x in cells[a]], direction)
        out.append({"effect": name, "metric": metric, "value": value, "p": p, "exact": exact})
    p, exact = interaction_p(cells, direction)
    out.append({"effect": "interaction", "metric": metric, "value": interaction(cells), "p": p, "exact": exact})
    for e in out:
        e["call"] = _call(e["p"], direction, n)
    return out


def _call(p: float, direction: str, n: int) -> str:
    return f"{'+' if direction == 'greater' else '-'} effect, p = {p:.4f}" if p <= ALPHA else f"not detectable at n = {n}"


def full_vs_bare(rows: list[dict], metric: str) -> dict:
    """`full` against `bare` within one stack's counted one-shot trials (phase C): mean(full) - mean(bare), exact
    one-sided test in the metric's DIRECTION. At 3 vs 3 the smallest p is 1/20 = ALPHA."""
    full, bare = ([r[metric] for r in rows if r["arm"] == a and r[metric] is not None] for a in ("full", "bare"))
    if not full or not bare:
        return {"metric": metric, "value": None, "p": None, "call": "missing cells: " + str([a for a, v in (("full", full), ("bare", bare)) if not v])}
    direction = DIRECTION.get(metric, "greater")
    p, _ = permutation_p(full, bare, direction)
    return {"metric": metric, "value": mean(full) - mean(bare), "p": p, "call": _call(p, direction, min(len(full), len(bare)))}


# --- report --------------------------------------------------------------------------------------------------------


def _fmt(x: float | None, nd: int = 3) -> str:
    return "-" if x is None else f"{x:.{nd}f}"


def cell_table(rows: list[dict]) -> list[str]:
    out = []
    cells: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r["status"] == "counted":
            cells[(r["stack"], r["workflow"], cell_arm(r))].append(r)
    for (stack, workflow, arm), rs in sorted(cells.items()):
        rewards = [r["reward"] for r in rs]
        checks = sorted({c for r in rs for c in r["checks"] if "." not in c})
        failing = {c: sum(r["checks"].get(c, 0) for r in rs) for c in checks}
        failing = {c: k for c, k in failing.items() if k < len(rs)}
        costs = [r["cost_usd"] for r in rs if r["cost_usd"] is not None]
        out.append(
            f"{stack:9} {workflow:8} {arm:9} n={len(rs)} reward {[round(x, 3) for x in rewards]} mean {_fmt(mean(rewards))} "
            f"min {_fmt(min(rewards))} max {_fmt(max(rewards))} done {sum(r['done'] or 0 for r in rs)}/{len(rs)} "
            f"$ {_fmt(mean(costs) if costs else None, 2)}"
        )
        if len(failing) > len(checks) / 2:
            passed = {c: k for c, k in ((c, sum(r["checks"].get(c, 0) for r in rs)) for c in checks) if k}
            out.append(f"    {len(failing)} of {len(checks)} checks failed at least once; passed: " + (", ".join(f"{c} {k}/{len(rs)}" for c, k in passed.items()) or "none"))
        elif failing:
            out.append("    failed at least once, with passes: " + ", ".join(f"{c} {k}/{len(rs)}" for c, k in failing.items()))
    return out


def family_table(rows: list[dict]) -> list[str]:
    """Per cell of counted trials: the share of the hidden and real tests each trial passed, of those that ran for it,
    and each test some trial failed with its pass count. Trials graded before the families have no keys."""
    out = []
    cells: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r["status"] == "counted" and r.get("families"):
            cells[(r["stack"], r["workflow"], cell_arm(r))].append(r)
    for (stack, workflow, arm), rs in sorted(cells.items()):
        share = lambda r, fam: (lambda v: sum(v) / len(v) if v else None)([x for k, x in r["families"].items() if k.startswith(fam)])  # noqa: E731
        parts = []
        for fam in ("hidden.", "real."):
            vals = [s for r in rs if (s := share(r, fam)) is not None]
            ran = [len([k for k in r["families"] if k.startswith(fam)]) for r in rs]
            parts.append(f"{fam[:-1]} {_fmt(mean(vals)) if vals else '-'} ({min(ran)}-{max(ran)} tests)" if max(ran) else f"{fam[:-1]} not run")
        both = [sum(r["families"].values()) / len(r["families"]) for r in rs]
        out.append(f"{stack:9} {workflow:8} {arm:9} n={len(rs)} passed {[round(x, 3) for x in both]} mean {_fmt(mean(both))}; " + "; ".join(parts))
        tests = sorted({k for r in rs for k in r["families"]})
        failing = {k: (sum(r["families"].get(k, 0) for r in rs), sum(k in r["families"] for r in rs)) for k in tests}
        failing = {k: (p, n) for k, (p, n) in failing.items() if p < n}
        if failing:
            out.append("    failed at least once: " + ", ".join(f"{k} {p}/{n}" for k, (p, n) in failing.items()))
    missing = sum(r["status"] == "counted" and not r.get("families") for r in rows)
    if missing:
        out.append(f"counted trials without hidden or real keys (graded before them; regrade to add): {missing}")
    return out or ["no counted trial has hidden or real keys"]


def stack_comparison(rows: list[dict]) -> list[str]:
    """Both stacks side by side, per (workflow, arm), on the checks both stacks' counted trials share."""
    counted = [r for r in rows if r["status"] == "counted"]
    per_stack = {s: {c for r in counted if r["stack"] == s for c in r["checks"] if "." not in c} for s in ("inngest", "langchain")}
    shared = sorted(per_stack["inngest"] & per_stack["langchain"])
    if not shared:
        return ["no shared checks: one stack has no counted trial"]
    out = [f"shared checks: {len(shared)}"]
    keys = sorted({(r["workflow"], cell_arm(r)) for r in counted})
    for workflow, arm in keys:
        cols = []
        for stack in ("inngest", "langchain"):
            rs = [r for r in counted if (r["stack"], r["workflow"], cell_arm(r)) == (stack, workflow, arm)]
            if not rs:
                cols.append(f"{stack}: -")
                continue
            score = mean(sum(r["checks"].get(c, 0) for c in shared) / len(shared) for r in rs)
            done = sum(all(r["checks"].get(c, 0) for c in shared) for r in rs)
            costs = [r["cost_usd"] for r in rs if r["cost_usd"] is not None]
            walls = [r["agent_s"] for r in rs if r["agent_s"] is not None]
            piles = [r["pile"]["tickets_done"] for r in rs if r.get("pile")]
            fails = sorted({c for r in rs for c in shared if not r["checks"].get(c)})
            cols.append(
                f"{stack}: n={len(rs)} reward {_fmt(score)} done {done}/{len(rs)} $ {_fmt(mean(costs) if costs else None, 2)} "
                f"agent {_fmt(mean(walls) / 60 if walls else None, 1)} min"
                + (f" tickets done {_fmt(mean(piles), 1)}" if piles else "")
                + (f" failing {len(fails)}: {fails}" if 0 < len(fails) <= 8 else f" failing {len(fails)}" if fails else "")
            )
        out.append(f"{workflow:8} {arm:9} | " + " | ".join(cols))
    return out


PROCESS = [  # (column, label, unit, digits)
    ("tool_s", "in tools", "s", 0), ("outside_tool_s", "outside", "s", 0), ("feedback_s", "feedback", "s", 1),
    ("services_up_min", "services-up", "min", 1), ("services_up_usd", "", "$", 2),
    ("night1_done_min", "night 1 done", "min", 1), ("night1_done_usd", "", "$", 2),
    ("night5_pass_min", "night 5 pass", "min", 1), ("night5_pass_usd", "", "$", 2),
    ("rework_ratio", "rework", "", 2), ("unseen_bash_writes", "unseen Bash writes", "", 1), ("thrash", "thrash", "", 1), ("ts_errors", "TS errors", "", 1),
    ("ts_failed_runs", "in runs", "", 1), ("test_failures", "test fails", "", 1), ("test_failed_runs", "in runs", "", 1),
    ("sdk_type_errors", "SDK type errors", "", 1), ("sdk_reads", "SDK reads", "", 1), ("pi_doc_reads", "Pi doc reads", "", 1),
]


def _process_cols(rs: list[dict]) -> str:
    """Each process metric's mean over the trials that have it; a milestone with how many trials reached it."""
    parts = []
    for col, label, unit, nd in PROCESS:
        vals = [r[col] for r in rs if r.get(col) is not None]
        v = "-" if not vals else f"${mean(vals):.{nd}f}" if unit == "$" else f"{mean(vals):.{nd}f}{' ' + unit if unit else ''}"
        reached = f" ({len(vals)}/{len(rs)})" if col.endswith("_min") and len(rs) > 1 else ""
        parts.append(f"{label} {v}{reached}" if label else v)
    return " ".join(parts)


def process_table(rows: list[dict]) -> list[str]:
    """Process metrics of the counted build trials (a harness, not a probe): per stack, current and old specs never
    pooled, then per trial."""
    build = [r for r in rows if r["status"] == "counted" and r["harness"] != "nop" and r["workflow"] != "probe"]
    out = [f"build trials: {len(build)} (old specs {sum(r.get('specs') == 'old specs' for r in build)})"]
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in build:
        groups[(r["stack"], r.get("specs"))].append(r)
    for (stack, specs), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] != "current")):
        out.append(f"{stack:9} {specs:9} n={len(rs)} {_process_cols(rs)}")
    for r in sorted(build, key=lambda r: (r.get("specs") != "current", r["stack"], r["job"], r["trial"])):
        out.append(f"    {r['job']}/{r['trial']} {r['stack']} {r['arm']} {r['workflow']} {r.get('specs')}: {_process_cols([r])}")
    return out


WEB = (("web_fetch", "WebFetch"), ("web_search", "WebSearch"), ("bash_fetch", "curl/wget"))


def web_table(rows: list[dict]) -> list[str]:
    """The web calls of the counted harness trials, per cell: each kind's total and the trials with any. Build trials
    (current and old specs apart) and maintenance trials (per task) are separate cells. A dimension, never in a mean."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r["status"] == "counted" and r["harness"] != "nop" and r["workflow"] != "probe":
            kind = f"maintenance {r['task']}" if r.get("task") else f"build {r.get('specs')}"
            groups[(r["stack"], kind, r["workflow"], r["arm"])].append(r)
    out = []
    for (stack, kind, workflow, arm), rs in sorted(groups.items()):
        parts = [f"{label} {sum(r.get(col) or 0 for r in rs)} ({sum(bool(r.get(col)) for r in rs)}/{len(rs)})" for col, label in WEB]
        out.append(f"{stack:9} {kind:15} {workflow:8} {arm:9} n={len(rs)} " + " ".join(parts))
    return out or ["no counted harness trials"]


def _mean_s(values: list, n: int) -> str:
    vals = [v for v in values if v is not None]
    return ("-" if not vals else f"{mean(vals):.1f} s") + (f" ({len(vals)}/{n})" if n > 1 and len(vals) < n else "")


def runtime_table(rows: list[dict]) -> list[str]:
    """The runtime metrics (the verifier's checks.json) of the counted build trials and the build-pin reference runs:
    per stack, old specs apart, the mean cold start, resume latency and seconds of each night 1 to 7."""
    keep = [r for r in rows if r["status"] == "counted" and (cell_arm(r) == "reference" or (r["harness"] != "nop" and r["workflow"] != "probe"))]
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in keep:
        groups[(r["stack"], r.get("specs"), r["arm"] == "reference")].append(r)
    out = []
    for (stack, specs, ref), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] != "current", kv[0][2])):
        nights = " ".join(f"night {n} {_mean_s([(r.get('night_s') or {}).get(str(n)) for r in rs], len(rs))}" for n in range(1, 8))
        out.append(f"{stack:9} {specs:9} {'reference ' if ref else ''}n={len(rs)} cold start {_mean_s([r.get('cold_start_s') for r in rs], len(rs))}"
                   f" resume latency {_mean_s([r.get('resume_latency_s') for r in rs], len(rs))} {nights}")
    return out or ["no build trial has runtime metrics"]


CODE = [  # (path in code-metrics.json, label, digits); a list's length where the value is a list
    ("size.code_lines", "code lines", 0), ("size.comment_lines", "comment lines", 0), ("size.files", "files", 0),
    ("size.modules", "modules", 0), ("glue.glue_lines", "glue lines", 0), ("glue.domain_lines", "domain lines", 0),
    ("glue.glue_files", "glue files", 0), ("glue.n_sdk_symbols", "SDK symbols", 0),
    ("type_escapes.per_kloc", "type escapes/kloc", 1), ("ruleset.per_kloc", "ruleset/kloc", 1),
    ("duplication.percentage", "duplicated %", 1), ("dead_code.n_unused_files", "unused files", 1),
    ("dead_code.n_unused_exports", "unused exports", 1), ("complexity.mean", "complexity mean", 2),
    ("complexity.max", "max", 0), ("coverage.line_pct", "line coverage", 1), ("coverage.glue_line_pct", "glue", 1),
    ("coverage.domain_line_pct", "domain", 1), ("dependencies.beyond_table", "deps beyond the table", 1),
    ("flakiness.passed_runs", "own tests green runs of 3", 1),
]
FLAGS = [("practices.ci", "ci"), ("practices.ci_passes", "ci_passes"), ("practices.pre_commit", "pre_commit"),
         ("practices.pre_commit_passes", "pre_commit_passes"), ("practices.linter", "linter"),
         ("practices.lint_passes", "lint_passes"), ("practices.formatter", "formatter"),
         ("practices.format_passes", "format_passes"), ("practices.readme", "readme"),
         ("practices.agents_md", "agents_md"), ("tsconfig.sha256_matches_given", "given tsconfig")]


def _at(metrics: dict, path: str):
    group, _, key = path.partition(".")
    v = (metrics.get(group) or {}).get(key)
    return len(v) if isinstance(v, list) else v


def _mean_of(values: list, n: int, nd: int, unit: str = "") -> str:
    """The mean of the values that are not null, with how many had one when some did not: a null is never a 0."""
    vals = [v for v in values if v is not None]
    return ("-" if not vals else f"{mean(vals):.{nd}f}{unit}") + (f" ({len(vals)}/{n})" if len(vals) < n else "")


def code_table(rows: list[dict]) -> list[str]:
    """The code and practice metrics (code_metrics.py) of counted build trials and build-pin reference runs: per stack, old
    specs apart, each metric's mean, the mean ratio to the stack's reference build (present when the step ran with
    `--reference`), and per flag how many trials have it."""
    keep = [r for r in rows if r["status"] == "counted" and (cell_arm(r) == "reference" or (r["harness"] != "nop" and r["workflow"] != "probe"))]
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in keep:
        groups[(r["stack"], r.get("specs"), r["arm"] == "reference")].append(r)
    out = []
    for (stack, specs, ref), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1] != "current", kv[0][2])):
        ms = [r["code_metrics"] for r in rs if r.get("code_metrics")]
        head = f"{stack:9} {specs:9} {'reference ' if ref else ''}n={len(rs)} (measured {len(ms)}/{len(rs)})"
        if not ms:
            out.append(head)
            continue
        out.append(head + " " + " ".join(f"{label} {_mean_of([_at(m, path) for m in ms], len(ms), nd)}" for path, label, nd in CODE))
        if any(m.get("ratios") for m in ms):
            out.append("    ratios to the reference: " + " ".join(
                f"{g}.{k} {_mean_of([(m.get('ratios') or {}).get(f'{g}.{k}') for m in ms], len(ms), 2, 'x')}" for g, k in RATIOS))
        else:
            out.append("    ratios to the reference: none (code_metrics.py ran without --reference)")
        flags = []
        for path, label in FLAGS:
            vals = [v for m in ms if (v := _at(m, path)) is not None]
            flags.append(f"{label} {sum(bool(v) for v in vals)}/{len(vals)}" if vals else f"{label} -")
        out.append("    practices: " + " ".join(flags))
        hits = [((m.get("code_checks") or {}).get("hardcoded_thresholds") or {}).get("n") for m in ms]
        known = [h for h in hits if h is not None]
        out.append("    code checks: hardcoded thresholds " + (
            f"{_mean_of(known, len(ms), 1)} lines, in {sum(h > 0 for h in known)}/{len(known)} builds" if known else "-"))
    return out or ["no build trial has code metrics"]


def report(rows: list[dict]) -> str:
    maintenance = [r for r in rows if r.get("task")]
    rows = [r for r in rows if not r.get("task")]
    lines = ["== outcome per cell (counted trials)", *cell_table(rows), "",
             "== hidden and real tests per cell (beside the reward, not in it)", *family_table(rows), "",
             "== full against bare, one-shot, within a stack"]
    per_stack = {s: [r for r in rows if r["stack"] == s and r["status"] == "counted" and r["workflow"] == "one-shot" and r["arm"] in ARMS.values()]
                 for s in ("inngest", "langchain")}
    for stack, rs in per_stack.items():
        for metric in ("reward", "cost_usd"):
            e = full_vs_bare(rs, metric)
            lines.append(f"{stack:9} {metric:8} full - bare {'-' if e['value'] is None else f'{e['value']:+.3f}'}  {e['call']}")
    lines += ["", "== 2 x 2 effects, one-shot, within a stack"]
    for stack, rs in per_stack.items():
        if not rs:
            lines.append(f"{stack}: no counted arm trials")
            continue
        for metric in ("reward", "cost_usd"):
            for e in effects(rs, metric):
                lines.append(f"{stack:9} {e['metric']:8} {e['effect']:11} {_fmt(e['value'])}  {e['call']}" + ("" if e.get("exact", True) else " (sampled)"))
    lines += ["", "== stack comparison", *stack_comparison(rows), "",
              "== process metrics per stack, from the session files (beside the reward, not in it)", *process_table(rows),
              "", "== web calls per cell (WebFetch, WebSearch, curl or wget of a non-local URL; total, trials with any)",
              *web_table(rows + maintenance),
              "", "== runtime metrics per stack, from the verifier's checks.json (beside the reward, not in it)", *runtime_table(rows),
              "", "== code and practice metrics per stack, from code_metrics.py (beside the reward, not in it)", *code_table(rows),
              "", "== kept out of every mean"]
    for status in ("leak", "infra"):
        kept = [r for r in rows if r["status"] == status]
        lines.append(f"{status}: {len(kept)}" + (f", ${sum(r['cost_usd'] or 0 for r in kept):.2f}" if kept else ""))
        lines += [f"    {r['job']}/{r['trial']} {r['stack']} {r['arm']} {r['exception_type'] or ''}{' usage limit' if r['usage_limit'] else ''} ${_fmt(r['cost_usd'], 2)}" for r in kept]
    lines.append(f"no reward (verifier off or failed): {sum(r['status'] == 'no-reward' for r in rows)}")
    lines.append(f"replaced by a later regrade: {sum(r['status'] == 'regraded' for r in rows)}")
    retries = {r["job"]: r.get("job_retries") or 0 for r in rows}
    retried = {j: n for j, n in sorted(retries.items()) if n}
    lines.append(f"retried attempts: {sum(retried.values())}" + (f" ({', '.join(f'{j} {n}' for j, n in retried.items())})" if retried else "")
                 + "; Harbor deletes a retried attempt's folder, so its cost is not recorded")
    lines += ["", "== maintenance trials (apart from build trials; resolved against the base's grade)", *maintenance_table(maintenance)]
    return "\n".join(lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] in (["counts"], ["pile"]) and len(args) > 1:
        for path in args[1:]:
            if args[0] == "counts":
                print(json.dumps({"trajectory": path, **lever_counts(json.loads(Path(path).read_text()))}))
            else:
                print(json.dumps({"app": path, **pile_progress(Path(path))}))
    elif args[:1] == ["report"] and len(args) == 2:
        print(report([json.loads(line) for line in Path(args[1]).read_text().splitlines() if line.strip()]))
    elif args and all(Path(a).is_dir() for a in args):
        dirs = [Path(a) for a in args]
        rows = collect(dirs)
        out = dirs[0] / "trials.jsonl"
        out.write_text("".join(json.dumps(r) + "\n" for r in rows))
        print(f"{len(rows)} trials -> {out}\n")
        print(report(rows))
    else:
        raise SystemExit(__doc__)
