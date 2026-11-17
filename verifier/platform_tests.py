"""Platform: hidden tests on runtime behaviour that the stacks' skills and docs teach (docs/codeclimb-eval-spec.md,
"Hidden and real checks", tests 50 to 59). Each test starts a `datenorm-smoke` mock night, puts a fault into it and
reads the outcome from the night's files, `docker events` and `docker ps -a`, as the durability tests do.
"""

import json
import shutil
import time
from collections.abc import Callable
from pathlib import Path

from adapters import kill_group, run_group, spawn, tail
from durability_tests import (FOLLOW_S, RESUME_S, NIGHT_S, QUIET_S, TRIES, Broken, Faulted, coder_sandbox, eval_ids,
                              experiment_rows, faulted_night, guarded_test, night5, prefix, r1_eval_created, r1_started,
                              r1_state, remove, restart, round_eval_sandbox, stamp, start, tidy)
from families import MOCK_NIGHT_S, Ctx, Test, created
from nights import REACH_S, RUN_NIGHT, Night, leftover_containers, printed, wait_until

# Test 54: how long every round-1 evaluation sandbox is removed as it appears.
REMOVE_S = 120
# Test 55: faults that must land before the test passes.
KILLS = 2
# Test 53: the backstop the hook sets, and how long after the start stop.json and a clean night may take.
BACKSTOP_S = 30
BACKSTOP_END_S = 90
# Test 59: the config's `hard_deadline` (change C7), with test 53's bounds; the soft deadline stays the config's 3h.
HARD_DEADLINE_S = 30
# Tests 56 and 57: the pause timeout the hook sets; the scripted credit error ends the coder's first call.
PAUSE_TIMEOUT_S = 60
MOCK_CREDIT = "coder:1"
# Test 56: how long after the pause timeout stop.json and a clean night may take.
PAUSE_END_S = 60
# Tests 53 and 56: how much earlier than its timer a stop may come (the night starts before `--no-wait` returns).
EARLY_S = 5
SCENARIO = "scenarios/datenorm"
DATENORM_SMOKE = "configs/datenorm-smoke.yaml"


def scenario_copy(ctx: Ctx, name: str, edit: Callable[[str], str]) -> str:
    """A copy of datenorm under `scenarios/verifier-<name>/`, its `scenario.yaml` text passed through `edit`.
    Lives in the clean copy only. Returns its path relative to the app."""
    rel = f"scenarios/verifier-{name}"
    dst = ctx.app / rel
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(ctx.app / SCENARIO, dst)
    text = (dst / "scenario.yaml").read_text()
    edited = edit(text)
    if edited == text:
        raise Broken(f"{rel}: the edit changed nothing in scenario.yaml")
    (dst / "scenario.yaml").write_text(edited.replace("name: datenorm", f"name: verifier-{name}", 1))
    return rel


def restart_services(ctx: Ctx) -> None:
    ctx.adapter.stop_services(ctx.services)
    ctx.services = ctx.adapter.start_services(ctx.app)
    up, detail = ctx.adapter.wait_until_up(ctx.services, ctx.adapter.SERVICES_UP_S)
    if not up:
        raise Broken(f"the services did not come back: {detail}\n{ctx.adapter.service_logs(ctx.services)[-1500:]}")


def with_hooks(hooks: dict[str, str]):
    """Run a test with `hooks` appended to the app's `.env` (the CLI, the worker and the Agent Server read it at
    start) and the services started again; afterwards `.env` is put back as it was and the services restarted."""

    def wrap(fn):
        def run(ctx: Ctx) -> tuple[bool, str]:
            env = ctx.app / ".env"
            before = env.read_text() if env.exists() else None
            lines = "".join(f"{k}={v}\n" for k, v in hooks.items())
            try:
                env.write_text((before or "") + ("" if not before or before.endswith("\n") else "\n") + lines)
                restart_services(ctx)
                return fn(ctx)
            finally:
                if before is None:
                    env.unlink(missing_ok=True)
                else:
                    env.write_text(before)
                try:
                    restart_services(ctx)
                except Broken:
                    ctx.ensure_services()

        run.__name__ = fn.__name__
        return run

    return wrap


def r1_row(nt: Night, _: Path | None = None) -> bool:
    return bool(experiment_rows(nt.rows(), f"{nt.night_id}-r1-e0"))


def stop_reason(nt: Night) -> str | None:
    p = nt.night_dir / "stop.json"
    try:
        return json.loads(p.read_text()).get("reason") if p.exists() else None
    except ValueError:
        return None  # being written


