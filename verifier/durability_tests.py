"""Durability: hidden tiers 3a and 3b (docs/codeclimb-eval-spec.md, "Hidden and real checks", tests 20 to 31).

Each test starts a `datenorm-smoke` mock night, puts a fault into it at a point it waits for (a stop, a lost
sandbox, a kill of the runtime), and reads the outcome from the night's files, `docker events` and `docker ps -a`.
A night that ends before its fault lands is run again under a new id, up to 3 tries, as night 5 is. Every test
leaves the services running: what it killed it starts again, and `ctx.ensure_services()` runs at its end.
"""

import json
import re
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from adapters import kill_group, run_group, spawn, tail
from families import Ctx, Test, created
from nights import DATENORM, REACH_S, RESUME_S, RUN_NIGHT, Night, leftover_containers, printed, sha256_file, wait_until

CAPITALS = "configs/capitals-smoke.yaml"
TRIES = 3
# Night 4: stop.json and no sandbox within 30 s of the stop; a following run-night exits within 60 s of it.
STOP_S = 30
FOLLOW_S = 60
# Test 20: the quiet time after the stop.
QUIET_S = 30
# Tests 21 and 22: a night that loses a sandbox or sees the server rerun, without a kill, ends as a mock night does.
NIGHT_S = 300
# Test 30: how long a start under a used id is watched for a row or a sandbox.
USED_ID_S = 20


# --- pure helpers: names, rows, files ---------------------------------------------------------------------------


def coder_sandbox(night_id: str, name: str, rnd: int | None = None) -> bool:
    """`cc-<exp id>`: a coder's sandbox (of round `rnd` when given)."""
    r = str(rnd) if rnd is not None else r"\d+"
    return re.fullmatch(rf"cc-{re.escape(night_id)}-r{r}-e\d+", name) is not None


def round_eval_sandbox(night_id: str, rnd: int, name: str) -> bool:
    """An evaluation sandbox of round `rnd`: a `cc-<night>-r<N>-` name that is no coder's and no noise run's.
    Inngest names it `cc-<eval id>` (`cc-<night>-r1-e0-eval`), LangChain `cc-<night>-r<N>-<kind>`; the noise run
    of round 2 is `cc-<night>-r1-e0-noise-r2` on Inngest, so `noise` is left out."""
    return name.startswith(f"cc-{night_id}-r{rnd}-") and not coder_sandbox(night_id, name) and "noise" not in name


def test_sandbox(night_id: str, name: str) -> bool:
    """The test evaluation's sandbox, `cc-<night>-test-r<N>` on both stacks."""
    return name.startswith(f"cc-{night_id}-test-")


def eval_ids(rows: list[dict]) -> tuple[list[str], list[str]]:
    """(every eval_id, those that occur more than once)."""
    ids = [r["eval_id"] for r in rows if r.get("eval_id")]
    return ids, sorted({e for e in ids if ids.count(e) > 1})


def experiment_rows(rows: list[dict], exp_id: str) -> list[dict]:
    # Noise and test rows carry the checkpoint's exp_id, so only experiment rows count.
    return [r for r in rows if r.get("kind") == "experiment" and r.get("exp_id") == exp_id]


def stamp(path: Path) -> tuple[str, int] | None:
    """sha256 and mtime of a file, None when it does not exist."""
    return (sha256_file(path), path.stat().st_mtime_ns) if path.exists() else None


def coder_finished(exp: Path) -> bool:
    """`code-state.json` holds the coder's final `stop`."""
    p = exp / "code-state.json"
    try:
        return bool(json.loads(p.read_text()).get("stop")) if p.exists() else False
    except ValueError:
        return False  # being rewritten


def complete_lines(text: str) -> list[str]:
    """The lines of a JSONL file that end in a newline: a kill may leave a torn last line."""
    lines = text.split("\n")
    return lines[:-1]


