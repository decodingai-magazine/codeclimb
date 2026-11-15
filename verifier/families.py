"""The hidden and real families: tests beside the reward, never in it (docs/codeclimb-eval-spec.md, "Hidden and real
checks"). Each test module lists its tests in `TESTS`; this module runs them in tier order and holds the helpers
they share.

A test is `Test(name, tier, fn, stacks)`: `fn(ctx)` returns (passed, detail). It reports as `<family>.<name>`, where
the family is `hidden` for the tiers `hidden-1`, `hidden-2`, `hidden-3a`, `hidden-3b` and `real` for `real`.
`stacks` limits a test to some stacks; a test that does not run has no key. Raise `Skip` to drop a test's key.
"""

import json
import os
import re
import time
import traceback
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from adapters import Adapter, Services, run_group, spawn
from nights import RUN_NIGHT, Night, results_name, wait_until

TIERS = ("hidden-1", "hidden-2", "hidden-3a", "real", "hidden-3b")
# The real-model nights: the models they use must be in the Copilot login.
REAL_MODELS = ("claude-haiku-5.5", "claude-haiku-4.5")
# Seconds a mock night of a family may take; a real night's own limit is its test's.
MOCK_NIGHT_S = 300
PI_AUTH = Path("/root/.pi/agent/auth.json")


class Skip(Exception):
    """A test that cannot run here (a stack, a missing image, a missing credential): it reports no key."""


@dataclass
class Test:
    name: str
    tier: str
    fn: Callable[["Ctx"], tuple[bool, str]]
    stacks: frozenset[str] | None = None

    @property
    def key(self) -> str:
        return f"{'real' if self.tier == 'real' else 'hidden'}.{self.name}"


@dataclass
class Ctx:
    """What a test may use: the clean copy, the stack's adapter and services, and the nights the 34 ran."""

    app: Path
    stack: str
    adapter: Adapter
    services: Services
    tag: str
    # The seven nights of the 34, by number: 1, 2, 3, 6 and 7 as run; 4 and 5 rebuilt from their ids (None when
    # that night did not run).
    basic: dict[int, Night | None] = field(default_factory=dict)
    _seq: int = 0

    @property
    def runs(self) -> str:
        return self.adapter.RUNS

    def night_id(self, short: str) -> str:
        """A fresh night id for a test: `<tag>-<short>` with a counter, at most 48 characters."""
        self._seq += 1
        nid = f"{self.tag}-{short}{self._seq}"
        if len(nid) > 48 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*", nid):
            raise ValueError(f"bad night id {nid!r}")
        return nid

    def config(self, base: str, name: str, **fields: str) -> str:
        """Write a copy of a given config with `fields` replaced (dotted keys reach one level down; values are YAML
        text, flow style for a mapping) and its own results folder `verifier-<name>`. Returns its path relative to
        the app. The file lives in the clean copy only."""
        text = (self.app / base).read_text()
        fields.setdefault("results_path", f"verifier-{name}/results.jsonl")
        for key, value in fields.items():
            text = set_field(text, key, value)
        rel = f"configs/verifier/{name}.yaml"
        (self.app / rel).parent.mkdir(parents=True, exist_ok=True)
        (self.app / rel).write_text(text)
        return rel

    def night(self, config: str, night_id: str, mock: bool = True, code: int = -1, out: str = "", n: int = 0) -> Night:
        name = results_name(self.app, config)
        root = self.app / self.runs / ("mock" if mock else "")
        return Night(n, config, night_id, name, root / name, code, out)

    def run_night(self, config: str, short: str, extra: list[str] | None = None, mock: bool = True,
                  timeout_s: float = MOCK_NIGHT_S) -> Night:
        """Run a night to its end, following it."""
        nid = self.night_id(short)
        cmd = [*RUN_NIGHT, "--config", config, "--night-id", nid, *(["--mock"] if mock else []), *(extra or [])]
        code, out = run_group(cmd, self.app, timeout_s)
        return self.night(config, nid, mock, code, out)

    def start_night(self, config: str, short: str, extra: list[str] | None = None, mock: bool = True) -> tuple[Night, int, str]:
        """Start a night with `--no-wait`; (night, exit code, output)."""
        nid = self.night_id(short)
        cmd = [*RUN_NIGHT, "--config", config, "--night-id", nid, "--no-wait", *(["--mock"] if mock else []), *(extra or [])]
        code, out = run_group(cmd, self.app, 120)
        return self.night(config, nid, mock, code, out), code, out

    def events(self, name: str):
        """Follow container creates from now: `docker events` into a log; `created(proc, since_ns)` reads it."""
        return spawn(self.app, f"events-{name}", ["docker", "events", "--filter", "type=container", "--filter",
                     "event=create", "--format", "{{.TimeNano}} {{.Actor.Attributes.name}}"], self.adapter.LOGS)

    def ensure_services(self) -> tuple[bool, str]:
        """The services answer, or are started again from scratch."""
        up, detail = self.adapter.wait_until_up(self.services, 10)
        if up:
            return True, detail
        self.adapter.stop_services(self.services)
        self.services = self.adapter.start_services(self.app)
        return self.adapter.wait_until_up(self.services, self.adapter.SERVICES_UP_S)