def stopped_clean(nt: Night) -> bool:
    """stop.json, and no `cc-<id>` container left, running or stopped."""
    return stop_reason(nt) is not None and not leftover_containers(nt.night_id)


# --- tier 3a ----------------------------------------------------------------------------------------------------


@guarded_test
def continue_after_stop(ctx: Ctx) -> tuple[bool, str]:
    """50: stop a night once round 1 has its row, then `continue --rounds 1`: the continued run ends `done`, with no
    `stop.json`, a new experiment row, one test row, every `eval_id` once and no sandbox left."""
    tries: list[str] = []
    for _ in range(TRIES):
        nt, events = start(ctx, "cas")
        nid = nt.night_id
        try:
            if not wait_until(lambda: r1_row(nt) or nt.done() is not None, NIGHT_S):
                raise Broken(f"{nid}: no round 1 row within {NIGHT_S}s")
            code, out = run_group([*RUN_NIGHT, "stop", "--night", nid], ctx.app, 120)
            if nt.done() is not None:
                tries.append(f"{nid}: ended before the stop")
                continue
            if not wait_until(lambda: stopped_clean(nt), FOLLOW_S, poll_s=1):
                raise Broken(f"{nid}: stop exited {code}; no stop.json and a clean night within {FOLLOW_S}s\n{out[-400:]}")
            exps0 = [r.get("exp_id") for r in nt.rows() if r.get("kind") == "experiment"]
            code2, out2 = run_group([*RUN_NIGHT, "continue", "--config", nt.config, "--night", nid, "--rounds", "1"],
                                    ctx.app, MOCK_NIGHT_S)
            rows = nt.rows()
            exps1 = [r.get("exp_id") for r in rows if r.get("kind") == "experiment"]
            new = [e for e in exps1 if e not in exps0]
            tests = sum(r.get("kind") == "test" for r in rows)
            ids, twice = eval_ids(rows)
            done = nt.done() is not None
            stop_json = (nt.night_dir / "stop.json").exists()
            left = leftover_containers(nid)
        finally:
            kill_group(events, wait_s=2)
            tidy(ctx, nt)
        ok = code2 == 0 and printed("done", out2) and done and not stop_json and bool(new) and tests == 1 and not twice and not left
        return ok, (
            f"{'; '.join(tries)}{'; ' if tries else ''}{nid}: stopped after round 1's row; experiment rows before the "
            f"continue {exps0}; continue exited {code2}, printed done {printed('done', out2)}; done.json {done}; stop.json "
            f"{stop_json}; new experiment rows {new}; test rows {tests}; eval_ids {len(ids)}, twice {twice}; left {left}"
            f"\n{out2[-400:]}"
        )
    return False, "; ".join(tries)


@guarded_test
def outside_cancel(ctx: Ctx) -> tuple[bool, str]:
    """51: once round 1's coder sandbox exists, cancel every active run through the platform's own API: within 60 s
    `stop.json` with a reason other than `manual` and no `cc-<id>` container; no `done.json`, no test row."""
    tries: list[str] = []
    for _ in range(TRIES):
        nt, events = start(ctx, "oc")
        nid = nt.night_id
        try:
            reach = lambda: any(coder_sandbox(nid, n, 1) for n in created(events.log, 0, f"cc-{nid}"))
            if not wait_until(lambda: reach() or nt.done() is not None, REACH_S):
                raise Broken(f"{nid}: no round 1 coder sandbox within {REACH_S}s")
            if nt.done() is not None:
                tries.append(f"{nid}: ended before the cancel")
                continue
            cancelled = ctx.adapter.cancel_runs(ctx.services)
            if not cancelled:
                raise Broken(f"{nid}: the platform listed no active run to cancel")
            if nt.done() is not None:
                tries.append(f"{nid}: ended before the cancel landed")
                continue
            within = wait_until(lambda: stopped_clean(nt), FOLLOW_S, poll_s=1)
            reason = stop_reason(nt)
            no_done = nt.done() is None
            no_test = not any(r.get("kind") == "test" for r in nt.rows())
            left = leftover_containers(nid)
        finally:
            kill_group(events, wait_s=2)
            tidy(ctx, nt)
        ok = within and reason not in (None, "manual") and no_done and no_test
        return ok, (
            f"{'; '.join(tries)}{'; ' if tries else ''}{nid}: cancelled {cancelled[:6]}; within {FOLLOW_S}s stop.json and "
            f"no cc-{nid} {within}; reason {reason!r}; no done.json {no_done}; no test row {no_test}; left {left}"
        )
    return False, "; ".join(tries)


