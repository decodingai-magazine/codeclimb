"""LangChain: the Agent Server stack (`langgraphjs up`), which `npm run server` starts and waits for."""

import subprocess
import time
from pathlib import Path

from adapters import Adapter, Services, answers, kill_group, spawn, wait_for

SERVER = "http://127.0.0.1:8123/ok"


class LangChain(Adapter):
    RUNS = "runs-langchain"
    # A cold `npm run server` builds the server image: 2 minutes measured. The 60 s
    # services-up limit counts from the end of that build, when the script returns.
    BUILD_S = 900

    def start_services(self, app: Path) -> Services:
        s = Services(app)
        s.processes.append(spawn(app, "server", ["npm", "run", "server"], self.LOGS))
        return s

    def wait_until_up(self, services: Services, timeout_s: float) -> tuple[bool, str]:
        # Wait for the script to return (the image is built) or the server to answer, whichever comes first.
        server = services.processes[0].proc
        deadline = time.monotonic() + self.BUILD_S
        while server.poll() is None and not answers(SERVER) and time.monotonic() < deadline:
            time.sleep(2)
        return wait_for([SERVER], timeout_s)

    def stop_services(self, services: Services) -> None:
        for p in services.processes:
            kill_group(p)
        subprocess.run(["npm", "run", "server:stop"], cwd=services.app, capture_output=True, timeout=300)
