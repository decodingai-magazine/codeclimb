"""Seed and check the retrieval gold, `gold/retrieval.jsonl` (README.md, `gold/retrieval.jsonl`).

Two commands, both read `gold/graph.json` and `corpus/`; `check` also compiles the train graph from the log:

    uv run python scripts/retrieval_gold.py seeds --per-kind 4
    uv run python scripts/retrieval_gold.py check

`seeds` samples candidates that pass each kind's filter and prints them with the evidence sentences
a writer needs. `check` validates every row mechanically (names resolve, edges exist, documents
mention their nodes, the query leaks no non-anchor name, each kind's rule holds) and warns when a
`single_hop` or `multi_hop` query with a multi-document anchor hands its answer document to BM25
at rank 1: a writing aid, never stored. A train `multi_hop` query runs on the train graph, so `check`
judges its hops there: a node that is specific in train and two nodes that share no train document
may not be in the full graph. The closed-book gate needs a model with no corpus and is not wired here.
"""

import json
import math
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal

import click
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compile import compile_graph, normalize, rows_through  # noqa: E402  (`normalize`: the dataset's key function)

HERE = Path(__file__).resolve().parent
DATASET = HERE.parent
GRAPH = DATASET / "gold" / "graph.json"
ROWS = DATASET / "gold" / "retrieval.jsonl"

KINDS = ("single_hop", "multi_hop", "aggregation", "comparison", "temporal", "unanswerable")
COMPARING = {"compared_with", "alternative_to"}
MULTI_HOP_MIDDLE_MAX = 3
INTERSECTION_ANSWER_MAX = 5
INTERSECTION_ANCHOR_MAX = 12
AGGREGATION_RANGE = (3, 12)
BM25_TOP = 100


# ----------------------------------------------------------------------------------------------
# Gold graph


class Gold:
    """`graph.json` indexed for the checks: entities by key within type, mentions per entity, `related_to` relationships per pair."""

    def __init__(self, graph: dict):
        self.entities = {e["id"]: e for e in graph["entities"]}
        self.documents = {d["uri"]: d for d in graph["documents"]}
        self.by_key: dict[tuple[str, str], str] = {}
        for e in graph["entities"]:
            for surface in [e["name"], *e["aliases"]]:
                self.by_key.setdefault((e["type"], normalize(surface)), e["id"])
        self.by_name = {(e["type"], e["name"]): e["id"] for e in graph["entities"]}
        self.mentions: dict[str, set[str]] = defaultdict(set)
        for m in graph["relationships"]["mentions"]:
            self.mentions[m["entity_id"]].add(m["doc_uri"])
        self.relationships: dict[tuple[str, str], list[dict]] = defaultdict(list)
        self.adjacent: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
        for r in graph["relationships"]["related_to"]:
            self.relationships[(r["source_id"], r["target_id"])].append(r)
            self.adjacent[r["source_id"]][r["target_id"]].add(r["doc_uri"])
            self.adjacent[r["target_id"]][r["source_id"]].add(r["doc_uri"])

    def resolve(self, entity_type: str, name: str) -> str | None:
        return self.by_key.get((entity_type, normalize(name)))

    def name(self, eid: str) -> str:
        return self.entities[eid]["name"]

    def doc_count(self, eid: str) -> int:
        return self.entities[eid]["doc_count"]

    def year_span(self, eid: str) -> set[str]:
        return {self.documents[u]["published"][:4] for u in self.mentions[eid]}

    def body(self, uri: str) -> str:
        text = (DATASET / self.documents[uri]["path"]).read_text(encoding="utf-8")
        return text[text.index("\n---\n", 4) + 5 :]

    def surfaces(self, eid: str) -> list[str]:
        e = self.entities[eid]
        return [e["name"], *e["aliases"]]


def load_gold(path: Path = GRAPH) -> Gold:
    return Gold(json.loads(path.read_text(encoding="utf-8")))


def load_train_gold() -> Gold:
    """The graph of the train documents, as the agent's bundle has it."""
    log = [json.loads(line) for line in (DATASET / "gold" / "log.jsonl").read_text(encoding="utf-8").splitlines()]
    train = json.loads((DATASET / "gold" / "splits.json").read_text(encoding="utf-8"))["documents"]["train"]
    return Gold(compile_graph(rows_through(log, set(train))))