def remove_r1_evals(ctx: Ctx, nt: Night, log: Path) -> tuple[list[str], dict, bool]:
    """Remove every round-1 evaluation sandbox as it appears, for REMOVE_S."""
    nid = nt.night_id
    removed: list[str] = []
    end = time.monotonic() + REMOVE_S
    while time.monotonic() < end and nt.done() is None and stop_reason(nt) is None:
        _, out = run_group(["docker", "ps", "-a", "--format", "{{.Names}}", "--filter", f"name=cc-{nid}-r1-"], ctx.app, 60)
        for name in out.split():
            if round_eval_sandbox(nid, 1, name) and remove(name):
                removed.append(name)
        time.sleep(0.5)
    return removed or ["nothing removed"], {"removed": removed}, bool(removed)


@guarded_test
def eval_keeps_failing(ctx: Ctx) -> tuple[bool, str]:
    """54: for 120 s remove every round-1 evaluation sandbox as it appears: the night ends `done` with no `stop.json`,
    one `r1-e0` experiment row and at most one `r1-e1`."""
    f = faulted_night(ctx, "ekf", r1_eval_created, remove_r1_evals, finish_s=NIGHT_S)
    nt = f.night
    nid = nt.night_id
    e0 = experiment_rows(nt.rows(), f"{nid}-r1-e0")
    e1 = experiment_rows(nt.rows(), f"{nid}-r1-e1")
    stop_json = (nt.night_dir / "stop.json").exists()
    ok = f.finished and len(e0) == 1 and len(e1) <= 1 and not stop_json
    return ok, (
        f"{prefix(f)}removed {len(f.snap.get('removed', []))} over {REMOVE_S}s; done.json within {NIGHT_S}s after "
        f"{f.finished}; r1-e0 rows {[r.get('decision') for r in e0]}; r1-e1 rows {[r.get('decision') for r in e1]}; "
        f"stop.json {stop_json}"
    )


@guarded_test
def slow_stage(ctx: Ctx) -> str:
    """Tests 53 and 59: a datenorm copy whose stage sleeps 300 s before it runs, so round 1's evaluation is running
    when the stop comes."""
    return scenario_copy(ctx, "slow-stage", lambda t: t.replace("run: python3 /eval/run.py", "run: sleep 300; python3 /eval/run.py"))


def stop_mid_eval(ctx: Ctx, short: str, config: str, after_s: int, reason: str | None = None) -> tuple[bool, str]:
    """Start a night on a slow-stage config whose stop is due `after_s` after the start: `stop.json` (with `reason`,
    when given) no earlier than that, after round 1's evaluation sandbox was created; within BACKSTOP_END_S of the
    start `stop.json` and no `cc-<id>` container; no `done.json`, no test row."""
    nt, events = start(ctx, short, config)
    t0 = time.monotonic()
    try:
        stopped = wait_until(lambda: stop_reason(nt) is not None or nt.done() is not None, BACKSTOP_END_S, poll_s=0.5)
        stop_s = time.monotonic() - t0
        evals = [n for n in created(events.log, 0, f"cc-{nt.night_id}") if round_eval_sandbox(nt.night_id, 1, n)]
        within = stopped and wait_until(lambda: stopped_clean(nt), max(BACKSTOP_END_S - stop_s, 0), poll_s=1)
        got = stop_reason(nt)
        done = nt.done() is not None
        tests = not no_test_row(nt)
        left = leftover_containers(nt.night_id)
    finally:
        kill_group(events, wait_s=2)
        tidy(ctx, nt)
    not_early = stop_s >= after_s - EARLY_S
    reason_ok = reason is None or got == reason
    ok = within and not_early and bool(evals) and reason_ok and not done and not tests
    return ok, (
        f"{nt.night_id}: stop.json {round(stop_s)}s after the start (due {after_s}s, not early {not_early}); "
        f"round 1 evaluation sandboxes before it {evals}; within {BACKSTOP_END_S}s stop.json and no cc-{nt.night_id} "
        f"{within}; reason {got!r}{'' if reason is None else f' (want {reason!r})'}; done.json {done}; test row {tests}; left {left}"
    )


