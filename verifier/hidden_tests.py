"""Hidden tiers 1 and 2: tests 1 to 19 of docs/codeclimb-eval-spec.md, "Hidden and real checks".

Tier 1 reads the files the seven nights of the 34 wrote (`ctx.basic`) and runs quick commands; tier 2 runs short mock
nights of its own. Expected values come from the build specs and the given configs only. Ids follow what both build
specs' id tables state; a stack-only detail is not asserted.
"""

import hashlib
import json
import re
import subprocess
import time
from pathlib import Path

from adapters import kill_group, run_group
from families import MOCK_NIGHT_S, Ctx, Skip, Test, created
from nights import RUN_NIGHT, Night, printed, session_messages, wait_until

DATENORM = "configs/datenorm-smoke.yaml"
CAPITALS = "configs/capitals-smoke.yaml"
PLATEAU = "configs/e2e/plateau.yaml"
BUDGET = "configs/e2e/budget.yaml"
# The model the capitals starter program calls (scenarios/capitals/starter/capitals/__main__.py).
CAPITALS_PROGRAM_MODEL = "github-copilot/claude-haiku-4.5"
# Both build specs' "Night config" defaults.
GIB2 = 2 * 1024**3
EPS = 1e-6


# --- small helpers ----------------------------------------------------------------------------------------------


def git(repo: Path, *args: str) -> tuple[int, str]:
    return run_group(["git", "-C", str(repo), *args], repo if repo.exists() else Path("/"), 60)


def rev(repo: Path, ref: str) -> str | None:
    code, out = git(repo, "rev-parse", "--verify", "-q", f"{ref}^{{commit}}")
    return out.strip() if code == 0 and out.strip() else None


def parents(repo: Path, ref: str) -> list[str] | None:
    """The parents of a commit, or None when it does not exist."""
    code, out = git(repo, "rev-list", "--parents", "-n", "1", ref)
    if code != 0 or not out.split():
        return None
    return out.split()[1:]


def exp_refs(repo: Path, night_id: str) -> dict[str, str]:
    """`refs/exp/<night>-r<N>-e<n>` -> sha: the experiment commits of one night (not its round-0 commit)."""
    # for-each-ref patterns match whole path components, so list refs/exp/ and filter.
    code, out = git(repo, "for-each-ref", "--format=%(refname) %(objectname)", "refs/exp/")
    pat = re.compile(rf"refs/exp/{re.escape(night_id)}-r[1-9]\d*-e\d+")
    refs = {}
    for line in out.splitlines() if code == 0 else []:
        name, _, sha = line.partition(" ")
        if pat.fullmatch(name):
            refs[name] = sha
    return refs


def starter_sha(nt: Night) -> tuple[str | None, str]:
    """The starter: the only parent of round 1's commit (both specs: one commit on the commit the sandbox started
    from); for a night whose round 1 committed nothing, `refs/exp/<id>-r0-starter`."""
    repo = nt.dir / "experiments.git"
    p = parents(repo, f"refs/exp/{nt.night_id}-r1-e0")
    if p is not None and len(p) == 1:
        return p[0], "r1-e0's parent"
    return rev(repo, f"refs/exp/{nt.night_id}-r0-starter"), "refs/exp/<id>-r0-starter"


def file_state(path: Path) -> tuple[str, int] | None:
    return (hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns) if path.exists() else None


def num(x: object) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def scalar(text: str) -> object:
    text = text.split("#", 1)[0].strip().strip("'\"")
    try:
        return float(text)
    except ValueError:
        return text


