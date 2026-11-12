"""Stack adapters: the only stack-specific code of the verifier.

An adapter knows how to start and stop a stack's services, where their logs are,
how to crash its runtime (night 5), and the name of its runs folder.
"""

import http.client
import os
import signal
import subprocess
import time
import traceback
from collections.abc import Callable
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Process:
    name: str
    proc: subprocess.Popen[bytes]
    log: Path


@dataclass
class Services:
    app: Path
    processes: list[Process] = field(default_factory=list)


def spawn(app: Path, name: str, cmd: list[str], logs: Path) -> Process:
    """Start a long-running service in its own process group, its output to a log file."""
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / f"{name}.log"
    with log.open("ab") as f:
        proc = subprocess.Popen(cmd, cwd=app, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
    return Process(name, proc, log)


def kill_group(p: Process, sig: int = signal.SIGTERM, wait_s: float = 15) -> None:
    """Signal a service and its children, then SIGKILL the group: a child that ignored the first
    signal (the inngest binary under npm) must not keep its port."""
    try:
        os.killpg(p.proc.pid, sig)
    except ProcessLookupError:
        return
    try:
        p.proc.wait(timeout=wait_s)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(p.proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    p.proc.wait()


def run_group(cmd: list[str], cwd: Path, timeout_s: float) -> tuple[int, str]:
    """Run a command in its own process group; on a timeout kill the whole group. Returns (exit code, output);
    -1 on a timeout."""
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout_s)
        return proc.returncode, out.decode(errors="replace")
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, _ = proc.communicate()
        return -1, f"timed out after {timeout_s:.0f}s\n" + out.decode(errors="replace")


def guarded(check: Callable[..., tuple[bool, str]], *args: object) -> tuple[bool, str]:
    """A check that raises fails, with its traceback as detail."""
    try:
        return check(*args)
    except Exception:
        return False, traceback.format_exc()[-1500:]


def answers(url: str) -> bool:
    """True when the URL gives any HTTP status below 500."""
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except (urllib.error.URLError, OSError, http.client.HTTPException, ValueError):
        return False


def wait_for(urls: list[str], timeout_s: float) -> tuple[bool, str]:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        down = [u for u in urls if not answers(u)]
        if not down:
            return True, f"answering: {', '.join(urls)}"
        time.sleep(1)
    return False, f"not answering after {timeout_s:.0f}s: {', '.join(down)}"


def tail(path: Path, n: int = 4000) -> str:
    return path.read_text(errors="replace")[-n:] if path.exists() else ""


class Adapter:
    RUNS: str
    # The stack's services must answer within this many seconds of their start.
    SERVICES_UP_S = 60
    LOGS = Path("/tmp/verifier-services")

    def start_services(self, app: Path) -> Services:
        raise NotImplementedError

    def wait_until_up(self, services: Services, timeout_s: float) -> tuple[bool, str]:
        raise NotImplementedError

    def crash_runtime(self, services: Services) -> list[str]:
        """Night 5: kill the runtime that runs the night's steps, with no warning. Returns what it killed."""
        raise NotImplementedError

    def restart_runtime(self, services: Services) -> tuple[bool, str]:
        """Night 5: start the runtime again, and nothing else; (answering, detail)."""
        raise NotImplementedError

    def stop_services(self, services: Services) -> None:
        for p in reversed(services.processes):
            kill_group(p)

    def service_logs(self, services: Services) -> str:
        return "\n".join(f"--- {p.name}\n{tail(p.log)}" for p in services.processes)


from adapters.inngest import Inngest  # noqa: E402
from adapters.langchain import LangChain  # noqa: E402

ADAPTERS: dict[str, Adapter] = {"inngest": Inngest(), "langchain": LangChain()}
