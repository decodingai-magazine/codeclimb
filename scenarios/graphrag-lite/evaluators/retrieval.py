"""Score retrieval: one envelope per query against the row's `expected` nodes, edges and documents
(README.md, Scoring and Splits).

    uv run python evaluators/retrieval.py inputs --split dev --out queries.jsonl
    uv run python evaluators/retrieval.py score  --split dev \
        --predictions envelopes.jsonl --out report.json [--unranked]

`inputs` writes `{id, query}` only: every `temporal` query states its window in words. The engine
always gets the full `corpus/` and graph; only the queries are split. Every kind is answered, but only
`single_hop` is scored: its edge recall@5, answer MRR and edge precision, each a mean over its rows
with a seeded bootstrap interval.
"""

from collections import defaultdict
from pathlib import Path

import click
from common import (
    BOOTSTRAP_RESAMPLES,
    BOOTSTRAP_SEED,
    fmt,
    graph,
    held_out_rows,
    keys,
    mean_ci,
    normalize,
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
SCORED = "single_hop"
"""The one kind scored; the others are answered and left unscored."""
K = 5


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
    """The top of what a query got back, for the reviewer to read against its query."""
    if env is None:
        return {"nodes": [], "edges": [], "docs": []}
    return {
        "nodes": [f"{n.name} ({n.type})" for n in env.nodes[:RETURNED_SHOWN]],
        "edges": [f"{e.source} -{e.semantic_type}-> {e.target}" for e in env.edges[:RETURNED_SHOWN]],
        "docs": [d.doc_uri for d in env.docs[:RETURNED_SHOWN]],
    }


def primary_metrics(ranked: bool) -> list[str]:
    """Single-hop's primary metrics; unranked, recall@5 gives way to recall over everything returned, and MRR goes."""
    return ["edge_recall_at_k", "answer_mrr"] if ranked else ["edge_recall_at_all"]


def gold_keys() -> dict[tuple[str, str], set[str]]:
    """(type, name) -> the keys of the entity's name and every alias in the merged graph."""
    return {(e["type"], e["name"]): keys(e["name"], *e["aliases"]) for e in graph()["entities"]}


def matchers(ex: dict, entity_keys: dict) -> tuple:
    """Whether a returned node is expected node i, and whether a returned edge is an expected edge."""
    exp_keys = [entity_keys[(n["type"], n["name"])] for n in ex["nodes"]]
    by_name = {n["name"]: exp_keys[i] for i, n in enumerate(ex["nodes"])}

    def node_hit(n: Node, i: int) -> bool:
        return n.type == ex["nodes"][i]["type"] and bool(keys(n.name, *n.aliases) & exp_keys[i])

    def edge_hit(e: Edge, x: dict) -> bool:
        src, tgt = normalize(e.source), normalize(e.target)
        forward = src in by_name[x["source"]] and tgt in by_name[x["target"]]
        backward = x["semantic_type"] in COMPARING and src in by_name[x["target"]] and tgt in by_name[x["source"]]
        return forward or backward

    return node_hit, edge_hit


def missed(row: dict, env: Envelope, entity_keys: dict) -> dict:
    """The expected nodes and edges a query didn't get back: what a reviewer needs to see why a path broke."""
    ex = row["expected"]
    node_hit, edge_hit = matchers(ex, entity_keys)
    return {
        "nodes": [f"{n['name']} ({n['type']})" for i, n in enumerate(ex["nodes"]) if not any(node_hit(m, i) for m in env.nodes)],
        "edges": [f"{x['source']} -{x['semantic_type']}-> {x['target']}" for x in ex["edges"] if not any(edge_hit(e, x) for e in env.edges)],
    }


def query_details(row: dict, env: Envelope | None, metrics: dict, ranked: bool, entity_keys: dict) -> dict:
    """A query in `--details`: its metrics, and when a primary metric fell short, what it got back and what it missed."""
    shown = {"kind": row["kind"], "metrics": metrics}
    if all(metrics.get(p, 1) >= 1 for p in primary_metrics(ranked)):
        return shown
    return {**shown, "query": row["query"], "missed": missed(row, env or Envelope(id=row["id"]), entity_keys), "returned": returned(env)}


def score_row(row: dict, env: Envelope, ranked: bool, entity_keys: dict) -> dict:
    """A single-hop row's metrics (README.md, Scoring, 3. Retrieval), keyed by name."""
    ex = row["expected"]
    node_hit, edge_hit = matchers(ex, entity_keys)
    found = lambda returned: sum(any(edge_hit(e, x) for e in returned) for x in ex["edges"])  # noqa: E731
    m: dict[str, float] = {}
    if ex["edges"]:
        m["edge_recall_at_k" if ranked else "edge_recall_at_all"] = found(env.edges[:K] if ranked else env.edges) / len(ex["edges"])
    answers = [i for i, n in enumerate(ex["nodes"]) if n["role"] == "answer"]
    if answers and ranked:
        rank = next((r for r, n in enumerate(env.nodes, 1) if any(node_hit(n, i) for i in answers)), None)
        m["answer_mrr"] = 1 / rank if rank else 0.0
    if env.edges:
        m["edge_precision"] = sum(any(edge_hit(e, x) for x in ex["edges"]) for e in env.edges) / len(env.edges)
    return m


def summarize(rows: list[dict], scores: dict[str, dict]) -> dict:
    by_metric = defaultdict(list)
    for r in rows:
        for name, value in scores[r["id"]].items():
            by_metric[name].append(value)
    return {name: {k: v for k, v in mean_ci(values).items() if k != "n"} for name, values in sorted(by_metric.items())}


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
    every = [r for r in retrieval_rows() if r["id"] in set(ids)]
    rows = [r for r in every if r["kind"] == SCORED]
    envelopes, outside = {}, 0
    for env in read_predictions(predictions, Envelope):
        if env.id not in set(ids):
            outside += 1
        elif envelopes.setdefault(env.id, env) is not env:
            raise click.ClickException(f"{predictions}: two envelopes for {env.id}")
    entity_keys = gold_keys()
    scores = {r["id"]: score_row(r, envelopes.get(r["id"], Envelope(id=r["id"])), ranked, entity_keys) for r in rows}
    by_kind = {SCORED: {"primary": primary_metrics(ranked), "metrics": summarize(rows, scores)}}
    report = {
        **split_header(split_name),
        "ranked": ranked,
        "rows": {"missing_envelopes": [r["id"] for r in every if r["id"] not in envelopes], "envelopes_outside_held_out": outside},
        "by_kind": by_kind,
        "bootstrap": f"percentile 95%, {BOOTSTRAP_RESAMPLES} resamples, seed {BOOTSTRAP_SEED}",
        "note": f"only {SCORED} is scored, over its {len(rows)} queries; a missing envelope is scored as an empty one",
    }
    if details:
        report["details"] = {r["id"]: query_details(r, envelopes.get(r["id"]), scores[r["id"]], ranked, entity_keys) for r in rows}
    write_report(out_path, report)
    primary = "; ".join(f"{p}={fmt(by_kind[SCORED]['metrics'].get(p, {}).get('mean'))}" for p in primary_metrics(ranked))
    logger.info(f"{len(rows)} {SCORED} queries: {primary} -> {out_path}")


if __name__ == "__main__":
    cli()