def yaml_map(text: str, key: str) -> dict[str, object]:
    """A top-level one-level mapping of a config's YAML text, block or flow style; {} when missing. Stdlib only:
    the verifier image has no YAML library."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        m = re.match(rf"{re.escape(key)}:\s*(.*)$", line)
        if not m:
            continue
        rest = m.group(1).split("#", 1)[0].strip()
        if rest.startswith("{"):
            body = rest.strip("{}")
            return {k.strip(): scalar(v) for k, _, v in (p.partition(":") for p in body.split(",") if ":" in p)}
        out = {}
        for child in lines[i + 1:]:
            if child.strip() and not child.startswith((" ", "\t")):
                break
            cm = re.match(r"\s+([^:#\s]+):\s*(.*)$", child)
            if cm:
                out[cm.group(1)] = scalar(cm.group(2))
        return out
    return {}


def scoring_config(nt: Night, app: Path) -> tuple[dict, dict, str]:
    """(thresholds, weights, source): from night.json's resolved config when it holds the
    thresholds, else the config file. Missing weights are 1."""
    cfg, source = None, "night.json config"
    path = nt.night_dir / "night.json"
    if path.exists():
        c = json.loads(path.read_text()).get("config")
        if isinstance(c, dict) and isinstance(c.get("thresholds"), dict) and c["thresholds"]:
            cfg = c
    if cfg is None:
        text = (app / nt.config).read_text()
        cfg = {k: yaml_map(text, k) for k in ("thresholds", "weights")}
        source = nt.config
    thresholds = {k: float(v) for k, v in (cfg.get("thresholds") or {}).items() if num(v)}
    w = cfg.get("weights") if isinstance(cfg.get("weights"), dict) else {}
    weights = {k: float(w[k]) if num(w.get(k)) else 1.0 for k in thresholds}
    return thresholds, weights, source


def weighted_score(metrics: dict, thresholds: dict, weights: dict) -> float:
    """Both specs: share = min(max(value, 0) / threshold, 1), 0 when missing; the weighted mean of the shares."""
    total = sum(weights[k] for k in thresholds)
    s = 0.0
    for k, t in thresholds.items():
        v = metrics.get(k)
        s += weights[k] * (min(max(v, 0) / t, 1) if num(v) else 0.0)
    return s / total if total else 0.0


def basic(ctx: Ctx, *ns: int) -> list[Night]:
    """The basic nights of these numbers that ran; Skip when none did (`basic` off)."""
    have = [ctx.basic[n] for n in ns if ctx.basic.get(n) is not None]
    if not have:
        raise Skip(f"no basic night of {list(ns)} ran (basic off?)")
    return have


def end_night(ctx: Ctx, nt: Night) -> None:
    """A night a test started with --no-wait never outlives the test: stop it unless it ended."""
    if nt.done() is None and not (nt.night_dir / "stop.json").exists():
        run_group([*RUN_NIGHT, "stop", "--night", nt.night_id], ctx.app, 120)


def eval_ids_once(nt: Night) -> tuple[bool, str]:
    ids = [r.get("eval_id") for r in nt.rows()]
    twice = sorted({e for e in ids if ids.count(e) > 1})
    return bool(ids) and not twice and None not in ids, f"{len(ids)} rows, eval_id twice {twice}"


def exp_row(nt: Night, exp: str) -> dict:
    return next((r for r in nt.rows() if r.get("kind") == "experiment" and r.get("exp_id") == f"{nt.night_id}-{exp}"), {})


# One finished datenorm-smoke mock night per verifier run, for tests 8, 9, 17 and 18 (18 adds a round to it last).
_BASE: dict[int, Night] = {}


def base_night(ctx: Ctx) -> Night:
    nt = _BASE.get(id(ctx))
    if nt is None or nt.done() is None:
        nt = ctx.run_night(ctx.config(DATENORM, "base"), "base")
        _BASE[id(ctx)] = nt
    if nt.done() is None:
        raise AssertionError(f"the base night {nt.night_id} did not finish: exit {nt.exit_code}\n{nt.output[-800:]}")
    return nt


# --- tier 1: the files the seven nights wrote -------------------------------------------------------------------


def id_problems(rows: list[dict], night_id: str, stack: str, rounds: int | None) -> list[str]:
    """Rows against both specs' id tables: experiment `<night>-r<N>-e<n>` with `round` N and eval `<exp>-eval`;
    noise `<exp>-noise-r<N>`; test `<night>-test-r<last round>`; `stack` and `backend`."""
    n = re.escape(night_id)
    exp_re = rf"{n}-r([1-9]\d*)-e(\d+)"
    ckpt_re = rf"(?:{n}-r[1-9]\d*-e\d+|{n}-r0-starter|{n}-r0-seed)"
    bad = []
    for r in rows:
        eid, kind, ev = r.get("exp_id"), r.get("kind"), r.get("eval_id")
        tag = f"{ev or eid}"
        if r.get("night_id") != night_id:
            bad.append(f"{tag}: night_id {r.get('night_id')!r}")
        if r.get("stack") != stack or r.get("backend") != "docker":
            bad.append(f"{tag}: stack {r.get('stack')!r}, backend {r.get('backend')!r}")
        if kind == "experiment":
            m = re.fullmatch(exp_re, str(eid))
            if not m:
                bad.append(f"{tag}: exp_id {eid!r}")
                continue
            if r.get("round") != int(m.group(1)):
                bad.append(f"{tag}: round {r.get('round')!r} for {eid}")
            if ev != f"{eid}-eval":
                bad.append(f"{eid}: eval_id {ev!r}")
            p = r.get("parent_id")
            if p is not None and not re.fullmatch(ckpt_re, str(p)):
                bad.append(f"{eid}: parent_id {p!r}")
        elif kind == "noise":
            if not re.fullmatch(rf"{ckpt_re}-noise-r[1-9]\d*", str(ev)) or not str(ev).startswith(f"{eid}-noise-r"):
                bad.append(f"noise row: exp_id {eid!r}, eval_id {ev!r}")
        elif kind == "test":
            want = f"{night_id}-test-r{rounds}" if rounds else None
            if not re.fullmatch(rf"{n}-test-r[1-9]\d*", str(ev)) or (want and ev != want):
                bad.append(f"test row: eval_id {ev!r}, want {want}")
            if not re.fullmatch(ckpt_re, str(eid)):
                bad.append(f"test row: exp_id {eid!r}")
        else:
            bad.append(f"{tag}: kind {kind!r}")
    return bad


def folder_problems(nt: Night) -> list[str]:
    n = re.escape(nt.night_id)
    bad = [f"exps/{p.name}" for p in nt.exps() if not re.fullmatch(rf"{n}-r[1-9]\d*-e[01]", p.name)]
    evals = nt.night_dir / "evals"
    ev_re = rf"{n}-r[1-9]\d*-e\d+-eval|(?:{n}-r[1-9]\d*-e\d+|{n}-r0-starter|{n}-r0-seed)-noise-r[1-9]\d*|{n}-test-r[1-9]\d*"
    for p in sorted(evals.iterdir()) if evals.exists() else []:
        if p.is_dir() and not re.fullmatch(ev_re, p.name):
            bad.append(f"evals/{p.name}")
    return bad


def row_identity(ctx: Ctx) -> tuple[bool, str]:
    out, bad, rows = [], [], 0
    for nt in basic(ctx, 1, 2, 3, 4, 5, 6, 7):
        rs = nt.rows()
        rows += len(rs)
        probs = id_problems(rs, nt.night_id, ctx.stack, (nt.done() or {}).get("rounds")) + folder_problems(nt)
        bad += [f"night {nt.n}: {p}" for p in probs]
        out.append(f"night {nt.n}: {len(rs)} rows")
    return rows > 0 and not bad, f"{'; '.join(out)}; problems {bad[:15]}"


def checkpoint_lineage(ctx: Ctx) -> tuple[bool, str]:
    checked, bad = 0, []
    for nt in basic(ctx, 1, 2, 3, 4, 5, 6, 7):
        repo = nt.dir / "experiments.git"
        for ref in exp_refs(repo, nt.night_id):
            p = parents(repo, ref) or []
            checked += 1
            if len(p) != 1:
                bad.append(f"{ref}: {len(p)} parents")
    n2 = ctx.basic.get(2)
    if n2 is None:
        return False, f"{checked} experiment commits, not one parent {bad}; night 2 did not run"
    repo = n2.dir / "experiments.git"
    r1 = rev(repo, f"refs/exp/{n2.night_id}-r1-e0")
    kept = exp_row(n2, "r1-e0").get("decision") == "keep"
    p2 = parents(repo, f"refs/exp/{n2.night_id}-r2-e0")
    ok2 = kept and r1 is not None and p2 == [r1]
    ok = checked > 0 and not bad and ok2
    return ok, f"{checked} experiment commits, not one parent {bad}; night 2 r1-e0 kept {kept}, sha {r1}; r2-e0 parents {p2}"


def score_mismatches(rows: list[dict], thresholds: dict, weights: dict) -> tuple[int, list[str]]:
    """(scored experiment rows, those whose score is not the weighted score of their metrics)."""
    n, bad = 0, []
    for r in rows:
        if r.get("kind") != "experiment" or r.get("decision") not in ("keep", "revert"):
            continue
        n += 1
        want = weighted_score(r.get("metrics") or {}, thresholds, weights)
        if not num(r.get("score")) or abs(r["score"] - want) > EPS:
            bad.append(f"{r.get('exp_id')}: score {r.get('score')!r}, want {want:.6f}")
    return n, bad


def weighted_score_test(ctx: Ctx) -> tuple[bool, str]:
    scored, bad, out = 0, [], []
    for nt in basic(ctx, 1, 2, 3, 4, 5, 6, 7):
        thresholds, weights, source = scoring_config(nt, ctx.app)
        if not thresholds:
            bad.append(f"night {nt.n}: no thresholds in {source}")
            continue
        n, mism = score_mismatches(nt.rows(), thresholds, weights)
        scored += n
        bad += [f"night {nt.n}: {m}" for m in mism]
        out.append(f"night {nt.n}: {n} scored ({source}: thresholds {thresholds}, weights {weights})")
    return scored > 0 and not bad, f"{'; '.join(out)}; problems {bad[:10]}"


def starter_deterministic(ctx: Ctx) -> tuple[bool, str]:
    nts = basic(ctx, 2, 4, 5, 6)
    shas = {}
    for nt in nts:
        sha, how = starter_sha(nt)
        shas[f"night {nt.n}"] = f"{sha} ({how})"
    values = {v.split(" ")[0] for v in shas.values()}
    missing = [n for n in (2, 4, 5, 6) if ctx.basic.get(n) is None]
    ok = len(nts) >= 2 and len(values) == 1 and "None" not in values and not missing
    return ok, f"{shas}; nights that did not run {missing}"


def rounds_without_keep(rows: list[dict]) -> list[int]:
    exp = [r for r in rows if r.get("kind") == "experiment" and num(r.get("round"))]
    rounds = sorted({r["round"] for r in exp})
    return [k for k in rounds if not any(r["round"] == k and r.get("decision") == "keep" for r in exp)]


def rejected_diff(ctx: Ctx) -> tuple[bool, str]:
    need, bad = 0, []
    for nt in basic(ctx, 1, 2, 3, 4, 5, 6, 7):
        for k in rounds_without_keep(nt.rows()):
            need += 1
            if not (nt.night_dir / "bundle" / "history" / f"r{k}.diff").exists():
                bad.append(f"night {nt.n}: no history/r{k}.diff")
    return need > 0 and not bad, f"{need} rounds kept nothing; missing {bad}"


DONE_FIELDS = ("night_id", "stop_reason", "rounds", "kept", "test_metrics", "spend_usd", "finished_at")


def done_problems(nt: Night, done: dict, rows: list[dict], ref_sha: str | None, starter: str | None) -> list[str]:
    bad = [f"no {f}" for f in DONE_FIELDS if f not in done]
    kept = done.get("kept") if isinstance(done.get("kept"), dict) else {}
    bad += [f"no kept.{f}" for f in ("exp_id", "commit", "dev_score") if f not in kept]
    if done.get("night_id") != nt.night_id:
        bad.append(f"night_id {done.get('night_id')!r}")
    if kept.get("commit") is None or kept.get("commit") != ref_sha:
        bad.append(f"kept.commit {kept.get('commit')!r} != refs/exp/{kept.get('exp_id')} {ref_sha!r}")
    tests = [r for r in rows if r.get("kind") == "test"]
    if len(tests) != 1:
        bad.append(f"{len(tests)} test rows")
    elif tests[0].get("metrics") != done.get("test_metrics"):
        bad.append("test_metrics differ from the test row's metrics")
    nothing_kept = not any(r.get("kind") == "experiment" and r.get("decision") == "keep" for r in rows)
    if nothing_kept and tests and (starter is None or tests[0].get("commit") != starter):
        bad.append(f"nothing kept: test commit {tests[0].get('commit')!r}, starter {starter!r}")
    return bad


def done_json_contract(ctx: Ctx) -> tuple[bool, str]:
    checked, bad = [], []
    for nt in basic(ctx, 1, 2, 3, 5, 6, 7):
        done = nt.done()
        if done is None:
            bad.append(f"night {nt.n}: no done.json")
            continue
        kept = done.get("kept") if isinstance(done.get("kept"), dict) else {}
        ref = rev(nt.dir / "experiments.git", f"refs/exp/{kept.get('exp_id')}") if kept.get("exp_id") else None
        starter, _ = starter_sha(nt)
        bad += [f"night {nt.n}: {p}" for p in done_problems(nt, done, nt.rows(), ref, starter)]
        checked.append(f"night {nt.n} kept {kept.get('exp_id')}")
    return bool(checked) and not bad, f"{'; '.join(checked)}; problems {bad[:10]}"


def size_ok(info: dict) -> tuple[bool, str]:
    """2 vCPU (NanoCpus, or quota / period) and 2 GiB, from one `docker inspect` entry."""
    hc = info.get("HostConfig") or {}
    nano, quota, period, mem = hc.get("NanoCpus") or 0, hc.get("CpuQuota") or 0, hc.get("CpuPeriod") or 0, hc.get("Memory") or 0
    cpus = nano / 1e9 if nano else (quota / period if quota and period else 0)
    return abs(cpus - 2) < 1e-9 and mem == GIB2, f"{cpus:g} vCPU, {mem / 1024**3:g} GiB"


def sandbox_size(ctx: Ctx) -> tuple[bool, str]:
    config = ctx.config(DATENORM, "sandbox-size", max_rounds="1")
    events = ctx.events("sandbox-size")
    seen: dict[str, str] = {}
    bad: list[str] = []
    nt, code, out = ctx.start_night(config, "size")
    try:
        if code != 0:
            return False, f"run-night --no-wait exited {code}\n{out[-800:]}"
        prefix = f"cc-{nt.night_id}"
        deadline = time.monotonic() + MOCK_NIGHT_S
        while time.monotonic() < deadline:
            ids = subprocess.run(["docker", "ps", "-aq", "--filter", f"name={prefix}"], capture_output=True, text=True, timeout=30).stdout.split()
            if ids:
                r = subprocess.run(["docker", "inspect", *ids], capture_output=True, text=True, timeout=30)
                for info in json.loads(r.stdout or "[]"):
                    name = info.get("Name", "").lstrip("/")
                    if name.startswith(prefix) and name not in seen:
                        ok, what = size_ok(info)
                        seen[name] = what
                        if not ok:
                            bad.append(f"{name}: {what}")
            if nt.done() is not None or (nt.night_dir / "stop.json").exists():
                break
            time.sleep(0.1)
        done = nt.done() is not None
    finally:
        end_night(ctx, nt)
        kill_group(events, wait_s=2)
    made = created(events.log, 0, f"cc-{nt.night_id}")
    coder = f"cc-{nt.night_id}-r1-e0"
    others = [n for n in seen if n != coder]
    ok = done and coder in seen and bool(others) and not bad
    return ok, f"done {done}; created {len(made)}, inspected {len(seen)}: {seen}; coder seen {coder in seen}; wrong size {bad}"


def validator_fixtures(ctx: Ctx) -> tuple[bool, str]:
    nt = base_night(ctx)
    src = nt.dir / "results.jsonl"
    lines = [l for l in src.read_text().splitlines() if l.strip()]
    i = next(k for k, l in enumerate(lines) if json.loads(l).get("kind") == "experiment")
    row = json.loads(lines[i])
    fixtures = {
        "bad-decision": json.dumps({**row, "decision": "maybe"}),
        "bad-kind": json.dumps({**row, "kind": "bogus"}),
        "metrics-not-object": json.dumps({**row, "metrics": [0.5]}),
        "not-json": '{"night_id": "' + nt.night_id + '", not json',
    }
    d = ctx.app / "configs" / "verifier" / "fixtures"
    d.mkdir(parents=True, exist_ok=True)

    def validate(path: Path) -> tuple[int, str]:
        return run_group(["npm", "run", "validate-results", "--", str(path)], ctx.app, 300)

    own, own_out = validate(src)
    out = [f"own file exit {own}"]
    bad = [] if own == 0 else [f"own file rejected: {own_out[-300:]}"]
    for name, line in fixtures.items():
        path = d / f"{name}.jsonl"
        path.write_text("\n".join(lines[:i] + [line] + lines[i + 1:]) + "\n")
        code, text = validate(path)
        out.append(f"{name} exit {code}")
        if code == 0:
            bad.append(f"{name} accepted: {text[-200:]}")
    return not bad, f"{'; '.join(out)}; problems {bad}"


def stop_after_done(ctx: Ctx) -> tuple[bool, str]:
    nt = base_night(ctx)
    before = file_state(nt.night_dir / "done.json")
    code, out = run_group([*RUN_NIGHT, "stop", "--night", nt.night_id], ctx.app, 120)
    time.sleep(10)
    stop = (nt.night_dir / "stop.json").exists()
    after = file_state(nt.night_dir / "done.json")
    ok = code == 0 and not stop and before is not None and before == after
    return ok, f"{nt.night_id}: stop exited {code}, printed done {printed('done', out)}; stop.json {stop}; done.json unchanged {before == after}\n{out[-400:]}"


def night_folders(ctx: Ctx, night_id: str) -> list[str]:
    runs = ctx.app / ctx.runs
    hits = list(runs.glob(f"**/nights/{night_id}")) if runs.exists() else []
    hits += list(ctx.app.glob(f"*/nights/{night_id}")) + list(ctx.app.glob(f"*/*/nights/{night_id}"))
    return sorted({str(h.relative_to(ctx.app)) for h in hits})


def config_rejects(ctx: Ctx) -> tuple[bool, str]:
    # Both specs refuse these at load. The positive partner: an unchanged copy starts and makes its night folder.
    bad_configs = {
        "same-reviewer": ctx.config(DATENORM, "reject-reviewer", reviewer_model="github-copilot/claude-haiku-5.5",
                                    coder_thinking="medium", reviewer_thinking="medium"),
        "deadline-soon": ctx.config(DATENORM, "reject-deadline", deadline="soon"),
        "results-dotdot": ctx.config(DATENORM, "reject-dotdot", results_path="../verifier-reject-dotdot/results.jsonl"),
    }
    out, bad = [], []
    for what, config in bad_configs.items():
        nid = ctx.night_id("rej")
        code, text = run_group([*RUN_NIGHT, "--config", config, "--mock", "--no-wait", "--night-id", nid], ctx.app, 120)
        time.sleep(2)
        folders = night_folders(ctx, nid)
        out.append(f"{what}: exit {code}, night folders {folders}")
        if code == 0 or folders:
            bad.append(f"{what}: exit {code}, folders {folders}: {text[-200:]}")
    good, code, text = ctx.start_night(ctx.config(DATENORM, "reject-control"), "ctl")
    try:
        started = code == 0 and wait_until(lambda: good.night_dir.exists(), 60)
        wait_until(lambda: good.done() is not None, MOCK_NIGHT_S, poll_s=1)
    finally:
        end_night(ctx, good)
    out.append(f"unchanged copy: exit {code}, night folder {started}")
    return started and not bad, "; ".join(out)


# --- tier 2: short mock nights ----------------------------------------------------------------------------------


def missing_gate(ctx: Ctx) -> tuple[bool, str]:
    nt = ctx.run_night(ctx.config(DATENORM, "missing-gate", **{"gates.no_such_metric": "1"}), "gate")
    rows = nt.rows()
    r1 = exp_row(nt, "r1-e0").get("decision")
    noise = sum(r.get("kind") == "noise" for r in rows)
    test = [r.get("commit") for r in rows if r.get("kind") == "test"]
    starter, how = starter_sha(nt)
    ok = nt.done() is not None and r1 == "revert" and noise == 0 and len(test) == 1 and test[0] == starter
    return ok, f"done {nt.done() is not None}; r1-e0 decision {r1!r}; noise rows {noise}; test commits {test}; starter {starter} ({how})"


def stop_thresholds(ctx: Ctx) -> tuple[bool, str]:
    # Both specs' C11: the starter's code scores accuracy 0.125 on dev, so a 0.1 target is met in round 1.
    nt = ctx.run_night(ctx.config(DATENORM, "stop-thresholds", thresholds="{accuracy: 0.1}"), "thr")
    done = nt.done() or {}
    rows = nt.rows()
    exps = [r.get("exp_id") for r in rows if r.get("kind") == "experiment"]
    tests = sum(r.get("kind") == "test" for r in rows)
    ok = done.get("stop_reason") == "thresholds" and len(exps) == 1 and tests == 1
    return ok, f"stop_reason {done.get('stop_reason')!r}, rounds {done.get('rounds')!r}; experiment rows {exps}; test rows {tests}"


def rounds_override_order(ctx: Ctx) -> tuple[bool, str]:
    nt = ctx.run_night(ctx.config(PLATEAU, "rounds-override"), "ro", ["--rounds", "1"])
    done = nt.done() or {}
    ok = done.get("stop_reason") == "max_rounds" and done.get("rounds") == 1
    return ok, f"exit {nt.exit_code}; stop_reason {done.get('stop_reason')!r}, rounds {done.get('rounds')!r}"


def plateau_never(ctx: Ctx) -> tuple[bool, str]:
    nt = ctx.run_night(ctx.config(BUDGET, "plateau-never"), "pn")
    done = nt.done() or {}
    rounds = sorted({r.get("round") for r in nt.rows() if r.get("kind") == "experiment"})
    ok = done.get("stop_reason") == "max_rounds" and done.get("rounds") == 6 and rounds == [1, 2, 3, 4, 5, 6]
    return ok, f"exit {nt.exit_code}; stop_reason {done.get('stop_reason')!r}, rounds {done.get('rounds')!r}; experiment rounds {rounds}"


def assistant_errors(nt: Night, exp: str) -> tuple[int, int]:
    """(assistant messages, those with stop reason error) in an experiment's session."""
    msgs = [m for m in session_messages(nt.night_dir / "exps" / f"{nt.night_id}-{exp}") if m.get("role") == "assistant"]
    return len(msgs), sum(m.get("stopReason") == "error" for m in msgs)


