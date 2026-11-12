"""The night checks: the done signal's check tables, read from stack-neutral outputs only
(the CLI's output, results.jsonl, nights/<id>/, experiments.git, docker ps)."""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from adapters import run_group

# Seconds a mock night may take before its run-night is killed. Measured: 6 to 16 s each.
NIGHT_S = 900


@dataclass
class Night:
    """One night the verifier ran: its number in the done signal, its config and what it left."""

    n: int
    config: str
    night_id: str
    name: str  # the results folder: the config's results_path directory
    dir: Path  # <app>/<runs>/mock/<name>
    exit_code: int
    output: str

    @property
    def night_dir(self) -> Path:
        return self.dir / "nights" / self.night_id

    def rows(self) -> list[dict]:
        path = self.dir / "results.jsonl"
        if not path.exists():
            return []
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        return [r for r in rows if r.get("night_id") == self.night_id]

    def done(self) -> dict | None:
        path = self.night_dir / "done.json"
        return json.loads(path.read_text()) if path.exists() else None

    def exps(self) -> list[Path]:
        d = self.night_dir / "exps"
        return sorted(p for p in d.iterdir() if p.is_dir()) if d.exists() else []


def results_name(app: Path, config: str) -> str:
    """The folder a config's results_path names: `datenorm-smoke/results.jsonl` -> `datenorm-smoke`."""
    text = (app / config).read_text()
    m = re.search(r"^results_path:\s*['\"]?([^'\"\s#]+)", text, re.M)
    if not m:
        raise ValueError(f"{config}: no results_path")
    return Path(m.group(1)).parent.as_posix()


def run_night(app: Path, runs: str, n: int, config: str, night_id: str, extra: list[str]) -> Night:
    cmd = ["npm", "run", "run-night", "--", "--config", config, "--mock", "--night-id", night_id, *extra]
    code, out = run_group(cmd, app, NIGHT_S)
    name = results_name(app, config)
    return Night(n, config, night_id, name, app / runs / "mock" / name, code, out)


# A check of one night: (passed, detail).
NightCheck = Callable[[Night], tuple[bool, str]]


