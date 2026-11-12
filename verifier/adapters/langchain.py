"""LangChain: the Agent Server stack (`langgraphjs up`), which `npm run server` starts and waits for."""

import time
from pathlib import Path

from adapters import Adapter, Services, answers, kill_group, run_group, spawn, wait_for

SERVER = "http://127.0.0.1:8123/ok"
# The server's compose service, the one night 5 kills.
SERVICE = "langgraph-api"


class LangChain(Adapter):
    RUNS = "runs-langchain"
    # A cold `npm run server` builds the server image (2 minutes measured), then returns once /ok answers. The 60 s
    # services-up limit counts from the end of that build, when the script returns.
    BUILD_S = 600

    def start_services(self, app: Path) -> Services:
        s = Services(app)
        s.processes.append(spawn(app, "server", ["npm", "run", "server"], self.LOGS))
        return s

    def wait_until_up(self, services: Services, timeout_s: float) -> tuple[bool, str]:
        # Wait for the script to return (the image is built) or the server to answer, whichever comes first.
        server = services.processes[-1].proc
        deadline = time.monotonic() + self.BUILD_S
        while server.poll() is None and not answers(SERVER) and time.monotonic() < deadline:
            time.sleep(2)
        return wait_for([SERVER], timeout_s)

    def crash_runtime(self, services: Services) -> list[str]:
        # The server container only: Postgres and Redis keep running. The verifier has its own daemon, so the
        # service label finds this stack's server alone.
        _, ids = run_group(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.service={SERVICE}"], services.app, 60)
        return [cid for cid in ids.split() if run_group(["docker", "kill", cid], services.app, 60)[0] == 0]

    def restart_runtime(self, services: Services) -> tuple[bool, str]:
        services.processes.append(spawn(services.app, "server-restart", ["npm", "run", "server"], self.LOGS))
        return self.wait_until_up(services, self.SERVICES_UP_S)

    def stop_services(self, services: Services) -> None:
        for p in services.processes:
            kill_group(p)
        run_group(["npm", "run", "server:stop"], services.app, 300)