def mock_offline_count(ctx: Ctx) -> tuple[bool, str]:
    nt = ctx.run_night(ctx.config(DATENORM, "mock-offline"), "off", ["--mock-offline", "3"])
    a1, e1 = assistant_errors(nt, "r1-e0")
    a2, e2 = assistant_errors(nt, "r2-e0")
    ok = nt.done() is not None and e1 == 3 and a2 > 0 and e2 == 0
    return ok, f"done {nt.done() is not None}; r1-e0: {a1} assistant messages, {e1} errors; r2-e0: {a2}, {e2} errors"


def meter_lines(nt: Night) -> list[dict]:
    lines = []
    for f in sorted((nt.night_dir / "evals").glob("*/meter.jsonl")):
        lines += [json.loads(x) for x in f.read_text().splitlines() if x.strip()]
    return lines


def proxy_refuses_model(ctx: Ctx) -> tuple[bool, str]:
    other = "github-copilot/claude-haiku-5.5"
    assert other != CAPITALS_PROGRAM_MODEL
    nt = ctx.run_night(ctx.config(CAPITALS, "proxy-refuses", allowed_models=f"[{other}]"), "prx")
    lines = meter_lines(nt)
    accepted = [x.get("model") for x in lines if x.get("ok") is not False or not x.get("error")]
    kept = [r.get("exp_id") for r in nt.rows() if r.get("kind") == "experiment" and r.get("decision") == "keep"]
    said = printed("done", nt.output)
    ok = nt.done() is not None and said and bool(lines) and not accepted and not kept
    return ok, f"done.json {nt.done() is not None}, printed done {said}; meter lines {len(lines)}, not refused {accepted[:5]}; kept {kept}"


