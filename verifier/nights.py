"""The night checks: the done signal's check tables, read from stack-neutral outputs only
(the CLI's output, results.jsonl, nights/<id>/, experiments.git, docker ps)."""

import hashlib
import json
import re
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from adapters import Adapter, Services, kill_group, run_group, spawn, tail

# Seconds a mock night may take before its run-night is killed. Measured: 6 to 16 s each, night 7 under a minute.
NIGHT_S = 300
# Seconds a night may take to reach the point a check waits for (round 1 started, round 2 started).
REACH_S = 120
# Seconds night 5 may take to end after the restart: the LangChain runs sweeper picks the killed run up about
# 2 minutes after `up`, an Inngest step lease expires about 2 minutes after the kill.
RESUME_S = 480
RUN_NIGHT = ["npm", "run", "run-night", "--"]
DATENORM = "configs/datenorm-smoke.yaml"
GRAPHRAG = "configs/graphrag-smoke.yaml"
GRAPHRAG_LESSONS = "scenarios/graphrag/spec/agent/lessons.md"


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
    # Night 7: sha256 of the scenario's lessons.md before the night.
    lessons_before: str | None = None

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


def night_of(app: Path, runs: str, n: int, config: str, night_id: str, code: int = -1, out: str = "") -> Night:
    name = results_name(app, config)
    return Night(n, config, night_id, name, app / runs / "mock" / name, code, out)


def run_night(app: Path, runs: str, n: int, config: str, night_id: str, extra: list[str]) -> Night:
    """Run a night to its end, following it."""
    code, out = run_group([*RUN_NIGHT, "--config", config, "--mock", "--night-id", night_id, *extra], app, NIGHT_S)
    return night_of(app, runs, n, config, night_id, code, out)


def wait_until(cond: Callable[[], bool], timeout_s: float, poll_s: float = 0.2) -> bool:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        if cond():
            return True
        time.sleep(poll_s)
    return cond()


def printed(word: str, out: str) -> bool:
    return re.search(rf"^\s*{word}\b", out, re.M) is not None


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
    said = printed("done", night.output)
    ok = said and done.get("stop_reason") in want
    return ok, f"printed done: {said}; stop_reason {done.get('stop_reason')!r}, want {sorted(want)}"


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


# --- nights 3 to 6: the row each adds ------------------------------------------------------------------------


def plateau_stop(night: Night) -> tuple[bool, str]:
    """Night 3: done with stop_reason plateau after one round, a test row, no leftover sandbox."""
    done = night.done() or {}
    said = printed("done", night.output)
    test = any(r.get("kind") == "test" for r in night.rows())
    left = leftover_containers(night.night_id) if done else ["(no done.json)"]
    ok = said and done.get("stop_reason") == "plateau" and done.get("rounds") == 1 and test and not left
    return ok, f"printed done {said}; stop_reason {done.get('stop_reason')!r}; rounds {done.get('rounds')!r}; test row {test}; left {left}"


def hard_stop(app: Path, runs: str, logs: Path, night_id: str) -> tuple[bool, str]:
    """Night 4: start a night with a follower, stop it once round 1 has started; the stop command, stop.json,
    the missing done.json and test row, the sandboxes and the follower all say it stopped."""
    nt = night_of(app, runs, 4, DATENORM, night_id)
    follower = spawn(app, f"night-{night_id}", [*RUN_NIGHT, "--config", DATENORM, "--mock", "--night-id", night_id], logs)
    try:
        if not wait_until(lambda: (nt.night_dir / "exps" / f"{night_id}-r1-e0").exists(), REACH_S):
            return False, f"round 1 did not start within {REACH_S}s\n{tail(follower.log)}"
        code, out = run_group([*RUN_NIGHT, "stop", "--night", night_id], app, 120)
        stop_ok = code == 0 and printed("stopped", out)
        stop_json = nt.night_dir / "stop.json"

        def stopped() -> bool:
            reason = json.loads(stop_json.read_text()).get("reason") if stop_json.exists() else None
            return reason == "manual" and not leftover_containers(night_id)

        settled = wait_until(stopped, 30, poll_s=1)
        no_done = nt.done() is None
        no_test = not any(r.get("kind") == "test" for r in nt.rows())
        try:
            follower.proc.wait(timeout=60)
        except subprocess.TimeoutExpired:
            pass
        follow_out = tail(follower.log)
        follow_ok = printed("stopped", follow_out)
    finally:
        kill_group(follower, wait_s=5)
    ok = stop_ok and settled and no_done and no_test and follow_ok
    return ok, (
        f"stop exited {code}, printed stopped {stop_ok}; within 30 s stop.json manual and no cc-{night_id} {settled}; "
        f"no done.json {no_done}; no test row {no_test}; follower printed stopped {follow_ok}\n{out[-500:]}\n{follow_out[-800:]}"
    )