def names_in(gold: Gold, text: str) -> set[str]:
    """Every gold node whose name or alias key occurs in `text`, as a token run, any type."""
    key = f"-{normalize(text)}-"
    return {eid for (_, k), eid in gold.by_key.items() if k and f"-{k}-" in key}


# ----------------------------------------------------------------------------------------------
# Seeds


def seed_single_hop(gold: Gold) -> list[dict]:
    """An undirected pair claimed in one document; `cheap` when no other document co-mentions its ends."""
    pairs: dict[frozenset, set[str]] = defaultdict(set)
    for (s, t), rows in gold.relationships.items():
        pairs[frozenset((s, t))] |= {r["doc_uri"] for r in rows}
    out = []
    for pair, docs in pairs.items():
        if len(docs) != 1 or len(pair) != 2:
            continue
        s, t = sorted(pair)
        others = (gold.mentions[s] & gold.mentions[t]) - docs
        edge = (gold.relationships.get((s, t)) or gold.relationships.get((t, s)))[0]
        out.append(
            {
                "kind": "single_hop",
                "edge": _edge_view(gold, edge),
                "cheap": not others,
                "co_mentioned_elsewhere": sorted(others),
                "min_doc_count": min(gold.doc_count(s), gold.doc_count(t)),
            }
        )
    return out


def seed_multi_hop(gold: Gold) -> list[dict]:
    """A–B–C with edges from different documents, B specific, A and C sharing no document."""
    out = []
    for b, neighbours in gold.adjacent.items():
        if gold.doc_count(b) > MULTI_HOP_MIDDLE_MAX:
            continue
        items = sorted(neighbours.items())
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (a, da), (c, dc) = items[i], items[j]
                if not (da - dc) or not (dc - da) or (gold.mentions[a] & gold.mentions[c]):
                    continue
                ab = (gold.relationships.get((a, b)) or gold.relationships.get((b, a)))[0]
                bc = (gold.relationships.get((b, c)) or gold.relationships.get((c, b)))[0]
                if ab["doc_uri"] == bc["doc_uri"]:
                    continue
                out.append(
                    {
                        "kind": "multi_hop",
                        "path": [gold.name(a), gold.name(b), gold.name(c)],
                        "edges": [_edge_view(gold, ab), _edge_view(gold, bc)],
                    }
                )
    return out


def seed_aggregation(gold: Gold) -> list[dict]:
    lo, hi = AGGREGATION_RANGE
    return [
        {"kind": "aggregation", "node": _node_view(gold, eid), "docs": sorted(gold.mentions[eid])}
        for eid, e in gold.entities.items()
        if lo <= e["doc_count"] <= hi
    ]


def seed_comparison(gold: Gold) -> list[dict]:
    return [
        {"kind": "comparison", "edge": _edge_view(gold, r)}
        for rows in gold.relationships.values()
        for r in rows
        if r["semantic_type"] in COMPARING and gold.entities[r["source_id"]]["type"] == gold.entities[r["target_id"]]["type"]
    ]


def seed_temporal(gold: Gold) -> list[dict]:
    """A node seen in both years; the proposed window is the year holding fewer of its documents."""
    out = []
    for eid, docs in gold.mentions.items():
        if len(docs) < 3 or not gold.year_span(eid) >= {"2025", "2026"}:
            continue
        by_year = Counter(gold.documents[u]["published"][:4] for u in docs)
        year = min(by_year, key=lambda y: (by_year[y], y))
        inside = sorted(u for u in docs if gold.documents[u]["published"].startswith(year))
        out.append(
            {
                "kind": "temporal",
                "node": _node_view(gold, eid),
                "window": {"from": f"{year}-01", "to": f"{year}-12"},
                "docs_inside": inside,
                "docs_outside": len(docs) - len(inside),
            }
        )
    return out


