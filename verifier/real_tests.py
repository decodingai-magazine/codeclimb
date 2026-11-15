"""The real family: seven small real-model nights, R1 to R7, and tests 32 to 49 over them
(docs/codeclimb-eval-spec.md, "Hidden and real checks", `real.*`).

Each night runs once per verifier run, when the first test that needs it runs, and is cached here; a night that
failed to run fails every test that needs it, with the reason. A test that reads several nights reads those that
ran and skips when none did. TESTS is ordered so the nights run R2, R3, R4, R5, R6, R7, R1.

The nights use the operator's Copilot login through Pi. Each night's config caps its spend (`budget_usd.night`);
a night that outlives its time limit is stopped with `run-night stop`, so it spends no more.
"""

import hashlib
import json
import re
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from adapters import kill_group, run_group
from families import Ctx, Skip, Test
from nights import RUN_NIGHT, Night, session_messages, text_of, wait_until

# The proxy's own variables: a metered sandbox reaches models through them (both build specs, Metering proxy).
PROXY_ENV = {"OPENAI_API_KEY", "CODECLIMB_LLM_API_KEY", "OPENAI_BASE_URL", "CODECLIMB_LLM_BASE_URL"}
SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET", re.I)
# A held-out string is evidence only when it is distinctive: at least MIN_HELD_OUT long and with MIN_DIGITS digits
# ("02. Dez. 2021"), or at least LONG_HELD_OUT long. Shorter ones are common knowledge a coder writes by itself:
# ISO dates, capitals, "next Saturday".
MIN_HELD_OUT = 12
MIN_DIGITS = 4
LONG_HELD_OUT = 24
# The sandbox roots the coder probe hashes.
ROOTS = ("/repo", "/spec", "/tmp", "/eval")
EMPTY_SHA = hashlib.sha256(b"").hexdigest()
# Seconds between polls of a running night; a coder is probed first after this many seconds, then every
# CODER_EVERY_S, at most CODER_PROBES times.
POLL_S = 1.0
CODER_FIRST_S = 20
CODER_EVERY_S = 60
CODER_PROBES = 3
# R6's token cap when R2 did not run to measure one round's tokens.
TOKENS_FALLBACK = 400_000
EPS = 1e-9

DATENORM = "configs/datenorm-smoke.yaml"
CAPITALS = "configs/capitals-smoke.yaml"


@dataclass
class NightSpec:
    base: str
    fields: dict[str, str] | None  # None: the given config as it is
    timeout_s: float
    probe: bool = False
    prep: list[str] | None = None


# The spec's table. Sizes only; R1 and R4 as given. No night lowers `budget_usd.night` (0.5 in both configs): below
# `budget_usd.experiment` (0.2 datenorm, 0.25 capitals), a build that reserves a whole experiment for the next round
# stops on `budget` before the night shows what it tests.
NIGHTS: dict[str, NightSpec] = {
    "R1": NightSpec("configs/e2e/overfit.yaml", None, 80 * 60, probe=True, prep=["npm", "run", "build:scenario:overfit"]),
    "R2": NightSpec(DATENORM, {"timeouts.experiment_min": "4", "timeouts.eval_min": "2"},
                    30 * 60, probe=True),
    "R3": NightSpec(CAPITALS, {"timeouts.experiment_min": "4"}, 30 * 60, probe=True),
    "R4": NightSpec("configs/e2e/budget.yaml", None, 40 * 60),
    "R5": NightSpec(DATENORM, {"deadline": "3m", "max_rounds": "5", "plateau_rounds": "0", "timeouts.experiment_min": "2"},
                   20 * 60),
    # max_tokens is set at run time: one round's tokens, measured on R2.
    "R6": NightSpec(DATENORM, {"max_rounds": "5", "plateau_rounds": "0", "timeouts.experiment_min": "4"},
                   40 * 60),
    "R7": NightSpec(DATENORM, {}, 10 * 60),
}
# R7: the stop comes this many seconds into the coder; the test then watches this long.
R7_INTO_CODER_S = 60
R7_WATCH_S = 60


# --- small readers ------------------------------------------------------------------------------------------------


def ws(text: str) -> str:
    return " ".join(str(text).split())


def read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(errors="replace").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def num(x: object) -> float:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else 0.0


def scalar(text: str) -> object:
    text = text.strip().strip("'\"")
    for cast in (int, float):
        try:
            return cast(text)
        except ValueError:
            pass
    return {"true": True, "false": False, "null": None}.get(text, text)


def flow(text: str) -> object:
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        pairs = [p.split(":", 1) for p in text[1:-1].split(",") if ":" in p]
        return {k.strip().strip("'\""): scalar(v) for k, v in pairs}
    if text.startswith("[") and text.endswith("]"):
        return [scalar(x) for x in text[1:-1].split(",") if x.strip()]
    return scalar(text)


def parse_config(text: str) -> dict:
    """The given configs' YAML: top-level scalars and flow values, and one level of `key: value` children."""
    out: dict = {}
    parent = None
    for raw in text.splitlines():
        line = re.sub(r"\s+#.*$", "", raw).rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^(\s*)([A-Za-z_][\w.-]*):\s*(.*)$", line)
        if not m:
            continue
        indent, key, value = m.groups()
        if not indent:
            parent = key if not value else None
            out[key] = {} if not value else flow(value)
        elif parent is not None and isinstance(out.get(parent), dict):
            out[parent][key] = flow(value)
    return out


def night_config(nt: Night, app: Path) -> dict:
    """The night's resolved config from night.json (a mapping holding `thresholds`), else the config file."""
    nj = read_json(nt.night_dir / "night.json") or {}
    for v in [nj, *nj.values()]:
        if isinstance(v, dict) and isinstance(v.get("thresholds"), dict):
            return v
    return parse_config((app / nt.config).read_text())