def crash_resume(app: Path, runs: str, adapter: Adapter, services: Services, tag: str) -> tuple[bool, str]:
    """Night 5: kill the runtime once round 2 has started, start it again, and nothing else. The night ends with
    every evaluation recorded once, round 1's coder not run again and no round 1 sandbox created after the kill.
    A night that ends before the kill lands is run again under a new id; one that stalls fails."""
    tries = []
    for attempt in "abc":
        night_id = f"{tag}-n5{attempt}"
        nt = night_of(app, runs, 5, DATENORM, night_id)
        events = spawn(
            app,
            f"events-{night_id}",
            ["docker", "events", "--filter", "type=container", "--filter", "event=create", "--format", "{{.TimeNano}} {{.Actor.Attributes.name}}"],
            adapter.LOGS,
        )
        try:
            code, out = run_group([*RUN_NIGHT, "--config", DATENORM, "--mock", "--no-wait", "--night-id", night_id], app, 120)
            if code != 0:
                return False, f"{night_id}: run-night --no-wait exited {code}\n{out[-1000:]}"
            r2 = nt.night_dir / "exps" / f"{night_id}-r2-e0"
            if not wait_until(lambda: r2.exists() or nt.done() is not None, REACH_S):
                return False, f"{night_id}: neither round 2 nor done.json within {REACH_S}s"
            if nt.done() is not None:
                tries.append(f"{night_id}: ended before round 2 was seen running")
                continue
            state = nt.night_dir / "exps" / f"{night_id}-r1-e0" / "code-state.json"
            before = (sha256_file(state), state.stat().st_mtime_ns) if state.exists() else None
            killed_at = time.time_ns()
            killed = adapter.crash_runtime(services)
            ended_first = nt.done() is not None
            up, up_detail = adapter.restart_runtime(services)
            if not up:
                return False, f"{night_id}: the runtime did not come back: {up_detail}\n{adapter.service_logs(services)}"
            if not killed:
                return False, f"{night_id}: crash_runtime killed nothing"
            if ended_first:
                tries.append(f"{night_id}: ended before the kill landed")
                continue
            finished = wait_until(lambda: nt.done() is not None, RESUME_S, poll_s=1)
            after = (sha256_file(state), state.stat().st_mtime_ns) if state.exists() else None
        finally:
            kill_group(events, wait_s=2)
        ids = [r.get("eval_id") for r in nt.rows() if r.get("eval_id")]
        twice = sorted({e for e in ids if ids.count(e) > 1})
        created_after = [
            name
            for ts, _, name in (line.partition(" ") for line in events.log.read_text().splitlines())
            if ts.isdigit() and int(ts) > killed_at and name.startswith(f"cc-{night_id}")
        ]
        r1_after = [n for n in created_after if n.startswith(f"cc-{night_id}-r1-")]
        unchanged = before is not None and before == after
        ok = finished and bool(ids) and not twice and unchanged and not r1_after
        return ok, (
            f"{'; '.join(tries)}{'; ' if tries else ''}{night_id}: killed {killed}; done.json within {RESUME_S}s {finished}; "
            f"eval_ids {len(ids)}, twice {twice}; round 1 code-state.json unchanged {unchanged}; "
            f"sandboxes created after the kill {created_after}, of round 1 {r1_after}"
        )
    return False, "; ".join(tries)


def lost_connection(night: Night) -> tuple[bool, str]:
    """Night 6: round 1's session has an assistant message with stop reason error, then clean ones."""
    exp = night.night_dir / "exps" / f"{night.night_id}-r1-e0"
    stops = [m.get("stopReason") for m in session_messages(exp) if m.get("role") == "assistant"]
    first_error = stops.index("error") if "error" in stops else -1
    ok = first_error >= 0 and any(s != "error" for s in stops[first_error + 1 :])
    return ok, f"assistant stop reasons: {stops[:20]}"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# --- night 7: graphrag-smoke's own table ----------------------------------------------------------------------