def used_night_id(ctx: Ctx) -> tuple[bool, str]:
    out = []
    # A finished night's id.
    base = base_night(ctx)
    rows_before = [r.get("eval_id") for r in base.rows()]
    done_before = file_state(base.night_dir / "done.json")
    events = ctx.events("used-night-id")
    try:
        code, _ = run_group([*RUN_NIGHT, "--config", base.config, "--mock", "--no-wait", "--night-id", base.night_id], ctx.app, 120)
        time.sleep(10)
        same_rows = [r.get("eval_id") for r in base.rows()] == rows_before
        same_done = file_state(base.night_dir / "done.json") == done_before
        again = [n for n in created(events.log, 0, f"cc-{base.night_id}") if n == f"cc-{base.night_id}-r1-e0"]
        fin_ok = same_rows and same_done and not again
        out.append(f"finished {base.night_id}: exit {code}; rows unchanged {same_rows}; done.json unchanged {same_done}; r1-e0 creates {len(again)}")
        # A running night's id.
        nt, code, text = ctx.start_night(ctx.config(DATENORM, "used-id"), "used")
        try:
            if code != 0:
                return False, f"{'; '.join(out)}; run-night --no-wait exited {code}\n{text[-500:]}"
            reached = wait_until(lambda: (nt.night_dir / "exps" / f"{nt.night_id}-r1-e0").exists(), 120)
            code2, _ = run_group([*RUN_NIGHT, "--config", nt.config, "--mock", "--no-wait", "--night-id", nt.night_id], ctx.app, 120)
            finished = wait_until(lambda: nt.done() is not None, MOCK_NIGHT_S, poll_s=1)
        finally:
            end_night(ctx, nt)
        once, detail = eval_ids_once(nt)
        r1 = [n for n in created(events.log, 0, f"cc-{nt.night_id}") if n == f"cc-{nt.night_id}-r1-e0"]
        run_ok = reached and finished and once and len(r1) == 1
        out.append(f"running {nt.night_id}: round 1 reached {reached}; second start exit {code2}; done {finished}; {detail}; r1-e0 creates {len(r1)}")
    finally:
        kill_group(events, wait_s=2)
    return fin_ok and run_ok, "; ".join(out)


