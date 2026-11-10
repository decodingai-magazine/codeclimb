"""One command per stage (/spec/spec/train.md, What you submit):

    python -m graphrag extraction --root <dir> --inputs <file> --out <file>
    python -m graphrag graph      --root <dir> --inputs <file> --out <file>
    python -m graphrag retrieval  --root <dir> --inputs <file> --out <file> --graph <graph.json>

Each stage is a package: extraction/ (sections, model calls, filter), graph/ (keys, resolver), retrieval/
(Ladybug store, anchors, Cypher, ranking). Settings are in config.toml.
"""

import argparse
import logging
from pathlib import Path

from . import extraction, graph, retrieval
from .config import load
from .jsonl import read_jsonl, write_jsonl


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(prog="graphrag")
    ap.add_argument("stage", choices=["extraction", "graph", "retrieval"])
    ap.add_argument("--root", type=Path, required=True, help="Directory holding corpus/.")
    ap.add_argument("--inputs", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--graph", type=Path, help="The gold graph (retrieval only).")
    args = ap.parse_args()
    cfg = load()
    items = read_jsonl(args.inputs)
    if args.stage == "extraction":
        rows = extraction.run(cfg, args.root, items, args.out)
    elif args.stage == "graph":
        rows = graph.run(items)
    else:
        if args.graph is None:
            ap.error("retrieval needs --graph")
        rows = retrieval.run(cfg, items, args.graph)
    write_jsonl(args.out, rows)


if __name__ == "__main__":
    main()