def sh(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    return run_group(cmd, cwd or Path.cwd(), 300)


def session_messages(exp: Path) -> list[dict]:
    """The `message` entries of an experiment's session files, in order."""
    msgs = []
    for f in sorted((exp / "session").glob("*.jsonl")):
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            if entry.get("type") == "message" and isinstance(entry.get("message"), dict):
                msgs.append(entry["message"])
    return msgs


def text_of(msg: dict) -> str:
    c = msg.get("content")
    if isinstance(c, str):
        return c
    return " ".join(x.get("text", "") for x in c or [] if isinstance(x, dict))


def sendbacks_then_wrapup(exp: Path) -> tuple[bool, str]:
    users = [text_of(m) for m in session_messages(exp) if m.get("role") == "user"]
    kinds = ["sendback" if "You stopped with" in t else "wrapup" if "change no more code" in t else "other" for t in users]
    tail = [k for k in kinds if k != "other"]
    ok = tail == ["sendback"] * 8 + ["wrapup"]
    return ok, f"{exp.name}: {tail.count('sendback')} send-backs, {tail.count('wrapup')} wrap-ups, order {'ok' if ok else tail}"


def no_sendbacks(exp: Path) -> tuple[bool, str]:
    users = [text_of(m) for m in session_messages(exp) if m.get("role") == "user"]
    hits = [t for t in users if "You stopped with" in t or "change no more code" in t]
    return not hits, f"{exp.name}: {len(hits)} send-backs or wrap-ups"


def all_of(results: list[tuple[bool, str]]) -> tuple[bool, str]:
    return all(ok for ok, _ in results) and bool(results), "; ".join(d for _, d in results) or "nothing to check"


def leftover_containers(night_id: str) -> list[str]:
    _, out = sh(["docker", "ps", "-a", "--format", "{{.Names}}", "--filter", f"name=cc-{night_id}"])
    return [n for n in out.split() if n.startswith(f"cc-{night_id}")]


# --- the first table -------------------------------------------------------------------------------------------


def cli_done(night: Night) -> tuple[bool, str]:
    done = night.done() or {}
    want = {"plateau"} if night.n == 3 else {"max_rounds", "thresholds"}
    printed = re.search(r"^\s*done\b", night.output, re.M) is not None
    ok = printed and done.get("stop_reason") in want
    return ok, f"printed done: {printed}; stop_reason {done.get('stop_reason')!r}, want {sorted(want)}"


def end_files(night: Night) -> tuple[bool, str]:
    d = night.night_dir
    have = {f: (d / f).exists() for f in ("done.json", "stop.json", "pause.json")}
    return have == {"done.json": True, "stop.json": False, "pause.json": False}, str(have)


def validate_results(night: Night) -> tuple[bool, str]:
    path = night.dir / "results.jsonl"
    if not path.exists():
        return False, "no results.jsonl"
    code, out = sh(["npm", "run", "validate-results", "--", str(path)], cwd=night.dir.parents[2])
    return code == 0, out[-500:]


def row_per_experiment(night: Night) -> tuple[bool, str]:
    rows = night.rows()
    exp_rows = {r.get("exp_id") for r in rows if r.get("kind") == "experiment"}
    exps = {p.name for p in night.exps()}
    rounds = (night.done() or {}).get("rounds", 0)
    per_round = all(any(r.get("kind") == "experiment" and r.get("round") == k for r in rows) for k in range(1, rounds + 1))
    test = sum(r.get("kind") == "test" for r in rows)
    ok = bool(exps) and exps <= exp_rows and per_round and rounds > 0 and test >= 1
    return ok, f"exps {sorted(exps)}; experiment rows {sorted(x for x in exp_rows if x)}; rounds {rounds}; test rows {test}"


def mock_commit(night: Night) -> tuple[bool, str]:
    repo = night.dir / "experiments.git"
    ref = f"refs/exp/{night.night_id}-r1-e0"
    code, log = sh(["git", "-C", str(repo), "log", "--oneline", "-1", ref])
    if code != 0:
        return False, log[-300:]
    _, diff = sh(["git", "-C", str(repo), "diff-tree", "--no-commit-id", "--name-status", "-r", ref])
    adds = any(line.split() == ["A", "MOCK.md"] for line in diff.splitlines())
    return adds, f"{log.strip()}; adds MOCK.md: {adds}"


def code_state_and_session(night: Night) -> tuple[bool, str]:
    out = []
    for exp in night.exps():
        state = exp / "code-state.json"
        stop = json.loads(state.read_text()).get("stop") if state.exists() else None
        sessions = list((exp / "session").glob("*")) if (exp / "session").exists() else []
        out.append((stop == "done" and bool(sessions), f"{exp.name}: stop {stop!r}, {len(sessions)} session files"))
    return all_of(out)


def reviews(night: Night) -> tuple[bool, str]:
    rounds = (night.done() or {}).get("rounds", 0)
    out = []
    for k in range(1, rounds + 1):
        p = night.night_dir / "reviews" / f"r{k}.json"
        fb = json.loads(p.read_text()).get("feedback") if p.exists() else None
        out.append((fb == "mock feedback", f"r{k}: {fb!r}"))
    return all_of(out)


def sendbacks(night: Night) -> tuple[bool, str]:
    out = []
    for exp in night.exps():
        files = all((exp / f).exists() for f in ("train-score.json", "tasks.json"))
        ok, detail = sendbacks_then_wrapup(exp)
        out.append((files and ok, f"{detail}; train-score.json and tasks.json: {files}"))
    return all_of(out)


def notes_of(night: Night, verdict_on_last_only: bool) -> tuple[bool, str]:
    notes = night.night_dir / "bundle" / "history" / "notes"
    by_round: dict[str, list[Path]] = {}
    for exp in night.exps():
        m = re.search(r"-r(\d+)-e(\d+)$", exp.name)
        if m:
            by_round.setdefault(m.group(1), []).append(exp)
    out = []
    for rnd, exps in sorted(by_round.items()):
        exps.sort(key=lambda p: int(p.name.rsplit("-e", 1)[1]))
        for i, exp in enumerate(exps):
            e = exp.name.rsplit("-e", 1)[1]
            path = notes / f"r{rnd}-e{e}.md"
            text = path.read_text() if path.exists() else ""
            last = i == len(exps) - 1
            need_verdict = last if verdict_on_last_only else True
            ok = "mock note" in text and ("mock verdict" in text or not need_verdict)
            out.append((ok, f"{path.name}: exists {path.exists()}, mock note {'mock note' in text}, mock verdict {'mock verdict' in text}"))
    return all_of(out)


def notes(night: Night) -> tuple[bool, str]:
    # Every experiment of nights 1, 2, 3 and 6 is its round's only one, so each is reviewed.
    return notes_of(night, verdict_on_last_only=False)


def decision_reason(night: Night) -> tuple[bool, str]:
    rows = [r for r in night.rows() if r.get("kind") == "experiment"]
    missing = [r.get("exp_id") for r in rows if not r.get("decision_reason")]
    return bool(rows) and not missing, f"{len(rows)} experiment rows, without decision_reason: {missing}"


def keep_rule(night: Night) -> tuple[bool, str]:
    rows = night.rows()
    kept = [r for r in rows if r.get("kind") == "experiment" and r.get("decision") == "keep"]
    if night.name == "capitals-smoke":
        return not kept and bool(rows), f"kept: {[r.get('exp_id') for r in kept]}"
    r1 = next((r for r in rows if r.get("exp_id") == f"{night.night_id}-r1-e0" and r.get("kind") == "experiment"), {})
    noise = [r for r in rows if r.get("kind") == "noise" and r.get("round") == 2]
    acc = (r1.get("metrics") or {}).get("accuracy")
    ok = r1.get("decision") == "keep" and isinstance(acc, (int, float)) and acc > 0 and bool(noise)
    ok = ok and (night.night_dir / "noise.json").exists()
    return ok, f"r1-e0 decision {r1.get('decision')!r}, dev accuracy {acc}; round-2 noise rows {len(noise)}; noise.json {(night.night_dir / 'noise.json').exists()}"


def spend_zero(night: Night) -> tuple[bool, str]:
    done = night.done() or {}
    return done.get("spend_usd") == 0, f"spend_usd {done.get('spend_usd')!r}"


def meter_files(night: Night) -> tuple[bool, str]:
    evals = sorted(p for p in (night.night_dir / "evals").glob("*") if p.is_dir()) if (night.night_dir / "evals").exists() else []
    out = []
    for ev in evals:
        meter = ev / "meter.jsonl"
        lines = [json.loads(x) for x in meter.read_text().splitlines() if x.strip()] if meter.exists() else []
        errors = [x for x in lines if x.get("error")]
        out.append((bool(lines) and not errors, f"{ev.name}: {len(lines)} calls, {len(errors)} with error"))
    return all_of(out)


def no_leftover_sandbox(night: Night) -> tuple[bool, str]:
    # A negative check counts only with its positive one.
    if night.done() is None:
        return False, "no done.json, so the absence of containers proves nothing"
    left = leftover_containers(night.night_id)
    return not left, f"left: {left}"


# (row name, the nights it applies to by results folder (None: every first-table night), check)
FIRST_TABLE: list[tuple[str, set[str] | None, NightCheck]] = [
    ("cli-done", None, cli_done),
    ("end-files", None, end_files),
    ("validate-results", None, validate_results),
    ("row-per-experiment", None, row_per_experiment),
    ("mock-commit", None, mock_commit),
    ("code-state", None, code_state_and_session),
    ("reviews", None, reviews),
    ("send-backs", None, sendbacks),
    ("notes", None, notes),
    ("decision-reason", None, decision_reason),
    ("keep-rule", {"datenorm-smoke", "capitals-smoke"}, keep_rule),
    ("spend-zero", None, spend_zero),
    ("meter", {"capitals-smoke"}, meter_files),
    ("no-leftover-sandbox", None, no_leftover_sandbox),
]

# The nights that share the first table, in the done signal's order.
FIRST_TABLE_NIGHTS: list[tuple[int, str, list[str]]] = [
    (1, "configs/capitals-smoke.yaml", []),
    (2, "configs/datenorm-smoke.yaml", []),
    (3, "configs/e2e/plateau.yaml", []),
    (6, "configs/datenorm-smoke.yaml", ["--mock-offline", "6"]),
]