def continue_test(ctx: Ctx) -> tuple[bool, str]:
    # Both CLI tables take `--config` on continue; continue takes no --mock (Inngest) and keeps a mock a mock.
    nt = base_night(ctx)
    code, text = run_group([*RUN_NIGHT, "continue", "--config", nt.config, "--night", nt.night_id, "--rounds", "1"], ctx.app, MOCK_NIGHT_S)

    def landed() -> bool:
        rows = nt.rows()
        return bool(exp_row(nt, "r3-e0")) and sum(r.get("kind") == "test" for r in rows) >= 2

    # A continue that exited non-zero started nothing to wait for.
    got = wait_until(landed, 120 if code == 0 else 5, poll_s=1)
    # Not asserted: let the continued run end before the next test starts a night.
    ended = wait_until(lambda: (nt.done() or {}).get("rounds") == 3, 60 if got else 0, poll_s=1)
    rows = nt.rows()
    tests = [r.get("eval_id") for r in rows if r.get("kind") == "test"]
    once, detail = eval_ids_once(nt)
    r3 = bool(exp_row(nt, "r3-e0"))
    ok = got and r3 and len(tests) == 2 and once
    return ok, f"continue exited {code}; r3-e0 row {r3}; test rows {tests}; {detail}; done.json rounds 3 {ended}\n{text[-400:]}"


