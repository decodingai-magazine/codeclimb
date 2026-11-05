"""Write the coder's bundle, mounted at /spec in every coder sandbox (scenario.yaml `bundle`).

    python3 scripts/export_agent.py --out <new dir>

The bundle holds `spec/` (a copy of spec/agent/) and, when train is not empty, `train/examples.jsonl`:
the train items with their gold, the only data the coder may read or use as few-shot examples.
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    out = Path(ap.parse_args().out)
    if out.exists() and any(out.iterdir()):
        sys.exit(f"{out} is not empty")
    shutil.copytree(ROOT / "spec" / "agent", out / "spec", dirs_exist_ok=True)
    if json.loads((ROOT / "gold" / "splits.json").read_text())["train"]:
        (out / "train").mkdir(parents=True)
        subprocess.run([sys.executable, str(ROOT / "evaluators" / "evaluate.py"), "examples", "--out", str(out / "train" / "examples.jsonl")], check=True)


if __name__ == "__main__":
    main()