def seed_three_hop(gold: Gold) -> list[dict]:
    """A–B–C–D with B and C specific, three edges from three documents, no two non-adjacent nodes sharing a document."""
    adj, m = gold.adjacent, gold.mentions
    specific = lambda n: gold.doc_count(n) <= MULTI_HOP_MIDDLE_MAX  # noqa: E731
    out = []
    for b in adj:
        if not specific(b):
            continue
        for c in adj[b]:
            if not specific(c) or c <= b:
                continue
            for a in adj[b]:
                if a == c or m[a] & m[c]:
                    continue
                for d in adj[c]:
                    if d in (a, b) or m[b] & m[d] or m[a] & m[d]:
                        continue
                    ab = (gold.relationships.get((a, b)) or gold.relationships.get((b, a)))[0]
                    bc = (gold.relationships.get((b, c)) or gold.relationships.get((c, b)))[0]
                    cd = (gold.relationships.get((c, d)) or gold.relationships.get((d, c)))[0]
                    if len({ab["doc_uri"], bc["doc_uri"], cd["doc_uri"]}) < 3:
                        continue
                    out.append(
                        {
                            "kind": "multi_hop",
                            "path": [gold.name(a), gold.name(b), gold.name(c), gold.name(d)],
                            "edges": [_edge_view(gold, ab), _edge_view(gold, bc), _edge_view(gold, cd)],
                        }
                    )
    return out


def seed_intersection(gold: Gold) -> list[dict]:
    """Two anchors that share no document, one specific answer adjacent to both through different documents."""
    adj, m = gold.adjacent, gold.mentions
    out = []
    for x in adj:
        if gold.doc_count(x) > INTERSECTION_ANSWER_MAX:
            continue
        near = sorted(a for a in adj[x] if gold.doc_count(a) <= INTERSECTION_ANCHOR_MAX)
        for i in range(len(near)):
            for j in range(i + 1, len(near)):
                a, b = near[i], near[j]
                if m[a] & m[b] or not (adj[x][a] - adj[x][b]) or not (adj[x][b] - adj[x][a]):
                    continue
                ax = (gold.relationships.get((a, x)) or gold.relationships.get((x, a)))[0]
                bx = (gold.relationships.get((b, x)) or gold.relationships.get((x, b)))[0]
                out.append(
                    {
                        "kind": "intersection",
                        "anchors": [gold.name(a), gold.name(b)],
                        "answer": _node_view(gold, x),
                        "edges": [_edge_view(gold, ax), _edge_view(gold, bx)],
                    }
                )
    return out


SEEDERS = {
    "single_hop": seed_single_hop,
    "multi_hop": seed_multi_hop,
    "three_hop": seed_three_hop,
    "intersection": seed_intersection,
    "aggregation": seed_aggregation,
    "comparison": seed_comparison,
    "temporal": seed_temporal,
}


def _node_view(gold: Gold, eid: str) -> dict:
    e = gold.entities[eid]
    return {"type": e["type"], "name": e["name"], "doc_count": e["doc_count"]}


def _edge_view(gold: Gold, r: dict) -> dict:
    return {
        "source": gold.name(r["source_id"]),
        "source_type": gold.entities[r["source_id"]]["type"],
        "semantic_type": r["semantic_type"],
        "target": gold.name(r["target_id"]),
        "target_type": gold.entities[r["target_id"]]["type"],
        "doc_uri": r["doc_uri"],
    }


SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z*\[])")


def evidence(gold: Gold, uri: str, names: list[str], limit: int = 3) -> list[str]:
    """Up to `limit` body sentences of `uri` that contain every surface in `names`, markup stripped."""
    body = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", gold.body(uri))
    body = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", body)
    keys = [normalize(n) for n in names]
    hits = []
    for sentence in SENTENCE.split(re.sub(r"\s+", " ", body)):
        key = f"-{normalize(sentence)}-"
        if all(f"-{k}-" in key for k in keys):
            hits.append(sentence.strip()[:300])
            if len(hits) == limit:
                break
    return hits


# ----------------------------------------------------------------------------------------------
# Rows


Role = Literal["anchor", "bridge", "answer"]


class ExpectedNode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    name: str
    role: Role


class ExpectedEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: str
    target: str
    semantic_type: str
    doc_uri: str


class ExpectedDoc(BaseModel):
    model_config = ConfigDict(extra="forbid")
    doc_uri: str
    role: Role


