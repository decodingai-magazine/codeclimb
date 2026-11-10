"""Write `gold/splits.json`: the train/dev/test split of documents and retrieval rows (README.md, Splits).

    uv run python scripts/split.py

- Documents split by time, in the log's `document` order (by `published`, then `uri`): the first
  `--train-fraction` is train, the next `--dev-fraction` is dev, the rest is test. Train comes first
  so its gold can serve as few-shot examples without revealing a later document's answers.
- Train retrieval rows are the ones written over the train documents only (ids `tr-…`): every
  document and edge they expect is a train document, and their query names no entity that only dev
  or test documents mention, so the agent's bundle can carry them.
- Every other row splits by query, never by document. Rows that share an anchor entity form one
  group, and a group never straddles dev and test. Groups are assigned greedily to dev (as three
  thirds) and test so each bucket keeps the overall `kind` x `difficulty` mix. The greedy result
  depends on the order of equal-sized groups, so `--tries` orders are tried and the most even one is
  kept.

Deterministic: the same log, rows and options give the same file.
"""

import json
import random
import sys
from collections import Counter
from pathlib import Path

import click
from loguru import logger

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compile import normalize  # noqa: E402  (the dataset's key function)

HERE = Path(__file__).resolve().parent.parent  # the dataset root
LOG = HERE / "gold" / "log.jsonl"
ROWS = HERE / "gold" / "retrieval.jsonl"
OUT = HERE / "gold" / "splits.json"
PARTS = ("train", "dev", "test")
TRAIN_PREFIX = "tr-"


def document_split(log_path: Path, train_fraction: float, dev_fraction: float) -> dict:
    """Train, dev and test as three contiguous runs of the log's documents: the first
    `train_fraction` is train, up to `train_fraction + dev_fraction` is dev, the rest is test."""
    uris = [r["doc_uri"] for r in map(json.loads, log_path.read_text(encoding="utf-8").splitlines()) if r["kind"] == "document"]
    a, b = round(len(uris) * train_fraction), round(len(uris) * (train_fraction + dev_fraction))
    return {"train": uris[:a], "dev": uris[a:b], "test": uris[b:]}


def anchor_groups(rows: list[dict]) -> list[list[dict]]:
    """Rows joined by a shared anchor `(type, name)`, transitively; a row with no anchor is its own group."""
    parent: dict = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            x = parent[x]
        return x

    for row in rows:
        for node in row["expected"]["nodes"]:
            if node["role"] == "anchor":
                parent[find(("anchor", node["type"], node["name"]))] = find(("row", row["id"]))
    groups: dict = {}
    for row in rows:
        groups.setdefault(find(("row", row["id"])), []).append(row)
    return list(groups.values())


def retrieval_split(rows_path: Path, dev_size: int, seed: int) -> tuple[dict, float]:
    """Train is the `tr-` rows. The rest: assign anchor groups to buckets, largest groups first, each to
    the bucket where it adds the least squared error to the bucket's target count per `kind` x
    `difficulty` stratum and in total; ties go to the earlier bucket. The buckets are dev as three
    thirds, then test: the thirds keep the test set of the earlier split, whose train was one of them.
    Returns the split and its imbalance over the four buckets."""
    every = [json.loads(line) for line in rows_path.read_text(encoding="utf-8").splitlines()]
    train = [r["id"] for r in every if r["id"].startswith(TRAIN_PREFIX)]
    rows = [r for r in every if not r["id"].startswith(TRAIN_PREFIX)]
    stratum = lambda r: (r["kind"], r["difficulty"])  # noqa: E731
    totals = Counter(map(stratum, rows))
    targets = [dev_size / 3] * 3 + [len(rows) - dev_size]
    counts = [Counter() for _ in targets]
    sizes = [0] * len(targets)
    buckets: list[list[str]] = [[] for _ in targets]

    groups = anchor_groups(rows)
    random.Random(seed).shuffle(groups)
    groups.sort(key=len, reverse=True)  # stable: equal sizes keep the shuffled order
    for group in groups:
        g = Counter(map(stratum, group))

        def cost(b: int) -> float:
            share = targets[b] / len(rows)
            strata = sum((counts[b][s] + g[s] - share * totals[s]) ** 2 - (counts[b][s] - share * totals[s]) ** 2 for s in g)
            return strata + (sizes[b] + len(group) - targets[b]) ** 2 - (sizes[b] - targets[b]) ** 2

        b = min(range(len(targets)), key=cost)
        counts[b] += g
        sizes[b] += len(group)
        buckets[b] += [r["id"] for r in group]

    order = {r["id"]: i for i, r in enumerate(rows)}
    ordered = lambda ids: sorted(ids, key=order.get)  # noqa: E731
    # squared distance of each bucket's stratum counts from its proportional share
    error = sum((counts[b][s] - n * sizes[b] / len(rows)) ** 2 for b in range(len(targets)) for s, n in totals.items())
    return {"train": train, "dev": ordered(buckets[0] + buckets[1] + buckets[2]), "test": ordered(buckets[3])}, error


