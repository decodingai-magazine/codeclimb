"""Score retrieval: one envelope per query against the row's `expected` nodes, edges and documents
(README.md, Scoring and Splits).

    uv run python evaluators/retrieval.py inputs --split dev --out queries.jsonl
    uv run python evaluators/retrieval.py score  --split dev \
        --predictions envelopes.jsonl --out report.json [--unranked]

`inputs` writes `{id, query}` only: every `temporal` query states its window in words. The engine
always gets the full `corpus/` and graph; only the queries are split. Each metric is averaged over
the rows it applies to, never as a zero for the rest, and reported per `kind`, `difficulty` and
`origin` with a seeded bootstrap interval.
"""

from collections import defaultdict
from pathlib import Path

import click
from common import (
    BOOTSTRAP_RESAMPLES,
    BOOTSTRAP_SEED,
    f1,
    fmt,
    graph,
    held_out_rows,
    keys,
    mean_ci,
    normalize,
    ratio,
    read_predictions,
    refuse_test_details,
    retrieval_rows,
    split_header,
    split_options,
    write_jsonl,
    write_report,
)
from loguru import logger
from pydantic import BaseModel, ConfigDict

COMPARING = {"compared_with", "alternative_to"}
RETURNED_SHOWN = 10
"""Nodes, edges and docs per query in `--details`: the ones a ranked metric reads."""
K = {"single_hop": 5, "multi_hop": 5, "comparison": 5}  # aggregation and temporal cut at the expected size
PRIMARY = {
    "single_hop": ["edge_recall_at_k"],
    "multi_hop": ["path_complete"],
    "aggregation": ["r_precision", "set_f1"],
    "temporal": ["r_precision", "set_f1"],
    "comparison": ["edge_recall_at_k"],
    "intersection": ["answer_mrr", "edge_recall_at_all"],
    "unanswerable": ["abstained"],
}


