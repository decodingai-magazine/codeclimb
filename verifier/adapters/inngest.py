"""Inngest: the local dev server plus one worker, each a process the verifier starts."""

from pathlib import Path

from adapters import Adapter, Services, spawn, wait_for

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