STAGES = ("extraction", "graph", "retrieval")
STANDARD_PREFIXES = ("cost_", "model_calls", "latency_")


def exp_parts(name: str) -> tuple[int, int]:
    m = re.search(r"-r(\d+)-e(\d+)$", name)
    return (int(m.group(1)), int(m.group(2))) if m else (-1, -1)


def g_rows(night: Night) -> tuple[bool, str]:
    rows = night.rows()
    exps = [r for r in rows if r.get("kind") == "experiment"]
    rounds = (night.done() or {}).get("rounds", 0)
    tests = sum(r.get("kind") == "test" for r in rows)
    by = {exp_parts(r.get("exp_id", "")): r for r in exps}
    e0_all = rounds > 0 and all((k, 0) in by for k in range(1, rounds + 1))
    e1_ok = all(by.get((k, 0), {}).get("decision") == "error" for (k, e) in by if e == 1)
    no_e2 = all(e < 2 for (_, e) in by)
    ok = e0_all and tests == 1 and e1_ok and no_e2
    return ok, f"rounds {rounds}; experiment rows {sorted(by)}; test rows {tests}; e1 only after an e0 error {e1_ok}; no e2 {no_e2}"


def g_sessions(night: Night) -> tuple[bool, str]:
    out = []
    for exp in night.exps():
        _, e = exp_parts(exp.name)
        ok, detail = sendbacks_then_wrapup(exp) if e == 0 else no_sendbacks(exp)
        files = all((exp / f).exists() for f in ("train-score.json", "tasks.json"))
        out.append((ok and files, f"{detail}; train-score.json and tasks.json: {files}"))
    return all_of(out)


def g_notes(night: Night) -> tuple[bool, str]:
    return notes_of(night, verdict_on_last_only=True)


def g_check_json(night: Night) -> tuple[bool, str]:
    out = []
    for exp in night.exps():
        p = exp / "check.json"
        errors = json.loads(p.read_text()).get("errors") if p.exists() else None
        out.append((errors == [], f"{exp.name}: errors {errors!r}"))
    return all_of(out)


def evals(night: Night) -> list[Path]:
    d = night.night_dir / "evals"
    return sorted(p for p in d.iterdir() if p.is_dir()) if d.exists() else []


def g_extraction_inputs(night: Night) -> tuple[bool, str]:
    out = []
    for ev in evals(night):
        inputs = ev / "extraction" / "inputs.jsonl"
        lines = len([x for x in inputs.read_text().splitlines() if x.strip()]) if inputs.exists() else 0
        log = (ev / "extraction" / "run.log").exists()
        out.append((lines == 8 and log, f"{ev.name}: {lines} input lines, run.log {log}"))
    return all_of(out)


def test_eval_dir(night: Night) -> Path:
    rounds = (night.done() or {}).get("rounds", 0)
    return night.night_dir / "evals" / f"{night.night_id}-test-r{rounds}"


def g_test_stages(night: Night) -> tuple[bool, str]:
    ev = test_eval_dir(night)
    out = []
    for stage in STAGES:
        have = {f: (ev / stage / f).exists() for f in ("inputs.jsonl", "run.log", "outputs", "report.json")}
        out.append((all(have.values()), f"{ev.name}/{stage}: {have}"))
    return all_of(out)


def g_metrics_json(night: Night) -> tuple[bool, str]:
    test_metrics = (test_eval_dir(night) / "metrics.json").exists()
    unscored = [r for r in night.rows() if r.get("kind") == "experiment" and r.get("decision") == "error"]
    bad = [r.get("exp_id") for r in unscored if len(r.get("metrics") or {}) != 1 or list((r.get("metrics") or {}).values()) != [0]]
    return test_metrics and not bad, f"test metrics.json {test_metrics}; unscored rows {len(unscored)}, not primary-only at 0: {bad}"