def check(splits: dict, log_path: Path, rows_path: Path) -> None:
    """Every document and row lands in exactly one part, document parts are contiguous in log order
    (train, then dev, then test), no anchor sits in both dev and test, and every train row is
    grounded in train documents: the documents and edges it expects, and every entity its query names."""
    log = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    uris = [r["doc_uri"] for r in log if r["kind"] == "document"]
    rows = {r["id"]: r for r in map(json.loads, rows_path.read_text(encoding="utf-8").splitlines())}
    for part, universe in (("documents", uris), ("retrieval", list(rows))):
        flat = [x for p in PARTS for x in splits[part][p]]
        assert sorted(flat) == sorted(universe), f"{part}: not a partition of the {len(universe)} items"
    d = splits["documents"]
    assert uris == d["train"] + d["dev"] + d["test"], "documents: not contiguous in log order"
    train_docs = set(d["train"])
    surfaces: dict[str, set[str]] = {}  # name key -> documents mentioning a surface with that key
    for r in log:
        if r["kind"] == "entity_mention":
            for name in [r["name"], *r["aliases"]]:
                if key := normalize(name):
                    surfaces.setdefault(key, set()).add(r["doc_uri"])
    for rid in splits["retrieval"]["train"]:
        row = rows[rid]
        used = {x["doc_uri"] for x in row["expected"]["docs"] + row["expected"]["edges"]}
        assert used <= train_docs, f"{rid}: expects documents outside train: {sorted(used - train_docs)}"
        query = f"-{normalize(row['query'])}-"
        outside = sorted(k for k, ds in surfaces.items() if f"-{k}-" in query and not ds & train_docs)
        assert not outside, f"{rid}: query names entities only dev or test documents mention: {outside}"
    owner: dict = {}
    for name in ("dev", "test"):
        for rid in splits["retrieval"][name]:
            for node in rows[rid]["expected"]["nodes"]:
                if node["role"] == "anchor":
                    key = (node["type"], node["name"])
                    assert owner.setdefault(key, name) == name, f"anchor {key} sits in {owner[key]} and {name}"


@click.command()
@click.option("--train-fraction", type=float, default=0.22, show_default=True, help="Share of documents, earliest first, that is train.")
@click.option("--dev-fraction", type=float, default=0.44, show_default=True, help="Share of documents after train that is dev.")
@click.option(
    "--retrieval-dev-size", type=int, default=90, show_default=True, help="Retrieval rows in dev; the other non-train rows are test."
)
@click.option("--tries", type=int, default=10, show_default=True, help="Group orders tried (seeds 0..tries-1); the most even is kept.")
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), default=OUT, show_default=True)
def main(train_fraction: float, dev_fraction: float, retrieval_dev_size: int, tries: int, out_path: Path) -> None:
    split_at = lambda s: retrieval_split(ROWS, retrieval_dev_size, s)  # noqa: E731
    seed = min(range(tries), key=lambda s: split_at(s)[1])
    retrieval, error = split_at(seed)
    splits = {
        "params": {
            "train_fraction": train_fraction,
            "dev_fraction": dev_fraction,
            "retrieval_dev_size": retrieval_dev_size,
            "seed": seed,
        },
        "documents": document_split(LOG, train_fraction, dev_fraction),
        "retrieval": retrieval,
    }
    check(splits, LOG, ROWS)
    out_path.write_text(json.dumps(splits, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    d, r = splits["documents"], splits["retrieval"]
    logger.info(
        f"documents: {' '.join(f'{p}={len(d[p])}' for p in PARTS)}; retrieval: {' '.join(f'{p}={len(r[p])}' for p in PARTS)} "
        f"(seed {seed} of {tries}, imbalance {error:.1f}) -> {out_path}"
    )


if __name__ == "__main__":
    main()