def session_lines(exp: Path) -> dict[str, list[str]]:
    """Each session file's complete lines, by file name."""
    d = exp / "session"
    return {f.name: complete_lines(f.read_text(errors="replace")) for f in sorted(d.glob("*.jsonl"))} if d.exists() else {}


def session_messages_n(exp: Path) -> int:
    return sum(1 for lines in session_lines(exp).values() for line in lines if '"message"' in line)


def session_bytes(exp: Path) -> int:
    d = exp / "session"
    return sum(f.stat().st_size for f in d.glob("*.jsonl")) if d.exists() else 0


def is_prefix(before: dict[str, list[str]], after: dict[str, list[str]]) -> tuple[bool, str]:
    """Every session line before the kill is still there, in order, at the start of its file."""
    if not any(before.values()):
        return False, "no session lines before the kill"
    bad = [f for f, lines in before.items() if after.get(f, [])[: len(lines)] != lines]
    sizes = {f: f"{len(before[f])} -> {len(after.get(f, []))}" for f in before}
    new = sorted(set(after) - set(before))
    return not bad, f"session lines {sizes}; new files {new}; not a prefix {bad}"


def root_parent(repo: Path, commit: str) -> tuple[bool, str]:
    """The commit has exactly one parent, and that parent has none: the night's round-0 import."""
    _, out = run_group(["git", "-C", str(repo), "rev-list", "--parents", "-n", "1", commit], repo, 60)
    parents = out.split()[1:]
    if len(parents) != 1:
        return False, f"{commit[:12]} has parents {parents}"
    _, out2 = run_group(["git", "-C", str(repo), "rev-list", "--parents", "-n", "1", parents[0]], repo, 60)
    grand = out2.split()[1:]
    return not grand and len(out2.split()) == 1, f"{commit[:12]}'s only parent {parents[0][:12]} has parents {grand}"


def in_docker(name: str) -> bool:
    _, out = run_group(["docker", "ps", "-a", "--format", "{{.Names}}", "--filter", f"name={name}"], Path("/"), 60)
    return name in out.split()


def remove(name: str) -> bool:
    """`docker rm -f`; True only if it removed the container (it exits 0 for a missing one too)."""
    code, out = run_group(["docker", "rm", "-f", name], Path("/"), 60)
    return code == 0 and name in out.split()


# --- the driver -------------------------------------------------------------------------------------------------


class Broken(Exception):
    """The test cannot go on (the runtime did not come back, the fault point was never reached): it fails."""


@dataclass
class Faulted:
    """A night with its fault in: what the checks read."""

    night: Night
    events: Path
    at_ns: int  # when the fault was put in
    what: list[str]  # what the fault killed, stopped or removed
    tries: list[str]
    finished: bool  # done.json within the limit
    snap: dict = field(default_factory=dict)


# A fault: (ctx, night, events log) -> (what it did, snapshot, landed). Not landed: the night got past the point
# first, so it runs again under a new id. It starts again whatever it stopped, or raises Broken.
Fault = Callable[[Ctx, Night, Path], tuple[list[str], dict, bool]]


def restart(ctx: Ctx) -> None:
    up, detail = ctx.adapter.restart_runtime(ctx.services)
    if not up:
        raise Broken(f"the runtime did not come back: {detail}\n{ctx.adapter.service_logs(ctx.services)[-1500:]}")


def start(ctx: Ctx, short: str, config: str = DATENORM) -> tuple[Night, object]:
    """A fresh id, `docker events` from before the start, then `run-night --no-wait`."""
    nid = ctx.night_id(short)
    events = ctx.events(nid)
    code, out = run_group([*RUN_NIGHT, "--config", config, "--night-id", nid, "--no-wait", "--mock"], ctx.app, 120)
    nt = ctx.night(config, nid)
    if code != 0:
        kill_group(events, wait_s=2)
        raise Broken(f"{nid}: run-night --no-wait exited {code}\n{out[-800:]}")
    return nt, events