def seed(ctx: Ctx) -> tuple[bool, str]:
    src = ctx.basic.get(2)
    if src is None or src.done() is None:
        src = base_night(ctx)
    kept = (src.done() or {}).get("kept") or {}
    nt = ctx.run_night(src.config, "seed", ["--seed", src.night_id, "--rounds", "1"])
    r1 = exp_row(nt, "r1-e0")
    want_parent = f"{nt.night_id}-r0-seed"
    commit = r1.get("commit")
    p = parents(nt.dir / "experiments.git", commit) if commit else None
    ok = nt.done() is not None and r1.get("parent_id") == want_parent and p == [kept.get("commit")] and kept.get("commit") is not None
    return ok, (f"seed {src.night_id} (kept {kept.get('exp_id')} {kept.get('commit')}); {nt.night_id}: exit {nt.exit_code}, "
                f"done {nt.done() is not None}; r1-e0 parent_id {r1.get('parent_id')!r}, want {want_parent}; commit {commit} parents {p}")


TESTS: list[Test] = [
    Test("row-identity", "hidden-1", row_identity),
    Test("checkpoint-lineage", "hidden-1", checkpoint_lineage),
    Test("weighted-score", "hidden-1", weighted_score_test),
    Test("starter-deterministic", "hidden-1", starter_deterministic),
    Test("rejected-diff", "hidden-1", rejected_diff),
    Test("done-json-contract", "hidden-1", done_json_contract),
    Test("sandbox-size", "hidden-1", sandbox_size),
    Test("validator-fixtures", "hidden-1", validator_fixtures),
    Test("stop-after-done", "hidden-1", stop_after_done),
    Test("config-rejects", "hidden-1", config_rejects),
    Test("missing-gate", "hidden-2", missing_gate),
    Test("stop-thresholds", "hidden-2", stop_thresholds),
    Test("rounds-override-order", "hidden-2", rounds_override_order),
    Test("plateau-never", "hidden-2", plateau_never),
    Test("mock-offline-count", "hidden-2", mock_offline_count),
    Test("proxy-refuses-model", "hidden-2", proxy_refuses_model),
    Test("used-night-id", "hidden-2", used_night_id),
    Test("continue", "hidden-2", continue_test),
    Test("seed", "hidden-2", seed),
]