@guarded_test
def hard_deadline_mid_step(ctx: Ctx) -> tuple[bool, str]:
    """59: a slow-stage config with `hard_deadline: 30s`: the hard deadline reaches the running evaluation, as test
    53's backstop does: `stop.json` with reason `hard_deadline` no earlier than 30 s, after round 1's evaluation
    sandbox was created; within 90 s of the start no `cc-<id>` container; no `done.json`, no test row."""
    config = ctx.config(DATENORM_SMOKE, "hard-deadline", scenario=slow_stage(ctx), hard_deadline=f"{HARD_DEADLINE_S}s")
    return stop_mid_eval(ctx, "hdl", config, HARD_DEADLINE_S, reason="hard_deadline")


def fail_at_init(ctx: Ctx) -> tuple[bool, str]:
    """52: a scenario copy whose `bundle` command exits 1, so the night fails in init, before `night.json`: the
    following `run-night` prints `stopped` and exits 0 within a mock night's 300 s; `stop.json`, no `done.json`, no
    `cc-<id>` container."""
    scenario = scenario_copy(ctx, "fail-init", lambda t: t.replace("bundle: python3 scripts/export_agent.py --out {out}", "bundle: exit 1"))
    nt = ctx.run_night(ctx.config(DATENORM_SMOKE, "fail-init", scenario=scenario), "fai")
    try:
        reason = stop_reason(nt)
        done = nt.done() is not None
        left = leftover_containers(nt.night_id)
    finally:
        tidy(ctx, nt)
    ok = nt.exit_code == 0 and printed("stopped", nt.output) and reason is not None and not done and not left
    return ok, (
        f"{nt.night_id}: run-night exited {nt.exit_code}, printed stopped {printed('stopped', nt.output)}; stop.json "
        f"reason {reason!r}; done.json {done}; left {left}\n{nt.output[-500:]}"
    )


# --- tier 3b ----------------------------------------------------------------------------------------------------


def kill_after_row(ctx: Ctx, nt: Night, _: Path) -> tuple[list[str], dict, bool]:
    seen = time.monotonic()
    snap = {"r1_state": stamp(r1_state(nt)), "review": stamp(nt.night_dir / "reviews" / "r1.json")}
    killed = ctx.adapter.crash_runtime(ctx.services)
    snap["delay_ms"] = round((time.monotonic() - seen) * 1000)
    landed = nt.done() is None
    restart(ctx)
    return killed, snap, landed


@guarded_test
def kill_after_row_test(ctx: Ctx) -> tuple[bool, str]:
    """55: kill the runtime as soon as round 1's row lands, then start it again, twice over: each night meets night
    5's conditions, round 1's review is not written again, and no round-1 coder or evaluation sandbox is created
    after the kill."""
    details, ok = [], True
    for _ in range(KILLS):
        f: Faulted = faulted_night(ctx, "kar", r1_row, kill_after_row)
        nid = f.night.night_id
        ok5, d5 = night5(f, lambda n: coder_sandbox(nid, n, 1) or round_eval_sandbox(nid, 1, n))
        before = f.snap.get("review")
        review_ok = before is None or stamp(f.night.night_dir / "reviews" / "r1.json") == before
        ok = ok and ok5 and review_ok
        details.append(f"{prefix(f)}killed {f.snap.get('delay_ms')} ms after the row was seen; {d5}; reviews/r1.json "
                       f"{'absent at the kill' if before is None else 'unchanged ' + str(review_ok)}")
    return ok, " || ".join(details)