def created(events_log: Path, since_ns: int = 0, prefix: str = "") -> list[str]:
    """Container names created after `since_ns` whose name starts with `prefix`, in order."""
    if not events_log.exists():
        return []
    out = []
    for line in events_log.read_text().splitlines():
        ts, _, name = line.partition(" ")
        if ts.isdigit() and int(ts) > since_ns and name.startswith(prefix):
            out.append(name)
    return out


def set_field(text: str, key: str, value: str) -> str:
    """Replace a top-level key (`a`) or a key one level down (`a.b`) in a config's YAML text, adding it when
    missing. A replaced block's indented children go with it."""
    lines = text.splitlines()
    parent, _, child = key.partition(".")
    top = next((i for i, l in enumerate(lines) if re.match(rf"{re.escape(parent)}:(\s|$)", l)), None)
    if not child:
        new = f"{parent}: {value}"
        if top is None:
            return text.rstrip("\n") + f"\n{new}\n"
        end = top + 1
        while end < len(lines) and (lines[end].startswith((" ", "\t")) or not lines[end].strip()):
            end += 1
        return "\n".join(lines[:top] + [new] + lines[end:]) + "\n"
    if top is None:
        return text.rstrip("\n") + f"\n{parent}:\n  {child}: {value}\n"
    i = top + 1
    while i < len(lines) and (lines[i].startswith((" ", "\t")) or not lines[i].strip()):
        if re.match(rf"\s+{re.escape(child)}:(\s|$)", lines[i]):
            indent = re.match(r"\s+", lines[i]).group(0)
            lines[i] = f"{indent}{child}: {value}"
            return "\n".join(lines) + "\n"
        i += 1
    lines.insert(top + 1, f"  {child}: {value}")
    return "\n".join(lines) + "\n"


def copilot_ready() -> tuple[bool, str]:
    """The real family runs only with a Copilot login holding its models. Never returns a token."""
    if not PI_AUTH.exists():
        return False, "no Pi auth.json: CODECLIMB_BENCH_PI_AUTH unset"
    try:
        entry = json.loads(PI_AUTH.read_text()).get("github-copilot") or {}
    except ValueError:
        return False, "Pi auth.json is not JSON"
    ids = set(entry.get("availableModelIds") or [])
    missing = [m for m in REAL_MODELS if ids and m not in ids]
    if not entry.get("refresh"):
        return False, "no github-copilot login in Pi auth.json"
    return not missing, f"github-copilot login; models missing: {missing}"


def selected() -> tuple[set[str], set[str] | None]:
    """(families, test names or None for all) from CODECLIMB_VERIFIER_FAMILIES and CODECLIMB_VERIFIER_ONLY."""
    fams = {f.strip() for f in (os.environ.get("CODECLIMB_VERIFIER_FAMILIES") or "basic,hidden,real").split(",") if f.strip()}
    only = {t.strip() for t in (os.environ.get("CODECLIMB_VERIFIER_ONLY") or "").split(",") if t.strip()} or None
    return fams, only


def all_tests() -> list[Test]:
    """Every module's TESTS. A module that fails to import costs only its own tests (they report no key)."""
    import importlib

    tests: list[Test] = []
    for name in ("hidden_tests", "durability_tests", "real_tests"):
        try:
            tests += importlib.import_module(name).TESTS
        except Exception:
            print(f"[verifier] {name} did not import\n{traceback.format_exc()}", flush=True)
    return tests


def run_families(ctx: Ctx, record: Callable[[str, bool | None, str, float], None], after_tier: Callable[[], None]) -> None:
    """Run the selected tests tier by tier. `record(key, passed, detail, seconds)` gets every test that ran
    (passed None: skipped, no key); `after_tier` writes the reward files."""
    fams, only = selected()
    tests = [t for t in all_tests() if (t.stacks is None or ctx.stack in t.stacks) and (only is None or t.name in only)]
    for tier in TIERS:
        family = "real" if tier == "real" else "hidden"
        mine = [t for t in tests if t.tier == tier]
        if family not in fams or not mine:
            continue
        if tier == "real":
            ready, why = copilot_ready()
            if not ready:
                for t in mine:
                    record(t.key, None, f"skipped: {why}", 0)
                after_tier()
                continue
        up, detail = ctx.ensure_services()
        if not up:
            for t in mine:
                record(t.key, False, f"services not up before {tier}: {detail}", 0)
            after_tier()
            continue
        for t in mine:
            started = time.monotonic()
            print(f"[verifier] {t.key} ...", flush=True)
            try:
                passed, detail = t.fn(ctx)
            except Skip as e:
                passed, detail = None, f"skipped: {e}"
            except Exception:
                passed, detail = False, traceback.format_exc()[-1500:]
            record(t.key, passed, detail, time.monotonic() - started)
        after_tier()