def tidy(ctx: Ctx, nt: Night | None) -> None:
    """A night that never ended is stopped, so it cannot run into the next test; the services are made sure of."""
    if nt is not None and nt.done() is None and not (nt.night_dir / "stop.json").exists():
        run_group([*RUN_NIGHT, "stop", "--night", nt.night_id], ctx.app, 120)
    ctx.ensure_services()


def faulted_night(ctx: Ctx, short: str, reach: Callable[[Night, Path], bool], fault: Fault,
                  finish_s: float = RESUME_S, setup: Callable[[], None] | None = None) -> Faulted:
    """Start a night, wait for `reach`, put `fault` in, then wait `finish_s` for done.json."""
    tries: list[str] = []
    for _ in range(TRIES):
        nt, events = start(ctx, short)
        try:
            if not wait_until(lambda: reach(nt, events.log) or nt.done() is not None, REACH_S):
                raise Broken(f"{nt.night_id}: the fault point was not reached within {REACH_S}s")
            if nt.done() is not None:
                tries.append(f"{nt.night_id}: ended before the fault point")
                continue
            at = time.time_ns()
            what, snap, landed = fault(ctx, nt, events.log)
            if not what:
                raise Broken(f"{nt.night_id}: the fault did nothing")
            if not landed:
                tries.append(f"{nt.night_id}: got past the fault point before the fault landed")
                continue
            finished = wait_until(lambda: nt.done() is not None, finish_s, poll_s=1)
            return Faulted(nt, events.log, at, what, tries, finished, snap)
        finally:
            kill_group(events, wait_s=2)
            tidy(ctx, nt)
    raise Broken("; ".join(tries))


def guarded_test(fn: Callable[[Ctx], tuple[bool, str]]) -> Callable[[Ctx], tuple[bool, str]]:
    def run(ctx: Ctx) -> tuple[bool, str]:
        try:
            return fn(ctx)
        except Broken as e:
            return False, str(e)[-1500:]

    run.__name__ = fn.__name__
    return run


def prefix(f: Faulted) -> str:
    return f"{'; '.join(f.tries)}{'; ' if f.tries else ''}{f.night.night_id}: {f.what}; "


# --- night 5's conditions ---------------------------------------------------------------------------------------


def r1_state(nt: Night) -> Path:
    return nt.night_dir / "exps" / f"{nt.night_id}-r1-e0" / "code-state.json"


def night5(f: Faulted, round1_after: Callable[[str], bool]) -> tuple[bool, str]:
    """done.json, every eval_id once, round 1's code-state.json unchanged since before the fault, and no
    sandbox `round1_after` matches created after it."""
    nt = f.night
    ids, twice = eval_ids(nt.rows())
    before = f.snap.get("r1_state")
    unchanged = before is not None and stamp(r1_state(nt)) == before
    after = created(f.events, f.at_ns, f"cc-{nt.night_id}")
    r1 = [n for n in after if round1_after(n)]
    ok = f.finished and bool(ids) and not twice and unchanged and not r1
    return ok, (
        f"done.json within {RESUME_S}s {f.finished}; eval_ids {len(ids)}, twice {twice}; "
        f"round 1 code-state.json unchanged {unchanged}; created after the fault {after}, of round 1 {r1}"
    )


def any_r1(nid: str) -> Callable[[str], bool]:
    return lambda name: name.startswith(f"cc-{nid}-r1-")


def no_stop_json(nt: Night) -> tuple[bool, str]:
    have = (nt.night_dir / "stop.json").exists()
    return not have, f"stop.json {have}"


def r2_started(nt: Night, _: Path) -> bool:
    return (nt.night_dir / "exps" / f"{nt.night_id}-r2-e0").exists()


def kill_and_restart(ctx: Ctx, nt: Night, _: Path) -> tuple[list[str], dict, bool]:
    snap = {"r1_state": stamp(r1_state(nt))}
    killed = ctx.adapter.crash_runtime(ctx.services)
    landed = nt.done() is None
    restart(ctx)
    return killed, snap, landed


