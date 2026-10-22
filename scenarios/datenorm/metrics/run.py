"""datenorm runner (run_cmd). Runs inside the eval sandbox; never sees gold.

    python3 run.py --queries <jsonl> --repo <path> --out <dir>

Starts `python3 -m datenorm` once in --repo, sends one query per line, waits for
its answer and times it. Writes <out>/outputs.jsonl ({id, raw, latency_ms}) and
<out>/run.json. A query that times out or kills the program is recorded with
raw=null and the program is restarted for the next query.
"""

import argparse
import json
import os
import selectors
import subprocess
import sys
import time

ANSWER_TIMEOUT_S = 5.0


class Program:
    def __init__(self, repo: str):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "datenorm"],
            cwd=repo,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.sel = selectors.DefaultSelector()
        self.sel.register(self.proc.stdout, selectors.EVENT_READ)
        self.buf = b""

    def ask(self, line: str) -> str | None:
        self.proc.stdin.write(line.encode() + b"\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + ANSWER_TIMEOUT_S
        while b"\n" not in self.buf:
            left = deadline - time.monotonic()
            if left <= 0 or not self.sel.select(timeout=left):
                return None
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:  # program exited
                return None
            self.buf += chunk
        out, self.buf = self.buf.split(b"\n", 1)
        return out.decode(errors="replace")

    def close(self) -> None:
        try:
            self.proc.kill()
            self.proc.wait(timeout=5)
        except Exception:
            pass


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--queries", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    queries = [json.loads(l) for l in open(args.queries) if l.strip()]

    started = time.monotonic()
    restarts = 0
    prog = Program(args.repo)
    with open(os.path.join(args.out, "outputs.jsonl"), "w") as f:
        for q in queries:
            t0 = time.perf_counter()
            try:
                raw = prog.ask(json.dumps({"id": q["id"], "text": q["text"], "locale": q["locale"]}, ensure_ascii=False))
            except (BrokenPipeError, OSError):
                raw = None
            latency_ms = (time.perf_counter() - t0) * 1000
            if raw is None:
                prog.close()
                prog = Program(args.repo)
                restarts += 1
            f.write(json.dumps({"id": q["id"], "raw": raw, "latency_ms": round(latency_ms, 3)}) + "\n")
    prog.close()
    with open(os.path.join(args.out, "run.json"), "w") as f:
        json.dump({"n": len(queries), "restarts": restarts, "wall_s": round(time.monotonic() - started, 3)}, f)


if __name__ == "__main__":
    main()