@guarded_test
def stop_then_crash(ctx: Ctx) -> tuple[bool, str]:
    """58: send a stop once round 1 has started and kill the runtime while it is in flight; after the restart, the
    stop is sent again if the first one failed or no `stop.json` exists. Within a crash's 480 s of the restart: `stop.json`, no `cc-<id>`
    container, no `done.json`. New rows in the 30 s after are reported only."""
    tries: list[str] = []
    for _ in range(TRIES):
        nt, events = start(ctx, "stc")
        nid = nt.night_id
        stopper = None
        try:
            if not wait_until(lambda: r1_started(nt, events.log) or nt.done() is not None, 120):
                raise Broken(f"{nid}: round 1 did not start within 120s")
            if nt.done() is not None:
                tries.append(f"{nid}: ended before the stop")
                continue
            at_stop = len(nt.rows())
            stopper = spawn(ctx.app, f"stop-{nid}", [*RUN_NIGHT, "stop", "--night", nid], ctx.adapter.LOGS)
            time.sleep(0.5)
            had_stop = stop_reason(nt) is not None
            killed = ctx.adapter.crash_runtime(ctx.services)
            restart(ctx)
            restarted = time.monotonic()
            try:
                stopper.proc.wait(timeout=120)
            except Exception:
                pass
            # As an operator would: again when the first stop failed (the LangChain reference's CLI writes stop.json,
            # then crashes starting its cleanup on the downed server) or left no stop.json.
            first = stopper.proc.poll()
            again = None
            if nt.done() is None and (stop_reason(nt) is None or first != 0):
                again, _ = run_group([*RUN_NIGHT, "stop", "--night", nid], ctx.app, 120)
            if nt.done() is not None and stop_reason(nt) is None:
                tries.append(f"{nid}: ended done before the stop reached it")
                continue
            # Work the kill interrupted resumes within a crash's bound, the stop's cleanup with it.
            within = wait_until(lambda: stopped_clean(nt), RESUME_S, poll_s=1)
            settled_s = round(time.monotonic() - restarted)
            rows0 = len(nt.rows())
            time.sleep(QUIET_S)
            rows1 = len(nt.rows())
            late = [f"{r.get('kind')} {r.get('exp_id')} {r.get('decision')}" for r in nt.rows()[at_stop:]]
            no_done = nt.done() is None
            left = leftover_containers(nid)
        finally:
            if stopper is not None:
                kill_group(stopper, wait_s=2)
            kill_group(events, wait_s=2)
            tidy(ctx, nt)
        # Rows written after the stop are reported, not graded: the LangChain reference writes one when the resumed
        # night races the stop's cleanup (measured 2026-11-16); test 20 grades rows after a stop without a crash.
        ok = within and no_done and not left
        return ok, (
            f"{'; '.join(tries)}{'; ' if tries else ''}{nid}: killed {killed} with the stop in flight (stop.json before "
            f"the kill {had_stop}); first stop exit {first}; stop sent again after the restart {again is not None} (exit {again}); within "
            f"{RESUME_S}s of the restart stop.json and no cc-{nid} {within} ({settled_s}s), reason {stop_reason(nt)!r}; no done.json {no_done}; rows "
            f"{rows0} -> {rows1} over {QUIET_S}s (not graded; rows after the stop: {late}); left {left}\n{tail(stopper.log)[-300:] if stopper else ''}"
        )
    return False, "; ".join(tries)


# --- tier 4: test hooks in .env ---------------------------------------------------------------------------------


def no_test_row(nt: Night) -> bool:
    return not any(r.get("kind") == "test" for r in nt.rows())


@guarded_test
@with_hooks({"CODECLIMB_BACKSTOP_S": str(BACKSTOP_S)})
def backstop_mid_step(ctx: Ctx) -> tuple[bool, str]:
    """53: `CODECLIMB_BACKSTOP_S=30` and a scenario copy whose stage sleeps 300 s before it runs: the backstop
    reaches the running evaluation. `stop.json` no earlier than the backstop, after round 1's evaluation sandbox
    was created; within 90 s of the start `stop.json` and no `cc-<id>` container; no `done.json`, no test row."""
    return stop_mid_eval(ctx, "bms", ctx.config(DATENORM_SMOKE, "slow-stage", scenario=slow_stage(ctx)), BACKSTOP_S)


def paused_clean(nt: Night) -> bool:
    return (nt.night_dir / "pause.json").exists() and not leftover_containers(nt.night_id)


def credit_night(ctx: Ctx, short: str) -> tuple[Night, float]:
    """A night whose coder's first call fails with a credit error: started, then followed to its pause.json and
    no `cc-<id>` container (a pause runs nothing). Returns the night and when its pause.json was first seen."""
    nt, code, out = ctx.start_night(DATENORM_SMOKE, short)
    if code != 0:
        raise Broken(f"{nt.night_id}: run-night --no-wait exited {code}\n{out[-500:]}")
    if not wait_until(lambda: (nt.night_dir / "pause.json").exists() or nt.done() is not None, REACH_S, poll_s=0.5):
        raise Broken(f"{nt.night_id}: no pause.json within {REACH_S}s of the start")
    if not (nt.night_dir / "pause.json").exists():
        raise Broken(f"{nt.night_id}: ended without pausing (done.json {nt.done() is not None}); is CODECLIMB_MOCK_CREDIT read?")
    paused_at = time.monotonic()
    if not wait_until(lambda: paused_clean(nt), FOLLOW_S, poll_s=1):
        raise Broken(f"{nt.night_id}: paused, but cc-{nt.night_id} containers within {FOLLOW_S}s: {leftover_containers(nt.night_id)}")
    return nt, paused_at