# --- tier 3a ----------------------------------------------------------------------------------------------------


def r1_eval_created(nt: Night, log: Path) -> bool:
    return any(round_eval_sandbox(nt.night_id, 1, n) for n in created(log, 0, f"cc-{nt.night_id}"))


def first_r1_eval(nt: Night, log: Path) -> str | None:
    return next((n for n in created(log, 0, f"cc-{nt.night_id}") if round_eval_sandbox(nt.night_id, 1, n)), None)


@guarded_test
def stop_during_eval(ctx: Ctx) -> tuple[bool, str]:
    """20: night 4's stop, put in once round 1's evaluation sandbox exists; then 30 s with no new row and no new
    `cc-<id>` container."""
    tries: list[str] = []
    for _ in range(TRIES):
        nid = ctx.night_id("sde")
        nt = ctx.night(DATENORM, nid)
        events = ctx.events(nid)
        follower = spawn(ctx.app, f"night-{nid}", [*RUN_NIGHT, "--config", DATENORM, "--mock", "--night-id", nid], ctx.adapter.LOGS)
        try:
            if not wait_until(lambda: r1_eval_created(nt, events.log) or nt.done() is not None, REACH_S):
                return False, f"{nid}: no round 1 evaluation sandbox within {REACH_S}s\n{tail(follower.log)[-800:]}"
            sandbox = first_r1_eval(nt, events.log)
            code, out = run_group([*RUN_NIGHT, "stop", "--night", nid], ctx.app, 120)
            stopped_at = time.time_ns()
            if nt.done() is not None:
                tries.append(f"{nid}: ended before the stop")
                continue
            stop_ok = code == 0 and printed("stopped", out)
            stop_json = nt.night_dir / "stop.json"

            def settled() -> bool:
                reason = json.loads(stop_json.read_text()).get("reason") if stop_json.exists() else None
                return reason == "manual" and not leftover_containers(nid)

            within = wait_until(settled, STOP_S, poll_s=1)
            rows0 = len(nt.rows())
            time.sleep(QUIET_S)
            rows1 = len(nt.rows())
            new = created(events.log, stopped_at, f"cc-{nid}")
            no_done = nt.done() is None
            no_test = not any(r.get("kind") == "test" for r in nt.rows())
            try:
                follower.proc.wait(timeout=FOLLOW_S)
            except subprocess.TimeoutExpired:
                pass
            follow_ok = printed("stopped", tail(follower.log))
        finally:
            kill_group(follower, wait_s=5)
            kill_group(events, wait_s=2)
            tidy(ctx, nt)
        ok = stop_ok and within and no_done and no_test and follow_ok and rows1 == rows0 and not new
        return ok, (
            f"{'; '.join(tries)}{'; ' if tries else ''}{nid}: stopped at {sandbox}; stop exited {code}, printed stopped "
            f"{stop_ok}; within {STOP_S}s stop.json manual and no cc-{nid} {within}; no done.json {no_done}; no test row "
            f"{no_test}; follower printed stopped {follow_ok}; rows {rows0} -> {rows1} over {QUIET_S}s; created after the "
            f"stop {new}\n{out[-300:]}"
        )
    return False, "; ".join(tries)


def remove_r1_eval(ctx: Ctx, nt: Night, log: Path) -> tuple[list[str], dict, bool]:
    name = first_r1_eval(nt, log) or ""
    gone = remove(name)
    # Removed nothing: the evaluation had already ended and removed it.
    return [name], {}, gone and nt.done() is None


@guarded_test
def eval_sandbox_lost(ctx: Ctx) -> tuple[bool, str]:
    """21: `docker rm -f` round 1's evaluation sandbox once: the night ends `done`, `r1-e0` has one row, no
    `stop.json`."""
    f = faulted_night(ctx, "esl", r1_eval_created, remove_r1_eval, finish_s=NIGHT_S)
    rows = experiment_rows(f.night.rows(), f"{f.night.night_id}-r1-e0")
    ok_stop, d_stop = no_stop_json(f.night)
    ok = f.finished and len(rows) == 1 and ok_stop
    return ok, f"{prefix(f)}removed; done.json within {NIGHT_S}s {f.finished}; r1-e0 experiment rows {len(rows)}; {d_stop}"


