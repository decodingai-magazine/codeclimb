"""LangChain: the Agent Server stack (`langgraphjs up`), which `npm run server` starts and waits for."""

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from adapters import Adapter, Process, Services, answers, kill_group, run_group, spawn, wait_for

BASE = "http://127.0.0.1:8123"
SERVER = f"{BASE}/ok"
# The Agent Server's thread search, a platform endpoint.
THREADS = f"{BASE}/threads/search"
# The worker API with its watchdog (`npm run api`); a route answering any status below 500 means it is up.
WORKER_API = "http://127.0.0.1:7421/api/health"
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
        return [cid for cid in self.server_containers(services) if run_group(["docker", "kill", cid], services.app, 60)[0] == 0]

    def server_containers(self, services: Services) -> list[str]:
        _, ids = run_group(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.service={SERVICE}"], services.app, 60)
        return ids.split()

    def pause_runtime(self, services: Services, seconds: float) -> list[str]:
        """The server's Postgres and Redis: every other container of its compose project, `docker pause`d, then
        unpaused. The server container keeps running."""
        frozen = []
        for cid in self.server_containers(services):
            _, project = run_group(["docker", "inspect", "-f", '{{index .Config.Labels "com.docker.compose.project"}}', cid], services.app, 60)
            _, ids = run_group(["docker", "ps", "-q", "--filter", f"label=com.docker.compose.project={project.strip()}"], services.app, 60)
            frozen += [c for c in ids.split() if c != cid and c not in frozen]
        paused = [c for c in frozen if run_group(["docker", "pause", c], services.app, 60)[0] == 0]
        try:
            time.sleep(seconds)
        finally:
            for c in paused:
                run_group(["docker", "unpause", c], services.app, 60)
        return [f"{c} (docker pause {seconds:g} s)" for c in paused]

    def stop_runtime(self, services: Services) -> list[str]:
        # `docker stop`: SIGTERM, then a kill after Docker's grace period.
        return [cid for cid in self.server_containers(services) if run_group(["docker", "stop", cid], services.app, 120)[0] == 0]

    def start_watchdog(self, services: Services) -> tuple[Process, bool, str]:
        p = spawn(services.app, "api", ["npm", "run", "api"], self.LOGS)
        up, detail = wait_for([WORKER_API], self.SERVICES_UP_S)
        return p, up, detail

    def thread_ids(self) -> set[str]:
        ids: set[str] = set()
        offset, limit = 0, 1000
        while True:
            body = json.dumps({"limit": limit, "offset": offset}).encode()
            req = urllib.request.Request(THREADS, data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                page = json.loads(r.read())
            ids |= {t["thread_id"] for t in page}
            if len(page) < limit:
                return ids
            offset += limit

    def cancel_runs(self, services: Services) -> list[str]:
        """`outside-cancel`: cancel every pending or running run on every busy thread, through the Agent Server's
        REST API with its default action. Returns `<thread>/<run>` of each cancel the server accepted."""
        cancelled = []
        body = json.dumps({"status": "busy", "limit": 100}).encode()
        req = urllib.request.Request(THREADS, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            threads = [t["thread_id"] for t in json.loads(r.read())]
        for tid in threads:
            for status in ("running", "pending"):
                with urllib.request.urlopen(f"{BASE}/threads/{tid}/runs?status={status}&limit=50", timeout=30) as r:
                    runs = [x["run_id"] for x in json.loads(r.read())]
                for rid in runs:
                    req = urllib.request.Request(f"{BASE}/threads/{tid}/runs/{rid}/cancel", data=b"", method="POST")
                    try:
                        with urllib.request.urlopen(req, timeout=30) as r:
                            if r.status < 300:
                                cancelled.append(f"{tid}/{rid}")
                    except urllib.error.HTTPError:
                        pass
        return cancelled

    def log_files(self, services: Services) -> dict[str, str]:
        """The service scripts' logs, and the server container's whole log (`docker logs`)."""
        logs = super().log_files(services)
        for cid in self.server_containers(services):
            _, log = run_group(["docker", "logs", cid], services.app, 120)
            logs[f"{SERVICE}.log"] = re.sub(r"\x1b\[[0-9;]*m", "", log)
        return logs

    def runtime_diagnostics(self, services: Services) -> str:
        """The server container's log end, and the latest threads with their runs' statuses."""
        out = []
        for cid in self.server_containers(services):
            _, log = run_group(["docker", "logs", "--tail", "60", cid], services.app, 60)
            out.append(f"--- docker logs {cid}\n{re.sub(r'\x1b\[[0-9;]*m', '', log)[-3000:]}")
        try:
            body = json.dumps({"limit": 5, "sort_by": "updated_at", "sort_order": "desc"}).encode()
            req = urllib.request.Request(THREADS, data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=30) as r:
                threads = json.loads(r.read())
            for th in threads:
                tid = th.get("thread_id")
                with urllib.request.urlopen(f"http://127.0.0.1:8123/threads/{tid}/runs?limit=5", timeout=30) as r:
                    runs = [(x.get("status"), x.get("created_at"), x.get("updated_at")) for x in json.loads(r.read())]
                out.append(f"--- thread {tid} status {th.get('status')} updated {th.get('updated_at')} "
                           f"metadata {json.dumps(th.get('metadata'))[:200]}; runs {runs}")
        except Exception as e:
            out.append(f"--- threads: {e!r}")
        return "\n".join(out)

    def restart_runtime(self, services: Services) -> tuple[bool, str]:
        services.processes.append(spawn(services.app, "server-restart", ["npm", "run", "server"], self.LOGS))
        return self.wait_until_up(services, self.SERVICES_UP_S)

    def stop_services(self, services: Services) -> None:
        for p in services.processes:
            kill_group(p)
        run_group(["npm", "run", "server:stop"], services.app, 300)