def stage_metric_names(metrics: dict) -> tuple[bool, str]:
    names = set(metrics)
    stages = all(any(n.startswith(f"{s}.") for n in names) and f"{s}.output_bytes" in names for s in STAGES)
    others = [n for n in names if not n.startswith(tuple(f"{s}." for s in STAGES)) and not n.startswith(STANDARD_PREFIXES)]
    return stages and not others, f"three stages with output_bytes {stages}; other names {others}"


def g_stage_metrics(night: Night) -> tuple[bool, str]:
    test = next((r for r in night.rows() if r.get("kind") == "test"), {})
    done = night.done() or {}
    ok1, d1 = stage_metric_names(test.get("metrics") or {})
    ok2, d2 = stage_metric_names(done.get("test_metrics") or {})
    return ok1 and ok2, f"test row: {d1}; done.json: {d2}"


def g_meter(night: Night) -> tuple[bool, str]:
    ok, detail = meter_files(night)
    test = next((r for r in night.rows() if r.get("kind") == "test"), {})
    m = test.get("metrics") or {}
    calls = isinstance(m.get("model_calls"), (int, float)) and m["model_calls"] > 0
    free = m.get("cost_usd") == 0
    return ok and calls and free, f"{detail}; test model_calls {m.get('model_calls')!r}, cost_usd {m.get('cost_usd')!r}"


def g_noise(night: Night) -> tuple[bool, str]:
    rows = night.rows()
    kept = any(r.get("kind") == "experiment" and r.get("decision") == "keep" for r in rows)
    noise = (night.night_dir / "noise.json").exists() or any(r.get("kind") == "noise" for r in rows)
    return kept or not noise, f"kept {kept}; noise.json or noise row {noise}"


def g_lessons(night: Night) -> tuple[bool, str]:
    rounds = (night.done() or {}).get("rounds", 0)
    d = night.dir / "lessons" / f"{night.night_id}-r{rounds}"
    names = ("lessons.md", "changes.md", "proposal.json")
    # Within a minute of done.
    wait_until(lambda: all((d / f).exists() for f in names), 60, poll_s=1)
    files = {f: (d / f).exists() for f in names}
    prop = json.loads((d / "proposal.json").read_text()) if files["proposal.json"] else {}
    empty = prop.get("ops") == [] and not prop.get("applied")
    lessons = night.dir.parents[2] / GRAPHRAG_LESSONS
    unchanged = night.lessons_before is not None and lessons.exists() and sha256_file(lessons) == night.lessons_before
    ok = all(files.values()) and empty and unchanged
    return ok, f"{d.name}: {files}; ops empty and not applied {empty}; {GRAPHRAG_LESSONS} unchanged {unchanged}"


def run_night7(app: Path, runs: str, night_id: str) -> tuple[Night | None, str]:
    """Build the graphrag image, then run night 7. No night when the image does not build."""
    code, out = run_group(["npm", "run", "build:image:graphrag"], app, 1200)
    if code == 0:
        code, more = run_group(["docker", "image", "inspect", "codeclimb-graphrag"], app, 60)
        out += more
    if code != 0:
        return None, f"build:image:graphrag failed\n{out[-1500:]}"
    lessons = app / GRAPHRAG_LESSONS
    before = sha256_file(lessons) if lessons.exists() else None
    night = run_night(app, runs, 7, GRAPHRAG, night_id, [])
    night.lessons_before = before
    return night, "image built"


# Night 7's own table, in the done signal's order (each row counts once).
NIGHT7_TABLE: list[tuple[str, NightCheck]] = [
    ("graphrag-rows", g_rows),
    ("graphrag-sessions", g_sessions),
    ("graphrag-notes", g_notes),
    ("graphrag-check-json", g_check_json),
    ("graphrag-extraction-inputs", g_extraction_inputs),
    ("graphrag-test-stages", g_test_stages),
    ("graphrag-metrics-json", g_metrics_json),
    ("graphrag-stage-metrics", g_stage_metrics),
    ("graphrag-meter", g_meter),
    ("graphrag-noise", g_noise),
    ("graphrag-lessons", g_lessons),
]
# The rows of the first table that night 7 carries over unchanged.
NIGHT7_CARRIES = {
    "cli-done", "end-files", "validate-results", "mock-commit", "code-state",
    "reviews", "decision-reason", "spend-zero", "no-leftover-sandbox",
}