def r1_started(nt: Night, _: Path) -> bool:
    return (nt.night_dir / "exps" / f"{nt.night_id}-r1-e0").exists()


def rerun_server(ctx: Ctx, nt: Night, _: Path) -> tuple[list[str], dict, bool]:
    landed = nt.done() is None
    restart(ctx)  # LangChain's restart_runtime is `npm run server`, which is the fault here
    return ["npm run server"], {}, landed


@guarded_test
def server_rerun_mid_night(ctx: Ctx) -> tuple[bool, str]:
    """22 (LangChain): `npm run server` again mid-night: the night ends `done`, every `eval_id` once."""
    f = faulted_night(ctx, "srr", r1_started, rerun_server)
    ids, twice = eval_ids(f.night.rows())
    ok = f.finished and bool(ids) and not twice
    return ok, f"{prefix(f)}done.json within {RESUME_S}s {f.finished}; eval_ids {len(ids)}, twice {twice}"


# --- tier 3b ----------------------------------------------------------------------------------------------------


def kill_during(sandbox_of: Callable[[Night, Path], str | None]) -> Fault:
    """A kill while a sandbox runs; landed only if the sandbox is still there after it (the runtime is dead, so
    nothing removed it since) and the night has not ended."""

    def fault(ctx: Ctx, nt: Night, log: Path) -> tuple[list[str], dict, bool]:
        snap = {"r1_state": stamp(r1_state(nt))}
        killed = ctx.adapter.crash_runtime(ctx.services)
        name = sandbox_of(nt, log) or ""
        snap["sandbox"] = name
        landed = bool(name) and in_docker(name) and nt.done() is None
        snap.update(after_kill(nt))
        restart(ctx)
        return killed, snap, landed

    return fault


def after_kill(nt: Night) -> dict:
    """Round 1 and 2's coder and review files, as the kill left them."""
    d = nt.night_dir
    return {
        f"{p.parent.name}/{p.name}": stamp(p)
        for p in [d / "exps" / f"{nt.night_id}-r{k}-e0" / "code-state.json" for k in (1, 2)] + [d / "reviews" / f"r{k}.json" for k in (1, 2)]
    }


@guarded_test
def crash_mid_eval(ctx: Ctx) -> tuple[bool, str]:
    """23: kill the runtime during round 1's evaluation: night 5's conditions, counted from that kill. The
    interrupted evaluation may rerun on a sandbox of its own name, so of round 1's sandboxes only the coder's
    `cc-<id>-r1-e0` must not be created again."""
    f = faulted_night(ctx, "cme", r1_eval_created, kill_during(first_r1_eval))
    nid = f.night.night_id
    ok, detail = night5(f, lambda n: coder_sandbox(nid, n, 1))
    return ok, f"{prefix(f)}killed during {f.snap.get('sandbox')}; {detail}"


def test_created(nt: Night, log: Path) -> bool:
    return any(test_sandbox(nt.night_id, n) for n in created(log, 0, f"cc-{nt.night_id}"))


def first_test(nt: Night, log: Path) -> str | None:
    return next((n for n in created(log, 0, f"cc-{nt.night_id}") if test_sandbox(nt.night_id, n)), None)