def weighted(metrics: dict, thresholds: dict, weights: dict | None) -> float:
    """Both build specs: share = min(max(value, 0) / threshold, 1), 0 when missing; weighted mean of the shares."""
    weights = weights or {}
    total = sum(num(weights.get(k, 1)) for k in thresholds) or 1.0
    s = 0.0
    for k, t in thresholds.items():
        v = metrics.get(k)
        share = min(max(num(v), 0.0) / num(t), 1.0) if isinstance(v, (int, float)) and num(t) > 0 else 0.0
        s += num(weights.get(k, 1)) * share
    return s / total


def failed_gates(metrics: dict, gates: dict | None) -> list[str]:
    """A gate fails when its metric is missing or above its cap."""
    return [g for g, cap in (gates or {}).items() if not isinstance(metrics.get(g), (int, float)) or metrics[g] > num(cap)]


def exp_rows(nt: Night) -> list[dict]:
    def key(r: dict) -> tuple[int, int]:
        m = re.search(r"-r(\d+)-e(\d+)$", r.get("exp_id") or "")
        return (int(m.group(1)), int(m.group(2))) if m else (num(r.get("round")), 0)

    return sorted((r for r in nt.rows() if r.get("kind") == "experiment"), key=key)


def first_user_text(exp: Path) -> str:
    users = [m for m in session_messages(exp) if m.get("role") == "user"] if exp.exists() else []
    return text_of(users[0]) if users else ""


