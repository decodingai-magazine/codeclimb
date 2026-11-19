"""Inngest: the local dev server plus one worker, each a process the verifier starts."""

import json
import os
import signal
import time
import urllib.error
import urllib.request
from pathlib import Path

from adapters import Adapter, Services, kill_group, spawn, wait_for

DEV_SERVER = "http://127.0.0.1:8288/"
# The worker API's default address (CODECLIMB_API_HOST / CODECLIMB_API_PORT).
WORKER_API = "http://127.0.0.1:7421/api/nights"
# Seconds a SIGTERMed worker may take to exit before it is killed.
GRACE_S = 30


class Inngest(Adapter):
    RUNS = "runs-inngest"

    def start_services(self, app: Path) -> Services:
        s = Services(app)
        s.processes.append(spawn(app, "dev-inngest", ["npm", "run", "dev:inngest"], self.LOGS))
        s.processes.append(spawn(app, "worker", ["npm", "run", "worker"], self.LOGS))
        return s

    def wait_until_up(self, services: Services, timeout_s: float) -> tuple[bool, str]:
        return wait_for([DEV_SERVER, WORKER_API], timeout_s)

    def crash_runtime(self, services: Services) -> list[str]:
        # The worker with its children; the dev server keeps running.
        worker = next(p for p in reversed(services.processes) if p.name.startswith("worker"))
        alive = worker.proc.poll() is None
        kill_group(worker, signal.SIGKILL, wait_s=0)
        return [f"{worker.name} (pid {worker.proc.pid})"] if alive else []

    def stop_runtime(self, services: Services) -> list[str]:
        # SIGTERM to the worker's process group; SIGKILL only if it is still there after the grace period.
        worker = next(p for p in reversed(services.processes) if p.name.startswith("worker"))
        alive = worker.proc.poll() is None
        kill_group(worker, signal.SIGTERM, wait_s=GRACE_S)
        return [f"{worker.name} (pid {worker.proc.pid}, SIGTERM)"] if alive else []

    def pause_runtime(self, services: Services, seconds: float) -> list[str]:
        """The dev server's process group (the inngest binary under npm): SIGSTOP, then SIGCONT."""
        dev = next(p for p in services.processes if p.name.startswith("dev-inngest"))
        if dev.proc.poll() is not None:
            return []
        os.killpg(dev.proc.pid, signal.SIGSTOP)
        try:
            time.sleep(seconds)
        finally:
            os.killpg(dev.proc.pid, signal.SIGCONT)
        return [f"{dev.name} (pid {dev.proc.pid}, SIGSTOP {seconds:g} s)"]

    def cancel_runs(self, services: Services) -> list[str]:
        """`outside-cancel`: every running or queued run the dev server lists (REST v2), cancelled through REST v1's
        `DELETE /v1/runs/<id>`, the platform's own cancel. Returns `<function>/<run id>` of each accepted cancel."""
        with urllib.request.urlopen(f"{DEV_SERVER}api/v2/runs?limit=100", timeout=30) as r:
            runs = [x for x in json.loads(r.read()).get("data") or [] if x.get("status") in ("RUNNING", "QUEUED")]
        cancelled = []
        for run in runs:
            req = urllib.request.Request(f"{DEV_SERVER}v1/runs/{run['id']}", method="DELETE")
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    if r.status < 300:
                        cancelled.append(f"{(run.get('function') or {}).get('id')}/{run['id']}")
            except urllib.error.HTTPError:
                pass  # ended or cancelled meanwhile
        return cancelled

    def restart_runtime(self, services: Services) -> tuple[bool, str]:
        services.processes.append(spawn(services.app, "worker-restart", ["npm", "run", "worker"], self.LOGS))
        return wait_for([WORKER_API], self.SERVICES_UP_S)