@guarded_test
def crash_during_test_eval(ctx: Ctx) -> tuple[bool, str]:
    """24: kill during the test evaluation: one test row; no coder or review of rounds 1 and 2 runs again."""
    f = faulted_night(ctx, "cte", test_created, kill_during(first_test))
    nt = f.night
    files = {k: v for k, v in f.snap.items() if "/" in k}
    missing = sorted(k for k, v in files.items() if v is None)
    after = after_kill(nt)
    changed = sorted(k for k, v in files.items() if v is not None and after.get(k) != v)
    coders = [n for n in created(f.events, f.at_ns, f"cc-{nt.night_id}") if coder_sandbox(nt.night_id, n)]
    tests = sum(r.get("kind") == "test" for r in nt.rows())
    ok = f.finished and tests == 1 and not missing and not changed and not coders
    return ok, (
        f"{prefix(f)}killed during {f.snap.get('sandbox')}; done.json within {RESUME_S}s {f.finished}; test rows "
        f"{tests}; coder and review files missing at the kill {missing}, changed after it {changed}; coder sandboxes "
        f"created after it {coders}"
    )


def graceful(ctx: Ctx, nt: Night, _: Path) -> tuple[list[str], dict, bool]:
    snap = {"r1_state": stamp(r1_state(nt))}
    # Landed if the night had not ended when SIGTERM went out: a runtime may finish the work in hand during its
    # grace period (measured: the LangChain server ends the mock night inside `docker stop`'s 10 s), and the
    # night's conditions are then read as they are.
    landed = nt.done() is None
    stopped = ctx.adapter.stop_runtime(ctx.services)
    snap["ended_in_grace"] = nt.done() is not None
    restart(ctx)
    return stopped, snap, landed


@guarded_test
def graceful_restart(ctx: Ctx) -> tuple[bool, str]:
    """25: night 5 with SIGTERM instead of a kill: night 5's conditions and no `stop.json`."""
    f = faulted_night(ctx, "grs", r2_started, graceful)
    ok5, d5 = night5(f, any_r1(f.night.night_id))
    ok_stop, d_stop = no_stop_json(f.night)
    return ok5 and ok_stop, f"{prefix(f)}ended within the grace period {f.snap.get('ended_in_grace')}; {d5}; {d_stop}"


@guarded_test
def crash_at_init(ctx: Ctx) -> tuple[bool, str]:
    """26: kill as soon as `run-night --no-wait` returns: `done.json`, every `eval_id` once, one create of
    `cc-<id>-r1-e0`."""
    f = faulted_night(ctx, "cai", lambda nt, log: True, kill_and_restart)
    nid = f.night.night_id
    ids, twice = eval_ids(f.night.rows())
    r1 = [n for n in created(f.events, 0, f"cc-{nid}") if n == f"cc-{nid}-r1-e0"]
    ok = f.finished and bool(ids) and not twice and len(r1) == 1
    return ok, f"{prefix(f)}done.json within {RESUME_S}s {f.finished}; eval_ids {len(ids)}, twice {twice}; creates of cc-{nid}-r1-e0 {len(r1)}"


def r1_exp(nt: Night) -> Path:
    return nt.night_dir / "exps" / f"{nt.night_id}-r1-e0"


def r1_mid_session(nt: Night, _: Path) -> bool:
    """Round 1's coder has a session with a message and has not finished."""
    exp = r1_exp(nt)
    return session_messages_n(exp) > 0 and not coder_finished(exp)


def kill_mid_session(remove_sandbox: bool) -> Fault:
    """A kill while round 1's coder works; landed only if `code-state.json` has no final stop after it. The session
    is read after the kill, when nothing writes it. With `remove_sandbox`, the coder's sandbox is removed before
    the restart."""

    def fault(ctx: Ctx, nt: Night, _: Path) -> tuple[list[str], dict, bool]:
        killed = ctx.adapter.crash_runtime(ctx.services)
        exp = r1_exp(nt)
        landed = not coder_finished(exp) and nt.done() is None
        snap: dict = {"session": session_lines(exp)}
        if remove_sandbox:
            name = f"cc-{nt.night_id}-r1-e0"
            snap["removed"] = remove(name)
            killed = killed + ([f"docker rm -f {name}"] if snap["removed"] else [])
        restart(ctx)
        return killed, snap, landed

    return fault