class Expected(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nodes: list[ExpectedNode] = []
    edges: list[ExpectedEdge] = []
    docs: list[ExpectedDoc] = []


class Window(BaseModel):
    model_config = ConfigDict(extra="forbid")
    from_: str = Field(alias="from", pattern=r"^\d{4}(-\d{2})?$")
    to: str = Field(pattern=r"^\d{4}(-\d{2})?$")


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: str
    kind: Literal["single_hop", "multi_hop", "intersection", "aggregation", "comparison", "temporal", "unanswerable"]
    origin: Literal["graph", "text"]
    difficulty: Literal["easy", "medium", "hard"]
    query: str
    expected: Expected
    window: Window | None = None
    why: str


def read_rows(path: Path = ROWS) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ----------------------------------------------------------------------------------------------
# Checks


def in_window(published: str, window: Window) -> bool:
    return window.from_ <= published[: len(window.from_)] and published[: len(window.to)] <= window.to


def hops_of(ex: Expected) -> int:
    """Shortest walk over the expected edges from an anchor to an answer, 0 when there is none."""
    adj: dict[str, set[str]] = {}
    for e in ex.edges:
        adj.setdefault(e.source, set()).add(e.target)
        adj.setdefault(e.target, set()).add(e.source)
    answers = {n.name for n in ex.nodes if n.role == "answer"}
    frontier = {n.name for n in ex.nodes if n.role == "anchor"}
    seen = set(frontier)
    for depth in range(1, len(ex.nodes) + 1):
        frontier = {m for n in frontier for m in adj.get(n, ()) if m not in seen}
        if not frontier:
            return 0
        if frontier & answers:
            return depth
        seen |= frontier
    return 0


def difficulty_of(row: Row) -> str:
    """README.md: easy when one document holds everything, hard for a three-hop walk or an intersection, medium otherwise."""
    if row.kind == "intersection" or hops_of(row.expected) >= 3:
        return "hard"
    return "easy" if len(row.expected.docs) == 1 else "medium"


def check_row(gold: Gold, row: Row) -> list[str]:
    """Every failure of one row, as sentences. Empty means the row passes."""
    fails: list[str] = []
    ex = row.expected
    if row.difficulty != difficulty_of(row):
        fails.append(f"difficulty is {row.difficulty}, the rule says {difficulty_of(row)}")
    resolved: dict[str, str] = {}  # expected node name -> gold id
    for n in ex.nodes:
        eid = gold.by_name.get((n.type, n.name))
        if eid is None:
            hit = gold.resolve(n.type, n.name)
            fails.append(
                f"node {n.type} {n.name!r} "
                + (f"is an alias; use the canonical name {gold.name(hit)!r}" if hit else "resolves to no gold node")
            )
            continue
        resolved[n.name] = eid
    roles = Counter(n.role for n in ex.nodes)
    anchors = [n for n in ex.nodes if n.role == "anchor"]
    answers = [n for n in ex.nodes if n.role == "answer"]

    edge_docs: set[str] = set()
    for e in ex.edges:
        s, t = resolved.get(e.source), resolved.get(e.target)
        if s is None or t is None:
            fails.append(f"edge {e.source} -> {e.target}: an end is not an expected node")
            continue
        rows = gold.relationships.get((s, t), [])
        if e.semantic_type in COMPARING:
            rows = rows + gold.relationships.get((t, s), [])
        match = [r for r in rows if r["semantic_type"] == e.semantic_type]
        if not match:
            fails.append(
                f"edge {e.source} {e.semantic_type} {e.target}: not in graph.json"
                + (" in that direction" if gold.relationships.get((t, s)) else "")
            )
        elif e.doc_uri not in {r["doc_uri"] for r in match}:
            fails.append(f"edge {e.source} {e.semantic_type} {e.target}: not asserted by {e.doc_uri}")
        edge_docs.add(e.doc_uri)

    doc_uris = [d.doc_uri for d in ex.docs]
    if len(set(doc_uris)) != len(doc_uris):
        fails.append("docs repeat a doc_uri")
    for d in ex.docs:
        if d.doc_uri not in gold.documents:
            fails.append(f"doc {d.doc_uri}: not in graph.json")
            continue
        holders = [n for n in ex.nodes if n.name in resolved and d.doc_uri in gold.mentions[resolved[n.name]]]
        if not holders:
            fails.append(f"doc {d.doc_uri}: mentions no expected node")
        elif roles["bridge"] + roles["answer"] and all(n.role == "anchor" for n in holders):
            fails.append(f"doc {d.doc_uri}: mentions only anchors")
    for uri in sorted(edge_docs - set(doc_uris)):
        fails.append(f"doc {uri}: asserts an expected edge but is not in docs")

    # the query names every anchor and no other expected node
    qkey = f"-{normalize(row.query)}-"
    for n in ex.nodes:
        if n.name not in resolved:
            continue
        named = any(f"-{normalize(s)}-" in qkey for s in gold.surfaces(resolved[n.name]) if normalize(s))
        if n.role == "anchor" and not named:
            fails.append(f"query does not name anchor {n.name!r}")
        if n.role != "anchor" and named:
            fails.append(f"query names {n.role} node {n.name!r}: leaks the expected set")

    kind = row.kind
    if kind == "unanswerable":
        if ex.nodes or ex.edges or ex.docs:
            fails.append("unanswerable row has a non-empty expected")
        leaked = sorted(gold.name(eid) for eid in names_in(gold, row.query))
        if leaked:
            fails.append(f"unanswerable query names gold nodes: {leaked}")
        return fails
    if not anchors:
        fails.append("no anchor node")
    if kind in ("single_hop", "multi_hop", "intersection", "comparison") and not ex.edges:
        fails.append(f"{kind} row has no expected edge")
    if kind in ("single_hop", "multi_hop", "intersection") and not answers:
        fails.append(f"{kind} row has no answer node")
    if kind == "multi_hop":
        if len({e.doc_uri for e in ex.edges}) < 2:
            fails.append("multi_hop edges come from one document")
        touched = Counter(n for e in ex.edges for n in (e.source, e.target))
        chained = all(touched[n.name] >= 2 for n in ex.nodes if n.role == "bridge") and all(
            touched[n.name] >= 1 for n in ex.nodes if n.role != "bridge"
        )
        if not chained:
            fails.append("multi_hop edges do not chain anchor to bridge to answer")
        for n in ex.nodes:
            if n.role == "bridge" and n.name in resolved and gold.doc_count(resolved[n.name]) > MULTI_HOP_MIDDLE_MAX:
                fails.append(f"bridge {n.name!r} has doc_count {gold.doc_count(resolved[n.name])} > {MULTI_HOP_MIDDLE_MAX}")
        for a in anchors:
            for z in answers:
                if a.name in resolved and z.name in resolved and gold.mentions[resolved[a.name]] & gold.mentions[resolved[z.name]]:
                    fails.append(f"anchor {a.name!r} and answer {z.name!r} share a document: one chunk answers it")
        if hops_of(ex) >= 3:  # a chain: no shortcut between non-adjacent nodes, and one document per edge
            joined = {frozenset((e.source, e.target)) for e in ex.edges}
            named = [n for n in ex.nodes if n.name in resolved]
            for i in range(len(named)):
                for j in range(i + 1, len(named)):
                    p, q = named[i], named[j]
                    if frozenset((p.name, q.name)) not in joined and gold.mentions[resolved[p.name]] & gold.mentions[resolved[q.name]]:
                        fails.append(f"{p.name!r} and {q.name!r} are not adjacent on the chain but share a document")
            if len({e.doc_uri for e in ex.edges}) != len(ex.edges):
                fails.append("a chain's edges must each come from a different document")
    if kind == "intersection":
        if len(anchors) != 2 or roles["bridge"] or roles["answer"] != 1:
            fails.append("intersection expects exactly two anchors, one answer and no bridge")
        elif (
            all(a.name in resolved for a in anchors) and gold.mentions[resolved[anchors[0].name]] & gold.mentions[resolved[anchors[1].name]]
        ):
            fails.append("intersection anchors share a document")
        for a in anchors:
            if a.name in resolved and gold.doc_count(resolved[a.name]) > INTERSECTION_ANCHOR_MAX:
                fails.append(f"anchor {a.name!r} has doc_count {gold.doc_count(resolved[a.name])} > {INTERSECTION_ANCHOR_MAX}")
        for z in answers:
            if z.name not in resolved:
                continue
            if gold.doc_count(resolved[z.name]) > INTERSECTION_ANSWER_MAX:
                fails.append(f"answer {z.name!r} has doc_count {gold.doc_count(resolved[z.name])} > {INTERSECTION_ANSWER_MAX}")
            docs_by_anchor = {a.name: {e.doc_uri for e in ex.edges if {e.source, e.target} == {a.name, z.name}} for a in anchors}
            if not all(docs_by_anchor.values()):
                fails.append(f"answer {z.name!r} lacks an edge to each anchor")
            elif not any(x != y for x in docs_by_anchor[anchors[0].name] for y in docs_by_anchor[anchors[1].name]):
                fails.append(f"answer {z.name!r} reaches both anchors through one document")
    if kind == "comparison":
        if len(anchors) != 2 or roles["bridge"] or roles["answer"]:
            fails.append("comparison expects exactly two anchors and nothing else")
        elif len({n.type for n in anchors}) != 1:
            fails.append("comparison anchors differ in type")
        if not any(e.semantic_type in COMPARING for e in ex.edges):
            fails.append("comparison row has no comparing edge")
    if kind in ("aggregation", "temporal"):
        if len(ex.nodes) != 1 or anchors != ex.nodes:
            fails.append(f"{kind} expects exactly one node, the anchor")
        elif ex.nodes[0].name in resolved:
            eid = resolved[ex.nodes[0].name]
            full = gold.mentions[eid]
            if kind == "aggregation":
                lo, hi = AGGREGATION_RANGE
                if not lo <= len(full) <= hi:
                    fails.append(f"anchor doc_count {len(full)} outside {lo}..{hi}")
                want = full
            else:
                if row.window is None:
                    fails.append("temporal row has no window")
                    want = full
                else:
                    want = {u for u in full if in_window(gold.documents[u]["published"], row.window)}
                    if want == full or not want:
                        fails.append("window must leave some of the node's documents out and keep some in")
            if set(doc_uris) != want:
                fails.append(
                    f"docs differ from the mentions set: missing {sorted(want - set(doc_uris))}, extra {sorted(set(doc_uris) - want)}"
                )
            if any(d.role != "answer" for d in ex.docs):
                fails.append(f"{kind} docs must all be role answer")
    elif row.window is not None:
        fails.append("window is only for temporal rows")
    return fails


# ----------------------------------------------------------------------------------------------
# BM25 over corpus chunks


TOKEN = re.compile(r"\w+")


def chunks(gold: Gold, min_words: int = 120) -> list[tuple[str, list[str]]]:
    """Paragraphs of every body, merged forward until `min_words`, as (doc_uri, tokens)."""
    out = []
    for uri in gold.documents:
        buf: list[str] = []
        for para in gold.body(uri).split("\n\n"):
            buf += TOKEN.findall(para.lower())
            if len(buf) >= min_words:
                out.append((uri, buf))
                buf = []
        if buf:
            out.append((uri, buf))
    return out


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.tf = [Counter(d) for d in docs]
        self.len = [len(d) for d in docs]
        self.avg = sum(self.len) / len(docs)
        df: Counter[str] = Counter()
        for d in docs:
            df.update(set(d))
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    def rank(self, query: list[str]) -> list[int]:
        scores = []
        for i, tf in enumerate(self.tf):
            s = 0.0
            for t in query:
                if t in tf:
                    f = tf[t]
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
            scores.append(s)
        return sorted(range(len(scores)), key=lambda i: -scores[i])


def bm25_rank(index: BM25, corpus: list[tuple[str, list[str]]], row: Row) -> int | None:
    """Rank of the first answer-role document among the ranked chunks, deduplicated to documents."""
    targets = {d.doc_uri for d in row.expected.docs if d.role == "answer"}
    if not targets:
        return None
    seen: list[str] = []
    for i in index.rank(TOKEN.findall(row.query.lower())):
        uri = corpus[i][0]
        if uri not in seen:
            seen.append(uri)
            if uri in targets:
                return len(seen)
            if len(seen) >= BM25_TOP:
                break
    return None


# ----------------------------------------------------------------------------------------------
# CLI


@click.group()
def cli() -> None:
    """Seed and check dataset/gold/retrieval.jsonl."""


@cli.command()
@click.option("--per-kind", type=int, default=4, show_default=True, help="Seeds to sample per seeded kind.")
@click.option("--seed", "rng_seed", type=int, default=0, show_default=True)
@click.option("--kind", "only", type=click.Choice(list(SEEDERS)), default=None, help="One kind only.")
@click.option("--out", type=click.Path(dir_okay=False, path_type=Path), default=None, help="Write the sample as JSON.")
@click.option(
    "--graph",
    "graph_path",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    default=GRAPH,
    help="Seed from this graph, e.g. the train graph of an agent export; `check` always reads gold/graph.json.",
)
def seeds(per_kind: int, rng_seed: int, only: str | None, out: Path | None, graph_path: Path) -> None:
    """Sample filter-compliant seeds per kind, with evidence sentences, and report the supply."""
    gold = load_gold(graph_path)
    rng = random.Random(rng_seed)
    sample: list[dict] = []
    for kind, seeder in SEEDERS.items():
        if only and kind != only:
            continue
        pool = seeder(gold)
        if kind == "single_hop":  # half cheap, half needing step 4 on their co-mention documents
            cheap = [s for s in pool if s["cheap"]]
            costly = [s for s in pool if not s["cheap"]]
            logger.info(f"{kind}: supply={len(pool)} cheap={len(cheap)}")
            picked = rng.sample(cheap, min(per_kind - per_kind // 2, len(cheap))) + rng.sample(costly, min(per_kind // 2, len(costly)))
        else:
            logger.info(f"{kind}: supply={len(pool)}")
            picked = rng.sample(pool, min(per_kind, len(pool)))
        for s in picked:
            if kind == "single_hop" or kind == "comparison":
                e = s["edge"]
                s["evidence"] = evidence(gold, e["doc_uri"], [e["source"], e["target"]])
            elif "edges" in s:
                s["evidence"] = [evidence(gold, e["doc_uri"], [e["source"], e["target"]]) for e in s["edges"]]
            elif kind == "temporal":
                s["evidence"] = {u: evidence(gold, u, [s["node"]["name"]], limit=1) for u in s["docs_inside"]}
            else:
                s["evidence"] = {u: evidence(gold, u, [s["node"]["name"]], limit=1) for u in s["docs"]}
            sample.append(s)
    text = json.dumps(sample, ensure_ascii=False, indent=1)
    if out:
        out.write_text(text, encoding="utf-8")
        logger.info(f"wrote {len(sample)} seeds to {out}")
    else:
        click.echo(text)


@cli.command()
@click.option(
    "--rows", "rows_path", type=click.Path(dir_okay=False, path_type=Path), default=ROWS, show_default=True, help="A rows file to validate."
)
def check(rows_path: Path) -> None:
    """Validate every row of a retrieval rows file; exit 1 on any failure. BM25 rank 1 is a warning."""
    gold = load_gold()
    train_gold = load_train_gold()
    raw = read_rows(rows_path)
    if not raw:
        raise click.ClickException(f"{rows_path} is empty or missing")
    rows: list[Row | None] = []
    failures = 0
    ids: Counter[str] = Counter(r.get("id", "?") for r in raw)
    for r in raw:
        try:
            rows.append(Row.model_validate(r))
        except ValidationError as exc:
            rows.append(None)
            failures += 1
            logger.error(f"{r.get('id', '?')}: schema: {exc.errors()[0]['msg']} at {'.'.join(map(str, exc.errors()[0]['loc']))}")
    for rid, n in ids.items():
        if n > 1:
            failures += 1
            logger.error(f"{rid}: id used {n} times")
    corpus = chunks(gold)
    index = BM25([t for _, t in corpus])
    warnings = 0
    for row in rows:
        if row is None:
            continue
        fails = check_row(train_gold if row.id.startswith("tr-") and row.kind == "multi_hop" else gold, row)
        if fails:
            failures += 1
            logger.error(f"{row.id} ({row.kind}): " + " | ".join(fails))
            continue
        rank = bm25_rank(index, corpus, row)
        anchor_ids = [eid for n in row.expected.nodes if n.role == "anchor" and (eid := gold.by_name.get((n.type, n.name)))]
        anchor_docs = set.union(*(gold.mentions[eid] for eid in anchor_ids)) if anchor_ids else set()
        expected_docs = {d.doc_uri for d in row.expected.docs}
        # the warning means nothing when an anchor pins its one document, or when every anchor document is an answer
        gated = (
            row.kind in ("single_hop", "multi_hop")
            and all(gold.doc_count(eid) > 1 for eid in anchor_ids)
            and not anchor_docs <= expected_docs
        )
        if gated and rank == 1:
            warnings += 1
            logger.warning(
                f"{row.id} ({row.kind}): BM25 puts the answer document at rank 1; reword unless one document dominates the anchor"
            )
        else:
            logger.info(f"{row.id} ({row.kind}): ok, bm25 rank {rank}")
    by_kind = Counter(row.kind for row in rows if row)
    logger.info(f"rows={len(raw)} by kind={dict(by_kind)} failing={failures} bm25 warnings={warnings}")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    cli()
