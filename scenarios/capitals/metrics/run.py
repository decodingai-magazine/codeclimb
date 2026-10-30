"""capitals runner (run_cmd). Runs inside the eval sandbox; never sees gold.

    python3 run.py --queries <jsonl> --repo <path> --out <dir>

Starts `python3 -m capitals` once in --repo, tells the metering proxy that the
"query" operation starts, then sends one query per line and times each answer.
Writes <out>/outputs.jsonl ({id, raw}), <out>/timings.jsonl (codeclimb's
standard timings, the first answer marked as a warm-up) and <out>/run.json.
"""

import argparse
import json
import os
import selectors
import subprocess
import sys
import time
import urllib.request

ANSWER_TIMEOUT_S = 60.0


def set_op(op: str) -> None:
    """Name the operation the program's next model calls belong to (no-op when not metered)."""
    base, key = os.environ.get("CODECLIMB_LLM_BASE_URL"), os.environ.get("CODECLIMB_LLM_API_KEY")
    if not base or not key:
        return
    req = urllib.request.Request(
        base.rstrip("/") + "/_op",
        data=json.dumps({"op": op}).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + key},
    )
    urllib.request.urlopen(req, timeout=10).read()


class Program:
    def __init__(self, repo: str):
        self.proc = subprocess.Popen(
            [sys.executable, "-m", "capitals"],
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
            if not chunk:
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
    set_op("query")
    with open(os.path.join(args.out, "outputs.jsonl"), "w") as f, open(os.path.join(args.out, "timings.jsonl"), "w") as tf:
        for i, q in enumerate(queries):
            t0 = time.perf_counter()
            try:
                raw = prog.ask(json.dumps({"id": q["id"], "country": q["country"]}, ensure_ascii=False))
            except (BrokenPipeError, OSError):
                raw = None
            ms = (time.perf_counter() - t0) * 1000
            if raw is None:
                prog.close()
                prog = Program(args.repo)
                restarts += 1
            f.write(json.dumps({"id": q["id"], "raw": raw}) + "\n")
            timing = {"op": "query", "id": q["id"], "ms": round(ms, 3)}
            tf.write(json.dumps({**timing, "warmup": True} if i == 0 else timing) + "\n")
    prog.close()
    with open(os.path.join(args.out, "run.json"), "w") as f:
        json.dump({"n": len(queries), "restarts": restarts, "wall_s": round(time.monotonic() - started, 3)}, f)


if __name__ == "__main__":
    main()