@guarded_test
def session_reopen_after_kill(ctx: Ctx) -> tuple[bool, str]:
    """27 (Inngest): kill mid-session: no second create of `cc-<id>-r1-e0`; the session before the kill is a
    prefix of the final one."""
    f = faulted_night(ctx, "sra", r1_mid_session, kill_mid_session(False))
    nid = f.night.night_id
    r1 = [n for n in created(f.events, 0, f"cc-{nid}") if n == f"cc-{nid}-r1-e0"]
    pre, d_pre = is_prefix(f.snap["session"], session_lines(r1_exp(f.night)))
    ok = f.finished and len(r1) == 1 and pre
    return ok, f"{prefix(f)}done.json within {RESUME_S}s {f.finished}; creates of cc-{nid}-r1-e0 {len(r1)}; {d_pre}"


@guarded_test
def lost_sandbox_fresh_restart(ctx: Ctx) -> tuple[bool, str]:
    """28 (Inngest): kill, `docker rm -f cc-<id>-r1-e0`, restart: exactly one new create of it, one `r1-e0` row
    with the starter as its commit's only parent."""
    f = faulted_night(ctx, "lsf", r1_mid_session, kill_mid_session(True))
    nt = f.night
    nid = nt.night_id
    if not f.snap.get("removed"):
        return False, f"{prefix(f)}cc-{nid}-r1-e0 was not there to remove after the kill"
    again = [n for n in created(f.events, f.at_ns, f"cc-{nid}") if n == f"cc-{nid}-r1-e0"]
    rows = experiment_rows(nt.rows(), f"{nid}-r1-e0")
    row = rows[0] if len(rows) == 1 else {}
    parent_id = row.get("parent_id") == f"{nid}-r0-starter"
    commit = row.get("commit") or ""
    root_ok, d_root = root_parent(nt.dir / "experiments.git", commit) if commit else (False, "no commit on the row")
    ok = f.finished and len(again) == 1 and len(rows) == 1 and parent_id and root_ok
    return ok, (
        f"{prefix(f)}done.json within {RESUME_S}s {f.finished}; creates of cc-{nid}-r1-e0 after the kill {len(again)}; "
        f"r1-e0 experiment rows {len(rows)}; parent_id {row.get('parent_id')!r}; {d_root}"
    )


def r2_exp(nt: Night) -> Path:
    return nt.night_dir / "exps" / f"{nt.night_id}-r2-e0"


def r2_mid_session(nt: Night, _: Path) -> bool:
    exp = r2_exp(nt)
    return exp.exists() and not coder_finished(exp)


def kill_twice(ctx: Ctx, nt: Night, log: Path) -> tuple[list[str], dict, bool]:
    """Night 5's kill, then a second one once round 2's resumed session has grown past what the first left."""
    killed, snap, landed = kill_and_restart(ctx, nt, log)
    if not landed:
        return killed, snap, False
    size = session_bytes(r2_exp(nt))
    grew = wait_until(lambda: session_bytes(r2_exp(nt)) > size or nt.done() is not None, RESUME_S, poll_s=0.5)
    if not grew:
        raise Broken(f"{nt.night_id}: round 2's session did not grow within {RESUME_S}s of the restart ({size} bytes)")
    if nt.done() is not None:
        return killed, snap, False
    snap["second_at"] = time.time_ns()
    killed = killed + ctx.adapter.crash_runtime(ctx.services)
    landed = nt.done() is None
    restart(ctx)
    return killed, snap, landed


@guarded_test
def double_kill(ctx: Ctx) -> tuple[bool, str]:
    """29 (Inngest): night 5, then a second kill once the resumed session grows: night 5's conditions."""
    f = faulted_night(ctx, "dbk", r2_mid_session, kill_twice)
    ok, detail = night5(f, any_r1(f.night.night_id))
    return ok, f"{prefix(f)}{detail}"


