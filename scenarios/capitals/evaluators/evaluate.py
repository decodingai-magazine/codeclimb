"""The scenario's evaluator CLI, run by codeclimb on the worker host (scenario.yaml `inputs` and `score`).

    python3 evaluators/evaluate.py inputs   --split dev --out in.jsonl
    python3 evaluators/evaluate.py score    --split dev --predictions <dir> --out report.json
    python3 evaluators/evaluate.py examples --out train.jsonl

`inputs` writes the part's queries with gold and HIDDEN fields removed; `score` scores the runner's
`<dir>/outputs.jsonl` against the part's gold with `score.py`; `examples` writes train with gold, the
coder's few-shot material (scripts/export_agent.py). Splits come from gold/splits.json.
"""

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HIDDEN = {"gold"}
"""Fields never sent to the program: the answer."""


def part(name: str) -> list[dict]:
    ids = json.loads((ROOT / "gold" / "splits.json").read_text())[name]
    items = {it["id"]: it for it in map(json.loads, (ROOT / "gold" / "items.jsonl").read_text().splitlines())}
    return [items[i] for i in ids]


def write_jsonl(path: str, rows: list[dict]) -> None:
    Path(path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("inputs")
    p.add_argument("--split", choices=["train", "dev", "test"], required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("score")
    p.add_argument("--split", choices=["train", "dev", "test"], required=True)
    p.add_argument("--predictions", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("examples")
    p.add_argument("--out", required=True)
    args = ap.parse_args()

    if args.cmd == "inputs":
        write_jsonl(args.out, [{k: v for k, v in it.items() if k not in HIDDEN} for it in part(args.split)])
    elif args.cmd == "examples":
        write_jsonl(args.out, part("train"))
    else:
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            items = f.name
        write_jsonl(items, part(args.split))
        try:
            subprocess.run(
                [sys.executable, str(ROOT / "evaluators" / "score.py"), "--items", items, "--outputs", args.predictions, "--out", args.out],
                check=True,
            )
        finally:
            Path(items).unlink()


if __name__ == "__main__":
    main()