class Node(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    name: str
    aliases: list[str] = []
    score: float | None = None


class Edge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    target: str
    semantic_type: str | None = None
    score: float | None = None


class Doc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doc_uri: str
    score: float | None = None


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    nodes: list[Node] = []
    edges: list[Edge] = []
    docs: list[Doc] = []
    passage_tokens: int | None = None


def returned(env: Envelope | None) -> dict:
    """The top of what a query got back, for the reviewer to read against its query. The expected set stays out."""
    if env is None:
        return {"nodes": [], "edges": [], "docs": []}
    return {
        "nodes": [f"{n.name} ({n.type})" for n in env.nodes[:RETURNED_SHOWN]],
        "edges": [f"{e.source} -{e.semantic_type}-> {e.target}" for e in env.edges[:RETURNED_SHOWN]],
        "docs": [d.doc_uri for d in env.docs[:RETURNED_SHOWN]],
    }


def primary_metrics(kind: str, ranked: bool) -> list[str]:
    """A kind's primary metrics; unranked, the order-reading ones give way to their order-free form."""
    if ranked:
        return [*PRIMARY[kind], "subgraph_precision"]
    unranked = {"edge_recall_at_k": "edge_recall_at_all", "r_precision": None, "answer_mrr": None}
    out = [unranked.get(p, p) for p in PRIMARY[kind]]
    return list(dict.fromkeys(p for p in out if p)) + ["subgraph_precision"]


def gold_keys() -> dict[tuple[str, str], set[str]]:
    """(type, name) -> the keys of the entity's name and every alias in the merged graph."""
    return {(e["type"], e["name"]): keys(e["name"], *e["aliases"]) for e in graph()["entities"]}


def score_row(row: dict, env: Envelope, ranked: bool, entity_keys: dict, mentions: dict, published: dict) -> dict:
    """Every metric that applies to this row (README.md, Scoring, 3. Retrieval), keyed by name."""
    kind, ex = row["kind"], row["expected"]
    top = lambda items, k: items if not ranked or k is None else items[:k]  # noqa: E731
    exp_keys = [entity_keys[(n["type"], n["name"])] for n in ex["nodes"]]
    by_name = {n["name"]: exp_keys[i] for i, n in enumerate(ex["nodes"])}

    def node_hit(n: Node, i: int) -> bool:
        return n.type == ex["nodes"][i]["type"] and bool(keys(n.name, *n.aliases) & exp_keys[i])

    def edge_hit(e: Edge, x: dict, strict: bool = False) -> bool:
        src, tgt = normalize(e.source), normalize(e.target)
        forward = src in by_name[x["source"]] and tgt in by_name[x["target"]]
        backward = x["semantic_type"] in COMPARING and src in by_name[x["target"]] and tgt in by_name[x["source"]]
        return (forward or backward) and (not strict or e.semantic_type == x["semantic_type"])

    def edges_found(returned: list[Edge], strict: bool = False) -> int:
        return sum(any(edge_hit(e, x, strict) for e in returned) for x in ex["edges"])

    docs = list(dict.fromkeys(d.doc_uri for d in env.docs))
    expected_docs = {d["doc_uri"] for d in ex["docs"]}
    m: dict[str, float] = {}
    k = K.get(kind)
    if ex["edges"]:
        if k and ranked:
            m["edge_recall_at_k"] = edges_found(top(env.edges, k)) / len(ex["edges"])
        m["edge_recall_at_all"] = edges_found(env.edges) / len(ex["edges"])
        m["edge_recall_strict_at_all"] = edges_found(env.edges, strict=True) / len(ex["edges"])
    if kind == "multi_hop":
        m["path_complete"] = float(edges_found(env.edges) == len(ex["edges"]))
    if kind in ("aggregation", "temporal"):
        size = len(expected_docs)
        if ranked:
            m["r_precision"] = sum(d in expected_docs for d in docs[:size]) / size
        hits = len(set(docs) & expected_docs)
        m["set_f1"] = f1(ratio(hits, len(docs)), hits / size) or 0.0
    if kind == "temporal":
        anchor = next(n for n in ex["nodes"] if n["role"] == "anchor")
        window = row["window"]
        outside = {u for u in mentions[(anchor["type"], anchor["name"])] if not window["from"] <= published[u][:7] <= window["to"]}
        m["temporal_distractors"] = float(len(set(docs) & outside))
    answers = [i for i, n in enumerate(ex["nodes"]) if n["role"] == "answer"]
    if answers and ranked:
        rank = next((r for r, n in enumerate(env.nodes, 1) if any(node_hit(n, i) for i in answers)), None)
        m["answer_mrr"] = 1 / rank if rank else 0.0
    anchors = [i for i, n in enumerate(ex["nodes"]) if n["role"] == "anchor"]
    if anchors:
        m["anchor_recall"] = sum(any(node_hit(n, i) for n in env.nodes) for i in anchors) / len(anchors)
    if ex["nodes"] and ranked:
        m["node_recall_at_k"] = sum(any(node_hit(n, i) for n in top(env.nodes, k)) for i in range(len(ex["nodes"]))) / len(ex["nodes"])
    matched_nodes = sum(any(node_hit(n, i) for i in range(len(ex["nodes"]))) for n in env.nodes)
    matched_edges = sum(any(edge_hit(e, x) for x in ex["edges"]) for e in env.edges)
    if env.nodes:
        m["node_precision"] = matched_nodes / len(env.nodes)
    if env.edges:
        m["edge_precision"] = matched_edges / len(env.edges)
    if env.nodes or env.edges:
        m["subgraph_precision"] = (matched_nodes + matched_edges) / (len(env.nodes) + len(env.edges))
    m["returned_nodes"], m["returned_edges"], m["returned_docs"] = float(len(env.nodes)), float(len(env.edges)), float(len(docs))
    if env.passage_tokens is not None:
        m["passage_tokens"] = float(env.passage_tokens)
    if kind == "unanswerable":
        m["abstained"] = float(not (env.nodes or env.edges or env.docs))
    return m


def summarize(rows: list[dict], scores: dict[str, dict]) -> dict:
    by_metric = defaultdict(list)
    for r in rows:
        for name, value in scores[r["id"]].items():
            by_metric[name].append(value)
    return {name: mean_ci(values) for name, values in sorted(by_metric.items())}


@click.group()
def cli() -> None:
    """Retrieval evaluator (spec/agent/train.md, Retrieval)."""


@cli.command()
@split_options
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL of {id, query}.")
def inputs(split_name: str, out_path: Path) -> None:
    """Write the held-out queries: id and text only."""
    ids = set(held_out_rows(split_name))
    n = write_jsonl(out_path, ({"id": r["id"], "query": r["query"]} for r in retrieval_rows() if r["id"] in ids))
    logger.info(f"{n} queries -> {out_path}")


@cli.command()
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL of train examples.")
def examples(out_path: Path) -> None:
    """Write the train queries with their expected sets: few-shot material, never scored."""
    ids = set(held_out_rows("train"))
    n = write_jsonl(out_path, (r for r in retrieval_rows() if r["id"] in ids))
    logger.info(f"{n} train queries -> {out_path}")


@cli.command()
@split_options
@click.option("--predictions", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True, help="JSONL of envelopes.")
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="Where the JSON report is written.")
@click.option("--ranked/--unranked", default=True, show_default=True, help="Whether list order is the engine's ranking.")
@click.option("--details", is_flag=True, help="Add per-query metrics (train and dev only).")
def score(split_name: str, predictions: Path, out_path: Path, ranked: bool, details: bool) -> None:
    """Score envelopes against the held-out rows' expected sets."""
    refuse_test_details(split_name, details)
    ids = held_out_rows(split_name)
    rows = [r for r in retrieval_rows() if r["id"] in set(ids)]
    envelopes, outside = {}, 0
    for env in read_predictions(predictions, Envelope):
        if env.id not in set(ids):
            outside += 1
        elif envelopes.setdefault(env.id, env) is not env:
            raise click.ClickException(f"{predictions}: two envelopes for {env.id}")
    entity_keys = gold_keys()
    names = {e["id"]: (e["type"], e["name"]) for e in graph()["entities"]}
    mentions = defaultdict(set)
    for m in graph()["relationships"]["mentions"]:
        mentions[names[m["entity_id"]]].add(m["doc_uri"])
    published = {d["uri"]: d["published"] for d in graph()["documents"]}
    scores = {r["id"]: score_row(r, envelopes.get(r["id"], Envelope(id=r["id"])), ranked, entity_keys, mentions, published) for r in rows}

    group = lambda field: {v: summarize([r for r in rows if r[field] == v], scores) for v in sorted({r[field] for r in rows})}  # noqa: E731
    by_kind = {
        kind: {
            "rows": sum(r["kind"] == kind for r in rows),
            "primary": primary_metrics(kind, ranked),
            "metrics": metrics,
        }
        for kind, metrics in group("kind").items()
    }
    report = {
        **split_header(split_name, 0, len(rows), "rows"),
        "ranked": ranked,
        "rows": {"missing_envelopes": [r["id"] for r in rows if r["id"] not in envelopes], "envelopes_outside_held_out": outside},
        "by_kind": by_kind,
        "by_difficulty": group("difficulty"),
        "by_origin": group("origin"),
        "bootstrap": {"resamples": BOOTSTRAP_RESAMPLES, "seed": BOOTSTRAP_SEED, "interval": "percentile 95%"},
        "note": "a missing envelope is scored as an empty one; report per kind, never one average across kinds",
        "not_wired": ["anchor rarity slice", "BM25-miss slice", "closed-book gate"],
    }
    if details:
        report["details"] = {
            r["id"]: {"kind": r["kind"], "query": r["query"], "metrics": scores[r["id"]], "returned": returned(envelopes.get(r["id"]))} for r in rows
        }
    write_report(out_path, report)
    primary = "; ".join(f"{kind} {p}={fmt(v['metrics'].get(p, {}).get('mean'))}" for kind, v in by_kind.items() for p in v["primary"][:1])
    logger.info(f"{len(rows)} queries: {primary} -> {out_path}")


if __name__ == "__main__":
    cli()