def leaves(obj: object):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from leaves(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from leaves(v)


def session_text(night_dir: Path) -> str:
    """Every string in the coders' Pi session files, decoded from JSON."""
    parts = []
    for f in sorted(night_dir.glob("exps/*/session/*.jsonl")):
        for entry in jsonl(f):
            parts.extend(leaves(entry))
    return "\n".join(parts)


def tree_text(root: Path) -> str:
    parts = []
    for f in sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []:
        try:
            parts.append(f.read_text(errors="replace"))
        except OSError:
            pass
    return "\n".join(parts)


def git(repo: Path, *args: str) -> tuple[int, str]:
    return run_group(["git", "-C", str(repo), *args], repo.parent, 60)


def sha_files(root: Path) -> dict[str, str]:
    """sha256 -> path of every non-empty file under root, __pycache__ left out."""
    out = {}
    for f in sorted(root.rglob("*")) if root.exists() else []:
        if f.is_file() and "__pycache__" not in f.parts:
            h = hashlib.sha256(f.read_bytes()).hexdigest()
            if h != EMPTY_SHA:
                out[h] = str(f.relative_to(root.parent))
    return out


def gold_hashes(scenario: Path) -> dict[str, str]:
    """The hashes of the scenario's gold/ and evaluators/ files, less any the coder is given (starter/, spec/)."""
    given = set(sha_files(scenario / "starter")) | set(sha_files(scenario / "spec"))
    out = {**sha_files(scenario / "gold"), **sha_files(scenario / "evaluators")}
    return {h: p for h, p in out.items() if h not in given}


def held_out_strings(scenario: Path, splits: tuple[str, ...]) -> list[str]:
    """Distinctive strings of the scenario's items in `splits`: each string field of an item that is distinctive (see
    MIN_HELD_OUT), not part of any train item and not in the scenario's spec or starter (all of which the coder is given)."""
    items = {i.get("id"): i for i in jsonl(scenario / "gold" / "items.jsonl")}
    split = read_json(scenario / "gold" / "splits.json") or {}
    train = [str(v) for i in split.get("train", []) for k, v in (items.get(i) or {}).items() if k != "id" and isinstance(v, str)]
    given = tree_text(scenario / "spec") + tree_text(scenario / "starter")
    out = set()
    for s in splits:
        for i in split.get(s, []):
            for k, v in (items.get(i) or {}).items():
                if k == "id" or not isinstance(v, str):
                    continue
                v = v.strip()
                if len(v) < MIN_HELD_OUT or (len(v) < LONG_HELD_OUT and sum(c.isdigit() for c in v) < MIN_DIGITS):
                    continue
                if not any(v in t for t in train) and v not in given:
                    out.add(v)
    return sorted(out)


def scenario_dir(nt: Night, app: Path) -> Path:
    """The night's scenario, from its config file (relative to the app, as both build specs say)."""
    return app / str(parse_config((app / nt.config).read_text()).get("scenario"))


def meter_lines(night_dir: Path) -> int:
    return sum(len(jsonl(f)) for f in night_dir.rglob("meter*.jsonl")) if night_dir.exists() else 0


def session_bytes(night_dir: Path) -> int:
    return sum(f.stat().st_size for f in night_dir.glob("exps/*/session/*.jsonl"))


def containers(night_id: str, all_: bool = False) -> list[tuple[str, str]]:
    """(short id, name) of the night's cc- containers."""
    cmd = ["docker", "ps", *(["-a"] if all_ else []), "--format", "{{.ID}} {{.Names}}", "--filter", f"name=cc-{night_id}"]
    code, out = run_group(cmd, Path("/"), 30)
    pairs = [tuple(line.split(" ", 1)) for line in out.splitlines() if " " in line] if code == 0 else []
    return [(i, n) for i, n in pairs if n.startswith(f"cc-{night_id}")]


# --- probes of a running night (44, 45, 40) ------------------------------------------------------------------------

# Run inside a sandbox with python3: prints the NAMES of the environment variables of every process, never a value.
ENV_NAMES = (
    "import glob,os\n"
    "n=set(os.environ)\n"
    "for p in glob.glob('/proc/[0-9]*/environ'):\n"
    "  try: n.update(x.split(b'=',1)[0].decode('utf-8','replace') for x in open(p,'rb').read().split(b'\\0') if x)\n"
    "  except Exception: pass\n"
    "print('\\n'.join(sorted(n)))\n"
)
# Run inside a sandbox: the files under /spec/history as JSON {path: text}.
SPEC_HISTORY = (
    "import json,pathlib\n"
    "r=pathlib.Path('/spec/history')\n"
    "print(json.dumps({str(p.relative_to(r)):p.read_text(errors='replace')[:20000] for p in r.rglob('*') if p.is_file()} if r.exists() else None))\n"
)


def exec_(name: str, cmd: list[str], timeout_s: float = 120) -> tuple[int, str]:
    return run_group(["docker", "exec", name, *cmd], Path("/"), timeout_s)


def image_env_names(name: str, cache: dict[str, set[str]]) -> set[str]:
    """The names the sandbox's image itself sets (the given Dockerfile and its base): not the build's doing."""
    code, image = run_group(["docker", "inspect", "-f", "{{.Config.Image}}", name], Path("/"), 30)
    image = image.strip()
    if code != 0 or not image:
        return set()
    if image not in cache:
        code, out = run_group(["docker", "image", "inspect", "-f", "{{json .Config.Env}}", image], Path("/"), 30)
        try:
            cache[image] = {e.split("=", 1)[0] for e in json.loads(out) or []} if code == 0 else set()
        except ValueError:
            cache[image] = set()
    return cache[image]


def flagged_names(names: set[str], allowed: set[str]) -> list[str]:
    return sorted(n for n in names if SECRET_NAME.search(n) and n not in PROXY_ENV and n not in allowed)


def parse_hashes(out: str) -> list[tuple[str, str]]:
    pairs = []
    for line in out.splitlines():
        m = re.match(r"^([0-9a-f]{64})\s+\*?(.+)$", line)
        if m:
            pairs.append((m.group(1), m.group(2)))
    return pairs


@dataclass
class Probes:
    night_id: str
    night_dir: Path
    gold: dict[str, str]
    coders: dict[str, dict] = field(default_factory=dict)
    evals: dict[str, dict] = field(default_factory=dict)
    images: dict[str, set[str]] = field(default_factory=dict)
    # Test 40: the host's bundle just before cc-<id>-r2-e0 was first seen, and that sandbox's own /spec/history.
    snapshot: dict | None = None
    before_r2: dict | None = None
    r2_spec: dict | None = None

    def coder_name(self, name: str) -> bool:
        return re.fullmatch(rf"cc-{re.escape(self.night_id)}-r\d+-e\d+", name) is not None

    def take_snapshot(self) -> dict:
        b = self.night_dir / "bundle" / "history"
        note = b / "notes" / "r1-e0.md"
        rows = jsonl(self.night_dir.parents[1] / "results.jsonl")
        r1 = next((r for r in rows if r.get("exp_id") == f"{self.night_id}-r1-e0" and r.get("kind") == "experiment"), {})
        return {"note": note.read_text(errors="replace") if note.exists() else None, "diff": (b / "r1.diff").exists(),
                "r1_decision": r1.get("decision"), "at": time.time()}

    def tick(self) -> None:
        previous, self.snapshot = self.snapshot, self.take_snapshot()
        now = time.monotonic()
        for cid, name in containers(self.night_id):
            if self.coder_name(name):
                c = self.coders.setdefault(name, {"id": cid, "first": now, "probes": []})
                if name.endswith("-r2-e0") and self.before_r2 is None:
                    self.before_r2 = previous or {"note": None, "diff": False, "r1_decision": None, "unseen": True}
                last = c["probes"][-1]["at"] if c["probes"] else None
                due = now - c["first"] >= CODER_FIRST_S and (last is None or now - last >= CODER_EVERY_S)
                if due and len(c["probes"]) < CODER_PROBES:
                    c["probes"].append(self.probe_coder(name))
                    if name.endswith("-r2-e0") and self.r2_spec is None:
                        code, out = exec_(name, ["python3", "-c", SPEC_HISTORY], 60)
                        try:
                            self.r2_spec = {"files": json.loads(out.strip().splitlines()[-1])} if code == 0 else None
                        except (ValueError, IndexError):
                            self.r2_spec = None
            else:
                e = self.evals.setdefault(name, {"id": cid, "found": None, "tries": 0})
                if e["found"] is None and e["tries"] < 5:
                    e["tries"] += 1
                    code, out = exec_(name, ["sh", "-c", 'for f in /tmp/notes.md /tmp/tasks.json; do [ -e "$f" ] && echo "$f"; done; echo probe-ok'], 30)
                    if code == 0 and "probe-ok" in out:
                        e["found"] = [x for x in out.split() if x.startswith("/tmp/")]

    def probe_coder(self, name: str) -> dict:
        exp = self.night_dir / "exps" / name[len("cc-"):]
        session = any((exp / "session").glob("*.jsonl")) if (exp / "session").exists() else False
        code, out = exec_(name, ["find", *ROOTS, "-xdev", "-type", "f", "-size", "-20M", "-exec", "sha256sum", "{}", "+"], 180)
        pairs = parse_hashes(out)
        hits = sorted({f"{path} = {self.gold[h]}" for h, path in pairs if h in self.gold})
        by_root = {r: sum(p.startswith(r + "/") for _, p in pairs) for r in ROOTS}
        ecode, names_out = exec_(name, ["python3", "-c", ENV_NAMES], 60)
        names = set(names_out.split()) if ecode == 0 else set()
        flagged = flagged_names(names, image_env_names(name, self.images))
        return {"at": time.monotonic(), "session": session, "files": by_root, "hits": hits, "env_names": len(names),
                "env_read": ecode == 0, "flagged": flagged}


# --- running a night --------------------------------------------------------------------------------------------


@dataclass
class Real:
    key: str
    night: Night | None = None
    error: str = ""
    minutes: float = 0.0
    probes: Probes | None = None
    created: list[str] = field(default_factory=list)  # container names created during the night, in order
    r7: dict = field(default_factory=dict)
    note: str = ""

    def summary(self) -> str:
        if self.night is None:
            return f"{self.key}: did not run"
        done = self.night.done() or {}
        return f"{self.key} {self.night.night_id}: {self.minutes:.1f} min, spend_usd {done.get('spend_usd')!r}{'; ' + self.note if self.note else ''}"


_CACHE: dict[tuple[str, str], Real] = {}


def real_night(ctx: Ctx, key: str) -> Real:
    """Run night `key` once per verifier run; later calls get the same result."""
    k = (ctx.tag, key)
    if k not in _CACHE:
        started = time.monotonic()
        real = Real(key)
        try:
            run_real(ctx, key, real)
        except Exception:
            real.error = real.error or traceback.format_exc()[-1500:]
        real.minutes = (time.monotonic() - started) / 60
        _CACHE[k] = real
    return _CACHE[k]


def ran(ctx: Ctx, key: str) -> Real | None:
    return _CACHE.get((ctx.tag, key))


def tokens_of_one_round(ctx: Ctx) -> tuple[int, str]:
    r2 = ran(ctx, "R2")
    if r2 and r2.night:
        t = sum(int(num(r.get("tokens"))) for r in exp_rows(r2.night) if r.get("round") == 1)
        if t > 0:
            return t, f"max_tokens {t}: R2's round 1"
    return TOKENS_FALLBACK, f"max_tokens {TOKENS_FALLBACK}: fallback, R2 did not measure a round"


def services_answer(ctx: Ctx) -> tuple[bool, str]:
    """The services answer within their start limit, or are started again from scratch."""
    up, detail = ctx.adapter.wait_until_up(ctx.services, ctx.adapter.SERVICES_UP_S)
    return (up, detail) if up else ctx.ensure_services()


def run_real(ctx: Ctx, key: str, real: Real) -> None:
    spec = NIGHTS[key]
    app = ctx.app
    if spec.prep:
        code, out = run_group(spec.prep, app, 600)
        if code != 0:
            real.error = f"{' '.join(spec.prep)} exited {code}\n{out[-1500:]}"
            return
    if spec.fields is None:
        config = spec.base
    else:
        fields = dict(spec.fields)
        if key == "R6":
            t, real.note = tokens_of_one_round(ctx)
            fields["max_tokens"] = str(t)
        config = ctx.config(spec.base, f"real-{key.lower()}", **fields)
    events = ctx.events(f"real-{key}-{ctx.tag}")
    night = None
    try:
        # The services can blink after a durability test restarted them (a LangChain trial build, 2026-11-15: R2
        # to R6 found no Agent Server for about 10 s after `server-rerun-mid-night`). A night that could not start
        # spent nothing, so it starts again once, under a new id, after the services answer.
        for attempt in (1, 2):
            up, detail = services_answer(ctx)
            if not up:
                real.error = f"services not up before {key}: {detail}"
                return
            night, code, out = ctx.start_night(config, key.lower(), mock=False)
            if code == 0 or attempt == 2 or night.night_dir.exists():
                break
            real.note += f"{night.night_id} did not start (exit {code}): started again. "
        real.night = night
        if code != 0:
            real.error = f"run-night --no-wait exited {code}\n{out[-1500:]}"
            return
        nd = night.night_dir
        if spec.probe:
            real.probes = Probes(night.night_id, nd, gold_hashes(scenario_dir(night, app)))
        if key == "R7":
            drive_r7(ctx, night, real)
            if real.error:
                return
        deadline = time.monotonic() + spec.timeout_s
        ended = lambda: (nd / "done.json").exists() or (nd / "stop.json").exists()  # noqa: E731
        while not ended() and time.monotonic() < deadline:
            if real.probes:
                real.probes.tick()
            time.sleep(POLL_S if real.probes else 5)
        if not ended():
            real.error = f"neither done.json nor stop.json within {spec.timeout_s / 60:.0f} min"
    finally:
        if night is not None and not ((night.night_dir / "done.json").exists() or (night.night_dir / "stop.json").exists()):
            # A night past its limit must not keep spending.
            code, out = run_group([*RUN_NIGHT, "stop", "--night", night.night_id], app, 120)
            real.error += f"\nstopped by the verifier: exit {code}\n{out[-300:]}"
        kill_group(events, wait_s=2)
        if night is not None:
            for line in events.log.read_text().splitlines() if events.log.exists() else []:
                name = line.partition(" ")[2]
                if name.startswith(f"cc-{night.night_id}"):
                    real.created.append(name)


def drive_r7(ctx: Ctx, night: Night, real: Real) -> None:
    """R7: stop the night 60 s into round 1's coder, then watch for 60 s."""
    nid, nd = night.night_id, night.night_dir
    coder = f"cc-{nid}-r1-e0"
    if not wait_until(lambda: any(n == coder for _, n in containers(nid)) or (nd / "done.json").exists(), 600, poll_s=1):
        real.error = f"{coder} not created within 600 s"
        return
    time.sleep(R7_INTO_CODER_S)
    before = {"session_bytes": session_bytes(nd), "meter_lines": meter_lines(nd),
              "assistant": sum(m.get("role") == "assistant" for e in night.exps() for m in session_messages(e))}
    code, out = run_group([*RUN_NIGHT, "stop", "--night", nid], ctx.app, 120)
    at_stop = {"session_bytes": session_bytes(nd), "meter_lines": meter_lines(nd)}
    peak = dict(at_stop)
    seen: set[str] = set()
    end = time.monotonic() + R7_WATCH_S
    while time.monotonic() < end:
        peak["session_bytes"] = max(peak["session_bytes"], session_bytes(nd))
        peak["meter_lines"] = max(peak["meter_lines"], meter_lines(nd))
        seen |= {n for _, n in containers(nid, all_=True)}
        time.sleep(2)
    left = [n for _, n in containers(nid, all_=True)]
    real.r7 = {"stop_code": code, "stop_out": out[-300:], "before": before, "at_stop": at_stop, "peak": peak,
               "seen_after_stop": sorted(seen), "left_after_60s": left}


def need(ctx: Ctx, key: str) -> Real:
    """The night a test is about; a night that did not run fails the test with its reason."""
    real = real_night(ctx, key)
    if real.error or real.night is None:
        raise NightFailed(f"{key} did not run to its end: {real.error.strip()[-1200:]}" + (f"\n{real.summary()}" if real.night else ""))
    return real


class NightFailed(Exception):
    pass


def guard(fn: Callable[[Ctx], tuple[bool, str]]) -> Callable[[Ctx], tuple[bool, str]]:
    def wrapped(ctx: Ctx) -> tuple[bool, str]:
        try:
            return fn(ctx)
        except NightFailed as e:
            return False, str(e)

    return wrapped


def used(ctx: Ctx, keys: tuple[str, ...]) -> list[Real]:
    """The nights of a multi-night test that already ran; none: Skip."""
    have = [r for k in keys if (r := ran(ctx, k)) is not None]
    if not have:
        raise Skip(f"none of {', '.join(keys)} ran")
    return have


def broken(reals: list[Real]) -> list[str]:
    return [f"{r.key}: {r.error.strip()[-300:]}" for r in reals if r.error or r.night is None]


# --- the checks: pure, on a night's files -----------------------------------------------------------------------


def check_thresholds(nt: Night, max_rounds: int = 4) -> tuple[bool, str]:
    done = nt.done() or {}
    ok = done.get("stop_reason") == "thresholds" and 1 <= num(done.get("rounds")) <= max_rounds
    return ok, f"stop_reason {done.get('stop_reason')!r}, rounds {done.get('rounds')!r} (want thresholds within {max_rounds})"


def check_test_equals_dev(nt: Night, metric: str = "accuracy") -> tuple[bool, str]:
    done = nt.done() or {}
    kept_id = (done.get("kept") or {}).get("exp_id")
    kept = next((r for r in exp_rows(nt) if r.get("exp_id") == kept_id and r.get("decision") == "keep"), None)
    test = [r for r in nt.rows() if r.get("kind") == "test"]
    dev = (kept or {}).get("metrics", {}).get(metric)
    got = (test[0].get("metrics") or {}).get(metric) if len(test) == 1 else None
    ok = kept is not None and isinstance(dev, (int, float)) and isinstance(got, (int, float)) and abs(dev - got) < EPS
    return ok, f"kept {kept_id!r} (a kept row: {kept is not None}) dev {metric} {dev!r}; test rows {len(test)}, test {metric} {got!r}"


def parent_of(repo: Path, sha: str) -> list[str]:
    code, out = git(repo, "rev-list", "--parents", "-n", "1", sha)
    return out.split()[1:] if code == 0 and out.split() else []


def check_lineage(nt: Night, parents: Callable[[str], list[str]]) -> tuple[bool, str]:
    """The kept commits form one chain from the starter, each kept score above the last. A kept repair `e1` starts
    from its round's failed `e0` (both build specs, Repair), so that commit may stand between two kept ones."""
    rows = exp_rows(nt)
    r1 = next((r for r in rows if (r.get("exp_id") or "").endswith("-r1-e0")), None)
    starter_p = parents(r1["commit"]) if r1 and r1.get("commit") else []
    if len(starter_p) != 1:
        return False, f"r1-e0 commit {(r1 or {}).get('commit')!r} has parents {starter_p}: no starter found"
    prev, prev_score, out, ok = starter_p[0], 0.0, [], True
    kept = [r for r in rows if r.get("decision") == "keep"]
    if not kept:
        return False, "nothing kept"
    for r in kept:
        p = parents(r.get("commit") or "")
        link = p == [prev]
        if not link and len(p) == 1:
            failed = [x for x in rows if x.get("commit") == p[0] and x.get("round") == r.get("round") and x.get("decision") == "error"]
            link = bool(failed) and parents(p[0]) == [prev]
        rises = num(r.get("score")) > prev_score
        ok = ok and link and rises and len(p) == 1
        out.append(f"{r.get('exp_id')}: parent of the last kept {link}, score {r.get('score')!r} > {prev_score!r} {rises}")
        prev, prev_score = r.get("commit"), num(r.get("score"))
    return ok, "; ".join(out)


def check_stop_reason(nt: Night, want: str) -> tuple[bool, str]:
    done = nt.done() or {}
    return done.get("stop_reason") == want, f"stop_reason {done.get('stop_reason')!r}, want {want!r}; rounds {done.get('rounds')!r}"


def check_between_rounds(nt: Night, want: str) -> tuple[bool, str]:
    """A soft stop is checked between rounds (both build specs, Stops): the last round finished (its rows and its
    review exist), no later round started, the night ended with done.json, and the checkpoint was scored on test once."""
    ok, detail = check_stop_reason(nt, want)
    last = int(num((nt.done() or {}).get("rounds")))
    rounds = {r.get("round") for r in exp_rows(nt)}
    row = last in rounds
    later = sorted(n for n in rounds if isinstance(n, int) and n > last)
    review = (nt.night_dir / "reviews" / f"r{last}.json").exists()
    stopped = (nt.night_dir / "stop.json").exists()
    tests = sum(r.get("kind") == "test" for r in nt.rows())
    good = ok and last >= 1 and row and review and not later and not stopped and tests == 1
    return good, (f"{detail}; round {last} row {row}, review {review}; later rounds {later}; stop.json {stopped}; "
                  f"test rows {tests}; spend_usd {(nt.done() or {}).get('spend_usd')!r}")


def check_stop_halts(nt: Night, r7: dict) -> tuple[bool, str]:
    if not r7:
        return False, "the stop was not sent"
    stop = read_json(nt.night_dir / "stop.json") or {}
    tests = sum(r.get("kind") == "test" for r in nt.rows())
    before, at, peak = r7["before"], r7["at_stop"], r7["peak"]
    worked = before["session_bytes"] > 0 and before["assistant"] > 0  # the positive: the coder had been working
    no_growth = peak["session_bytes"] == at["session_bytes"]
    no_meter = peak["meter_lines"] == at["meter_lines"]
    ok = (r7["stop_code"] == 0 and worked and no_growth and no_meter and not r7["left_after_60s"]
          and stop.get("reason") == "manual" and tests == 0 and nt.done() is None)
    return ok, (
        f"stop exited {r7['stop_code']}; coder working before the stop {worked} ({before['assistant']} assistant messages); "
        f"in the {R7_WATCH_S} s after it: session bytes {at['session_bytes']} -> {peak['session_bytes']}, meter lines "
        f"{at['meter_lines']} -> {peak['meter_lines']}, cc- containers left {r7['left_after_60s']}; stop.json reason "
        f"{stop.get('reason')!r}; test rows {tests}; done.json {nt.done() is not None}"
    )


def review(nt: Night, n: int) -> dict:
    return read_json(nt.night_dir / "reviews" / f"r{n}.json") or {}


def check_hypothesis_handoff(nt: Night, message: Callable[[str], str]) -> tuple[bool, str]:
    hyp = review(nt, 1).get("hypothesis")
    if not isinstance(hyp, str) or not hyp.strip():
        return False, f"reviews/r1.json hypothesis {hyp!r}"
    h = ws(hyp)
    exp = f"{nt.night_id}-r2-e0"
    row = next((r for r in exp_rows(nt) if r.get("exp_id") == exp), None)
    if row is None:
        return False, f"no {exp} row"
    in_row = ws(row.get("hypothesis") or "") == h
    in_msg = h in ws(message(row.get("commit") or ""))
    in_prompt = h in ws(first_user_text(nt.night_dir / "exps" / exp))
    return in_row and in_msg and in_prompt, f"hypothesis {h[:120]!r}: {exp} row {in_row}, commit message {in_msg}, first prompt {in_prompt}"


def check_feedback(nt: Night) -> tuple[bool, str]:
    fb = review(nt, 1).get("feedback")
    if not isinstance(fb, str) or not fb.strip():
        return False, f"reviews/r1.json feedback {fb!r}"
    exp = nt.night_dir / "exps" / f"{nt.night_id}-r2-e0"
    prompt = first_user_text(exp)
    ok = ws(fb) in ws(prompt)
    return ok, f"round 1 feedback ({len(fb)} chars) in {exp.name}'s first prompt ({len(prompt)} chars): {ok}"


def note_ok(text: str | None, verdict: str) -> tuple[bool, str]:
    """A note holds a coder part and the reviewer's verdict: the verdict, and other text before it."""
    if not text:
        return False, "no note"
    t, v = ws(text), ws(verdict)
    i = t.find(v) if v else -1
    before = len(re.sub(r"[#\s]", "", t[:i])) if i > 0 else 0
    return i >= 0 and before > 0, f"verdict in note {i >= 0}, text before it {before} chars"


def check_history(nt: Night, before: dict | None, in_sandbox: dict | None) -> tuple[bool, str]:
    if before is None:
        return False, f"cc-{nt.night_id}-r2-e0 was never seen"
    verdict = review(nt, 1).get("verdict") or ""
    if not ws(verdict):
        return False, f"reviews/r1.json verdict {verdict!r}"
    ok_note, d_note = note_ok(before.get("note"), verdict)
    need_diff = before.get("r1_decision") != "keep"
    ok_diff = before.get("diff") or not need_diff
    detail = f"before cc-{nt.night_id}-r2-e0: notes/r1-e0.md {d_note}; r1 decision {before.get('r1_decision')!r}, r1.diff {before.get('diff')}"
    ok = ok_note and ok_diff and before.get("r1_decision") is not None
    files = (in_sandbox or {}).get("files")
    if files is not None:
        s_ok, s_d = note_ok(files.get("notes/r1-e0.md"), verdict)
        s_diff = "r1.diff" in files or not need_diff
        ok = ok and s_ok and s_diff
        detail += f"; in the sandbox's /spec/history: {s_d}, r1.diff {'r1.diff' in files}"
    else:
        detail += "; the sandbox's /spec/history was not read"
    return ok, detail


def check_reviewer_model(nt: Night, want: str) -> tuple[bool, str]:
    revs = sorted((nt.night_dir / "reviews").glob("r*.json")) if (nt.night_dir / "reviews").exists() else []
    revs = [p for p in revs if re.fullmatch(r"r\d+\.json", p.name)]
    models = {p.name: (read_json(p) or {}).get("model") for p in revs}
    ok = bool(models) and all(m == want for m in models.values())
    return ok, f"want {want!r}; {models}"


def noise_band(cfg: dict, noise: dict | None) -> tuple[float, float, float]:
    """(min, max, measured): the margin an experiment must beat is the measured move (or `fixed`), made smaller by
    replayed calls, held between min and max (both build specs, Noise margin). Before the A/A run it is in [min, max];
    after it in [min, measured]."""
    nm = cfg.get("noise_margin") if isinstance(cfg.get("noise_margin"), dict) else {}
    lo, hi = num(nm.get("min", 0.002)), num(nm.get("max", 0.005))
    measured = hi
    if noise and isinstance(noise.get("margin"), (int, float)):
        measured = max(lo, min(hi, noise["margin"]))
    return lo, hi, measured


GUARD_REASON = re.compile(r"block|guard|held.?out|hidden|gate|no (code )?change|unchanged|no diff|identical", re.I)


def check_keep_consistency(nt: Night, cfg: dict) -> tuple[bool, str]:
    thresholds, weights, gates = cfg.get("thresholds") or {}, cfg.get("weights") or {}, cfg.get("gates") or {}
    noise = read_json(nt.night_dir / "noise.json")
    lo, hi, measured = noise_band(cfg, noise)
    noise_round = min((int(num(r.get("round"))) for r in nt.rows() if r.get("kind") == "noise"), default=None)
    checkpoint, out, ok, decided = 0.0, [], True, 0
    for r in exp_rows(nt):
        d, m = r.get("decision"), r.get("metrics") or {}
        if d == "error":
            out.append(f"{r.get('exp_id')}: error")
            continue
        score = weighted(m, thresholds, weights)
        top = measured if noise_round is not None and num(r.get("round")) >= noise_round else hi
        gated = failed_gates(m, gates)
        unchanged = r.get("unchanged") is True
        if d == "keep":
            good = not gated and not unchanged and score > checkpoint + lo - EPS
        elif d == "revert":
            good = bool(gated) or unchanged or bool(GUARD_REASON.search(r.get("decision_reason") or "")) or score <= checkpoint + top + EPS
        else:
            good = False
        decided += 1
        ok = ok and good
        out.append(f"{r.get('exp_id')}: {d} score {score:.4f} vs checkpoint {checkpoint:.4f} + margin [{lo}, {top}], gates failed {gated}, unchanged {unchanged}: {'ok' if good else 'INCONSISTENT'}")
        if d == "keep":
            checkpoint = score
    return ok and decided > 0, "; ".join(out) or "no experiment rows"


def find_strings(strings: list[str], haystacks: dict[str, str]) -> list[str]:
    return [f"{s[:60]!r} in {where}" for s in strings for where, text in haystacks.items() if s in text]


def check_meter_costs(nt: Night) -> tuple[bool, str]:
    lines = [x for f in sorted(nt.night_dir.glob("evals/*/meter.jsonl")) for x in jsonl(f)]
    fresh = [x for x in lines if not x.get("replayed") and not num(x.get("replayed_usd"))]
    bad = [x for x in fresh if not (num(x.get("cost_usd")) > 0 and num(x.get("input_tokens")) + num(x.get("output_tokens")) > 0)]
    errors = [x for x in lines if x.get("error")]
    scored = [r for r in nt.rows() if r.get("decision") in ("keep", "revert") and r.get("unchanged") is not True]
    no_calls = [r.get("eval_id") for r in scored if not num((r.get("metrics") or {}).get("model_calls")) > 0]
    ok = bool(fresh) and not bad and not errors and bool(scored) and not no_calls
    return ok, (f"{len(lines)} evaluation meter lines ({len(lines) - len(fresh)} replayed): {len(bad)} without cost or tokens, "
                f"{len(errors)} with error; {len(scored)} scored rows, without model_calls > 0: {no_calls}")


def check_spend(nt: Night) -> tuple[bool, str]:
    rows = nt.rows()
    spend = (nt.done() or {}).get("spend_usd")
    parts = sum(num(r.get(k)) for r in rows for k in ("coder_usd", "dev_usd", "program_usd"))
    reviewer: dict[object, float] = {}
    for r in rows:  # reviewer_usd repeats on a round's rows: once per round
        reviewer[r.get("round")] = max(reviewer.get(r.get("round"), 0.0), num(r.get("reviewer_usd")))
    total = parts + sum(reviewer.values())
    ok = isinstance(spend, (int, float)) and abs(spend - total) <= 0.01 + EPS
    return ok, f"done.json spend_usd {spend!r}; rows: coder + dev + program {parts:.4f}, reviewer once per round {sum(reviewer.values()):.4f}, total {total:.4f}"


def check_coder_clean(reals: list[Real]) -> tuple[bool, str]:
    out, ok, valid = [], True, 0
    for r in reals:
        p = r.probes
        if p is None:
            out.append(f"{r.key}: not probed")
            continue
        for name, c in sorted(p.coders.items()):
            for pr in c["probes"]:
                real_probe = pr["session"] and pr["files"]["/repo"] + pr["files"]["/spec"] > 0 and pr["env_read"]
                valid += real_probe
                clean = not pr["hits"] and not pr["flagged"]
                ok = ok and clean
                if not clean or not real_probe:
                    out.append(f"{name}: {sum(pr['files'].values())} files hashed {pr['files']}, session {pr['session']}, "
                               f"gold/evaluator copies {pr['hits']}, {pr['env_names']} env names, flagged {pr['flagged']}")
    return ok and valid > 0, f"{valid} probes during a coder's work, all clean: {ok}; " + "; ".join(out)


def check_eval_separate(reals: list[Real]) -> tuple[bool, str]:
    out, ok, probed = [], True, 0
    for r in reals:
        p = r.probes
        if p is None or r.night is None:
            out.append(f"{r.key}: not probed")
            continue
        coder_ids = {c["id"] for c in p.coders.values()}
        n_evals = len([d for d in (r.night.night_dir / "evals").glob("*") if d.is_dir()]) if (r.night.night_dir / "evals").exists() else 0
        others = sorted({n for n in r.created if not p.coder_name(n)})
        enough = len(others) >= n_evals
        ok = ok and enough
        for name, e in sorted(p.evals.items()):
            if e["found"] is None:
                continue
            probed += 1
            good = not e["found"] and e["id"] not in coder_ids
            ok = ok and good
            out.append(f"{name}: coder files {e['found']}, a coder's container {e['id'] in coder_ids}")
        out.append(f"{r.key}: {n_evals} evaluations, {len(others)} non-coder sandboxes created, {sum(e['found'] is None for e in p.evals.values())} not reached")
    return ok and probed > 0, f"{probed} evaluation sandboxes probed; " + "; ".join(out)


# --- the tests ------------------------------------------------------------------------------------------------------


def t_overfit_thresholds(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R1")
    ok, d = check_thresholds(r.night)
    return ok, f"{d}\n{r.summary()}"


def t_overfit_test_equals_dev(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R1")
    ok, d = check_test_equals_dev(r.night)
    return ok, f"{d}\n{r.summary()}"


def t_overfit_lineage(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R1")
    repo = r.night.dir / "experiments.git"
    ok, d = check_lineage(r.night, lambda sha: parent_of(repo, sha))
    return ok, f"{d}\n{r.summary()}"


def t_budget(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R4")
    ok, d = check_between_rounds(r.night, "budget")
    return ok, f"{d}\n{r.summary()}"


def t_deadline(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R5")
    ok, d = check_between_rounds(r.night, "deadline")
    return ok, f"{d}\n{r.summary()}"


def t_tokens(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R6")
    ok, d = check_stop_reason(r.night, "tokens")
    return ok, f"{d}\n{r.summary()}"


def t_stop_halts_spend(ctx: Ctx) -> tuple[bool, str]:
    r = real_night(ctx, "R7")
    if r.night is None or not r.r7:
        return False, f"R7 did not reach its stop: {r.error.strip()[-1200:]}"
    ok, d = check_stop_halts(r.night, r.r7)
    return ok, f"{d}\n{r.summary()}"


def t_hypothesis_handoff(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R2")
    repo = r.night.dir / "experiments.git"
    ok, d = check_hypothesis_handoff(r.night, lambda sha: git(repo, "log", "-1", "--format=%B", sha)[1] if sha else "")
    return ok, f"{d}\n{r.summary()}"


def t_history_in_bundle(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R2")
    p = r.probes
    ok, d = check_history(r.night, p.before_r2 if p else None, p.r2_spec if p else None)
    return ok, f"{d}\n{r.summary()}"


def t_feedback(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R2")
    ok, d = check_feedback(r.night)
    return ok, f"{d}\n{r.summary()}"


def t_reviewer_model(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R2")
    ok, d = check_reviewer_model(r.night, str(night_config(r.night, ctx.app).get("reviewer_model")))
    return ok, f"{d}\n{r.summary()}"


def t_meter_costs(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R3")
    ok, d = check_meter_costs(r.night)
    return ok, f"{d}\n{r.summary()}"


def t_spend(ctx: Ctx) -> tuple[bool, str]:
    r = need(ctx, "R3")
    ok, d = check_spend(r.night)
    return ok, f"{d}\n{r.summary()}"


def multi(ctx: Ctx, keys: tuple[str, ...], each: Callable[[Real], tuple[bool, str]]) -> tuple[bool, str]:
    reals = used(ctx, keys)
    bad = broken(reals)
    results = [each(r) for r in reals if not (r.error or r.night is None)]
    ok = not bad and bool(results) and all(o for o, _ in results)
    return ok, "\n".join([*(f"night failed: {b}" for b in bad), *(d for _, d in results), *(r.summary() for r in reals)])


def t_keep_consistency(ctx: Ctx) -> tuple[bool, str]:
    def each(r: Real) -> tuple[bool, str]:
        ok, d = check_keep_consistency(r.night, night_config(r.night, ctx.app))
        return ok, f"{r.key}: {d}"

    return multi(ctx, ("R2", "R3"), each)


def held_out_check(ctx: Ctx, splits: tuple[str, ...], haystacks: Callable[[Real], dict[str, str]]) -> tuple[bool, str]:
    def each(r: Real) -> tuple[bool, str]:
        strings = held_out_strings(scenario_dir(r.night, ctx.app), splits)
        hay = haystacks(r)
        hits = find_strings(strings, hay)
        size = sum(len(t) for t in hay.values())
        return not hits and size > 0, f"{r.key}: {len(strings)} distinctive {'/'.join(splits)} strings in {size} chars of {sorted(hay)}: found {hits[:10]}"

    ok, detail = multi(ctx, ("R2", "R3"), each)
    # A negative check counts only with its positive one: some night must have had strings to look for.
    any_strings = any(
        held_out_strings(scenario_dir(r.night, ctx.app), splits) for r in used(ctx, ("R2", "R3")) if r.night and not r.error
    )
    return ok and any_strings, detail + ("" if any_strings else "\nno distinctive held-out string to look for")


def t_no_held_out(ctx: Ctx) -> tuple[bool, str]:
    def hay(r: Real) -> dict[str, str]:
        nd = r.night.night_dir
        return {"coder sessions": session_text(nd), "bundle and notes": tree_text(nd / "bundle")}

    return held_out_check(ctx, ("dev", "test"), hay)


def t_reviewer_no_dev(ctx: Ctx) -> tuple[bool, str]:
    def hay(r: Real) -> dict[str, str]:
        revs = sorted(p for p in (r.night.night_dir / "reviews").glob("r*.json") if re.fullmatch(r"r\d+\.json", p.name))
        return {p.name: "\n".join(str((read_json(p) or {}).get(k) or "") for k in ("feedback", "hypothesis")) for p in revs}

    return held_out_check(ctx, ("dev",), hay)


def t_coder_clean(ctx: Ctx) -> tuple[bool, str]:
    reals = used(ctx, ("R1", "R2", "R3"))
    ok, d = check_coder_clean([r for r in reals if r.night])
    return ok and not broken(reals), "\n".join([d, *broken(reals), *(r.summary() for r in reals)])


def t_eval_separate(ctx: Ctx) -> tuple[bool, str]:
    reals = used(ctx, ("R1", "R2", "R3"))
    ok, d = check_eval_separate([r for r in reals if r.night])
    return ok and not broken(reals), "\n".join([d, *broken(reals), *(r.summary() for r in reals)])


def real(name: str, fn: Callable[[Ctx], tuple[bool, str]]) -> Test:
    return Test(name, "real", guard(fn))


# In this order the nights run R2, R3, R4, R5, R6, R7, R1; the tests over several nights come last.
TESTS: list[Test] = [
    real("hypothesis-handoff", t_hypothesis_handoff),
    real("history-in-bundle", t_history_in_bundle),
    real("feedback-reaches-coder", t_feedback),
    real("reviewer-model", t_reviewer_model),
    real("meter-costs", t_meter_costs),
    real("spend-adds-up", t_spend),
    real("budget", t_budget),
    real("deadline", t_deadline),
    real("tokens", t_tokens),
    real("stop-halts-spend", t_stop_halts_spend),
    real("overfit-thresholds", t_overfit_thresholds),
    real("overfit-test-equals-dev", t_overfit_test_equals_dev),
    real("overfit-lineage", t_overfit_lineage),
    real("keep-consistency", t_keep_consistency),
    real("no-held-out-to-coder", t_no_held_out),
    real("reviewer-no-dev-item", t_reviewer_no_dev),
    real("coder-sandbox-clean", t_coder_clean),
    real("eval-sandbox-separate", t_eval_separate),
]
