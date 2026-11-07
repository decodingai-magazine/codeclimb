"""One command per stage (/spec/spec/train.md, What you submit):

    python -m graphrag extraction --root <dir> --inputs <file> --out <file>
    python -m graphrag graph      --root <dir> --inputs <file> --out <file>
    python -m graphrag retrieval  --root <dir> --inputs <file> --out <file> --graph <graph.json>

The starter writes empty predictions: no rows, no assignments, an empty envelope per query.
"""

import argparse
import json
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def extraction(root: Path, items: list[dict]) -> list[dict]:
    """entity_mention and related_to rows for each input document."""
    return []


def graph(root: Path, items: list[dict]) -> list[dict]:
    """{surface_id, entity_id} per surface; a missing surface is its own entity."""
    return []


def retrieval(root: Path, items: list[dict], graph_path: Path) -> list[dict]:
    """One envelope per query."""
    return [{"id": q["id"], "nodes": [], "edges": [], "docs": []} for q in items]


def main() -> None:
    ap = argparse.ArgumentParser(prog="graphrag")
    ap.add_argument("stage", choices=["extraction", "graph", "retrieval"])
    ap.add_argument("--root", type=Path, required=True, help="Directory holding corpus/.")
    ap.add_argument("--inputs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--graph", type=Path, help="The gold graph (retrieval only).")
    args = ap.parse_args()
    items = read_jsonl(args.inputs)
    if args.stage == "extraction":
        rows = extraction(args.root, items)
    elif args.stage == "graph":
        rows = graph(args.root, items)
    else:
        if args.graph is None:
            ap.error("retrieval needs --graph")
        rows = retrieval(args.root, items, args.graph)
    write_jsonl(args.out, rows)


if __name__ == "__main__":
    main()
