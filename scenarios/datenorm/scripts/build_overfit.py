"""Build the overfit variant of datenorm for the end-to-end tests: dev and test hold the train items.

A coder reads train with its gold, so a night on this scenario must reach a top score, and test must
equal dev. It proves the loop climbs when the answer is in reach. Never use it to judge a program.

    python3 scenarios/datenorm/scripts/build_overfit.py --out generated/datenorm-overfit

The copy is whole (evaluators, gold, starter, spec); only gold/splits.json differs. An existing copy is
replaced only if this script made it.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MARKER = ".built-by-build_overfit"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    out = Path(ap.parse_args().out).resolve()
    if out == ROOT or ROOT in out.parents:
        sys.exit(f"{out} is inside the scenario it copies")
    if out.exists() and any(out.iterdir()):
        if not (out / MARKER).exists():
            sys.exit(f"{out} is not empty and was not built by this script")
        shutil.rmtree(out)
    shutil.copytree(ROOT, out, ignore=shutil.ignore_patterns("__pycache__", ".venv"), dirs_exist_ok=True)
    splits_path = out / "gold" / "splits.json"
    train = json.loads(splits_path.read_text())["train"]
    splits_path.write_text(json.dumps({"train": train, "dev": train, "test": train}, indent=2) + "\n")
    (out / MARKER).write_text("generated: do not edit\n")
    print(f"{out}: train = dev = test = {len(train)} items")


if __name__ == "__main__":
    main()
