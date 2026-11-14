"""Job dirs -> trials.jsonl -> the tables the benchmark reports (docs/codeclimb-eval-spec.md, Metrics).

    python3 analyze.py <jobs dir>...                    # every trial -> <first dir>/trials.jsonl, then the report
    python3 analyze.py report <trials.jsonl>            # the report of an existing trials.jsonl
    python3 analyze.py counts <trajectory.json>...      # skill, MCP and doc-fetch calls per trajectory
    python3 analyze.py pile <app artifact dir>...       # pocock: tickets, tickets done, commits

The report: outcome per cell, the 2 x 2 effects within a stack (exact permutation tests), the stack comparison on
shared checks, and the trials kept out of every mean (leaks, infra errors). A trajectory is Harbor's
agent/trajectory.json: steps whose tool_calls name a function_name.
"""

import itertools
import json
import math
import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean

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
    m = re.fullmatch(r"(?:.*/)?codeclimb-(inngest|langchain)", result.get("task_name") or "")
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
            reward_valid=bool(rewards) and (row["exception_type"] is None or row["exception_type"] in REWARD_VALID_TYPES),
            verifier_s=_seconds(result.get("verifier")), started_at=result.get("started_at"),
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
        "leak": rewards.get("leak"),
        "agent_s": _seconds(result.get("agent_execution")),
        "verifier_s": _seconds(result.get("verifier")),
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
    }
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
    return rows


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
            cells[(r["stack"], r["workflow"], r["arm"])].append(r)
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


def stack_comparison(rows: list[dict]) -> list[str]:
    """Both stacks side by side, per (workflow, arm), on the checks both stacks' counted trials share."""
    counted = [r for r in rows if r["status"] == "counted"]
    per_stack = {s: {c for r in counted if r["stack"] == s for c in r["checks"] if "." not in c} for s in ("inngest", "langchain")}
    shared = sorted(per_stack["inngest"] & per_stack["langchain"])
    if not shared:
        return ["no shared checks: one stack has no counted trial"]
    out = [f"shared checks: {len(shared)}"]
    keys = sorted({(r["workflow"], r["arm"]) for r in counted})
    for workflow, arm in keys:
        cols = []
        for stack in ("inngest", "langchain"):
            rs = [r for r in counted if (r["stack"], r["workflow"], r["arm"]) == (stack, workflow, arm)]
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


def report(rows: list[dict]) -> str:
    lines = ["== outcome per cell (counted trials)", *cell_table(rows), "", "== full against bare, one-shot, within a stack"]
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
    lines += ["", "== stack comparison", *stack_comparison(rows), "", "== kept out of every mean"]
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