@guarded_test
@with_hooks({"CODECLIMB_MOCK_CREDIT": MOCK_CREDIT, "CODECLIMB_PAUSE_TIMEOUT_S": str(PAUSE_TIMEOUT_S)})
def pause_timeout(ctx: Ctx) -> tuple[bool, str]:
    """56: the credit hook and `CODECLIMB_PAUSE_TIMEOUT_S=60`, no resume: the night pauses with no sandbox, then
    the timeout stops it: `stop.json` no earlier than the timeout after the pause, and within 60 s of the timeout
    `stop.json` and no `cc-<id>` container; no `done.json`."""
    nt = None
    try:
        nt, paused_at = credit_night(ctx, "pto")
        stopped = wait_until(lambda: stop_reason(nt) is not None or nt.done() is not None, PAUSE_TIMEOUT_S + PAUSE_END_S, poll_s=0.5)
        stop_s = time.monotonic() - paused_at
        within = stopped and wait_until(lambda: stopped_clean(nt), max(PAUSE_TIMEOUT_S + PAUSE_END_S - stop_s, 0), poll_s=1)
        reason = stop_reason(nt)
        done = nt.done() is not None
    finally:
        tidy(ctx, nt)
    not_early = stop_s >= PAUSE_TIMEOUT_S - EARLY_S
    ok = within and not_early and not done
    return ok, (
        f"{nt.night_id}: paused with no sandbox; stop.json {round(stop_s)}s after pause.json (timeout {PAUSE_TIMEOUT_S}s, "
        f"not early {not_early}); within {PAUSE_TIMEOUT_S}+{PAUSE_END_S}s stop.json and no cc-{nt.night_id} {within}; "
        f"reason {reason!r}; done.json {done}"
    )


@guarded_test
@with_hooks({"CODECLIMB_MOCK_CREDIT": MOCK_CREDIT})
def pause_resume(ctx: Ctx) -> tuple[bool, str]:
    """57: the credit hook: the night pauses with no sandbox; `run-night resume`: the night ends `done` within a
    mock night's 300 s, `pause.json` gone, one line in `pauses.jsonl`, every `eval_id` once, no `stop.json`."""
    nt = None
    try:
        nt, _ = credit_night(ctx, "prs")
        code, out = run_group([*RUN_NIGHT, "resume", "--night", nt.night_id, "--no-wait"] if ctx.stack == "langchain"
                              else [*RUN_NIGHT, "resume", "--night", nt.night_id], ctx.app, 120)
        finished = wait_until(lambda: nt.done() is not None, NIGHT_S, poll_s=1)
        log = nt.night_dir / "pauses.jsonl"
        pauses = [l for l in log.read_text().splitlines() if l.strip()] if log.exists() else []
        paused = (nt.night_dir / "pause.json").exists()
        stop_json = stop_reason(nt) is not None
        ids, twice = eval_ids(nt.rows())
    finally:
        tidy(ctx, nt)
    ok = code == 0 and finished and not paused and len(pauses) == 1 and bool(ids) and not twice and not stop_json
    return ok, (
        f"{nt.night_id}: paused with no sandbox; resume exited {code}; done.json within {NIGHT_S}s {finished}; "
        f"pause.json {paused}; pauses.jsonl lines {len(pauses)}; eval_ids {len(ids)}, twice {twice}; stop.json "
        f"{stop_json}\n{out[-300:]}"
    )


TESTS: list[Test] = [
    Test("continue-after-stop", "hidden-3a", continue_after_stop),
    Test("outside-cancel", "hidden-3a", outside_cancel),
    Test("fail-at-init", "hidden-3a", fail_at_init),
    Test("eval-keeps-failing", "hidden-3a", eval_keeps_failing),
    Test("hard-deadline-mid-step", "hidden-3a", hard_deadline_mid_step),
    Test("kill-after-row", "hidden-3b", kill_after_row_test),
    Test("stop-then-crash", "hidden-3b", stop_then_crash),
    Test("backstop-mid-step", "hidden-4", backstop_mid_step),
    Test("pause-timeout", "hidden-4", pause_timeout),
    Test("pause-resume", "hidden-4", pause_resume),
]
