"""Inngest: the local dev server plus one worker, each a process the verifier starts."""

import signal
from pathlib import Path

from adapters import Adapter, Services, kill_group, spawn, wait_for

DEV_SERVER = "http://127.0.0.1:8288/"
# The worker API's default address (CODECLIMB_API_HOST / CODECLIMB_API_PORT).
WORKER_API = "http://127.0.0.1:7421/api/nights"


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

    def restart_runtime(self, services: Services) -> tuple[bool, str]:
        services.processes.append(spawn(services.app, "worker-restart", ["npm", "run", "worker"], self.LOGS))
        return wait_for([WORKER_API], self.SERVICES_UP_S)