@guarded_test
def server_stop_keeps_state(ctx: Ctx) -> tuple[bool, str]:
    """30 (LangChain): after a finished night, `server:stop` then `server`: every thread is still listed, the used
    id starts nothing, a fresh mock night ends `done`."""
    first = ctx.run_night(CAPITALS, "ssk")
    if first.done() is None:
        return False, f"{first.night_id}: the first night did not end done\n{first.output[-800:]}"
    before = ctx.adapter.thread_ids()
    ctx.adapter.stop_services(ctx.services)
    ctx.services = ctx.adapter.start_services(ctx.app)
    up, d_up = ctx.adapter.wait_until_up(ctx.services, ctx.adapter.SERVICES_UP_S)
    if not up:
        ctx.ensure_services()
        return False, f"server did not come back after server:stop: {d_up}"
    after = ctx.adapter.thread_ids()
    lost = sorted(before - after)

    nid = first.night_id
    rows0, done0 = len(first.rows()), stamp(first.night_dir / "done.json")
    events = ctx.events(f"{nid}-again")
    try:
        t0 = time.time_ns()
        code, out = run_group([*RUN_NIGHT, "--config", CAPITALS, "--night-id", nid, "--no-wait", "--mock"], ctx.app, 120)
        time.sleep(USED_ID_S)
        new = created(events.log, t0, f"cc-{nid}")
    finally:
        kill_group(events, wait_s=2)
    same = len(first.rows()) == rows0 and stamp(first.night_dir / "done.json") == done0

    fresh = ctx.run_night(CAPITALS, "ssk")
    fresh_ok = fresh.done() is not None and printed("done", fresh.output)
    ctx.ensure_services()
    ok = bool(before) and not lost and same and not new and fresh_ok
    return ok, (
        f"threads {len(before)} before, {len(after)} after, lost {lost[:5]}; the used id {nid}: exited {code}, rows "
        f"and done.json unchanged {same}, created {new}; fresh night {fresh.night_id} done {fresh_ok}"
    )


@guarded_test
def crash_with_watchdog(ctx: Ctx) -> tuple[bool, str]:
    """31 (LangChain): night 5 with `npm run api` running: night 5's conditions and no `stop.json`."""
    api, up, d_up = ctx.adapter.start_watchdog(ctx.services)
    try:
        if not up:
            return False, f"npm run api did not answer: {d_up}\n{tail(api.log)[-800:]}"
        f = faulted_night(ctx, "cwd", r2_started, kill_and_restart)
        alive = api.proc.poll() is None
    finally:
        kill_group(api, wait_s=10)
    ok5, d5 = night5(f, any_r1(f.night.night_id))
    ok_stop, d_stop = no_stop_json(f.night)
    return ok5 and ok_stop and alive, f"{prefix(f)}{d5}; {d_stop}; api alive to the end {alive}"


LC = frozenset({"langchain"})
INNGEST = frozenset({"inngest"})

TESTS: list[Test] = [
    Test("stop-during-eval", "hidden-3a", stop_during_eval),
    Test("eval-sandbox-lost", "hidden-3a", eval_sandbox_lost),
    Test("server-rerun-mid-night", "hidden-3a", server_rerun_mid_night, LC),
    Test("crash-mid-eval", "hidden-3b", crash_mid_eval),
    Test("crash-during-test-eval", "hidden-3b", crash_during_test_eval),
    Test("graceful-restart", "hidden-3b", graceful_restart),
    Test("crash-at-init", "hidden-3b", crash_at_init),
    Test("session-reopen-after-kill", "hidden-3b", session_reopen_after_kill, INNGEST),
    Test("lost-sandbox-fresh-restart", "hidden-3b", lost_sandbox_fresh_restart, INNGEST),
    Test("double-kill", "hidden-3b", double_kill, INNGEST),
    Test("server-stop-keeps-state", "hidden-3b", server_stop_keeps_state, LC),
    Test("crash-with-watchdog", "hidden-3b", crash_with_watchdog, LC),
]
