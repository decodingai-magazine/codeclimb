"""The envelope: what the anchors' neighbourhood says about the query, ranked and capped.

Edges touching two anchors first, then path and common-neighbour edges, then an anchor's other
edges; nodes likewise; documents by how many anchors they mention and how often. BM25 over edge
sentences and passages, embeddings, and the reranker on the top candidates are the next steps; the
shapes here are what they would reorder.
"""

from itertools import combinations

from ..config import Config
from ..contracts import Doc, Edge, Envelope, Node
from .queries import common_neighbours, documents_of, edges_of, paths_between
from .store import Store

EdgeKey = tuple[str, str, str]


def envelope(cfg: Config, store: Store, query_id: str, anchors: list[str]) -> Envelope:
    if not anchors:
        return Envelope(id=query_id)
    edge_score: dict[EdgeKey, float] = {}
    node_score: dict[str, float] = {a: 1.0 for a in anchors}

    def add_edge(edge: EdgeKey, score: float) -> None:
        edge_score[edge] = max(edge_score.get(edge, 0.0), score)
        for end in edge[:2]:
            node_score[end] = max(node_score.get(end, 0.0), score if end not in anchors else 1.0)

    anchor_set = set(anchors)
    for a in anchors:
        for edge in edges_of(store, a):
            add_edge(edge, 0.9 if edge[0] in anchor_set and edge[1] in anchor_set else 0.5)
    for a, b in combinations(anchors, 2):
        for x, edges in common_neighbours(store, a, b):
            node_score[x] = max(node_score.get(x, 0.0), 0.95)
            for edge in edges:
                add_edge(edge, 0.8)
        for nodes, edges in paths_between(store, a, b, cfg.retrieval.max_hops):
            for n in nodes:
                node_score[n] = max(node_score.get(n, 0.0), 0.7)
            for edge in edges:
                add_edge(edge, 0.7)
    doc_score: dict[str, float] = {}
    for a in anchors:
        for uri, count, _ in documents_of(store, a):
            doc_score[uri] = doc_score.get(uri, 0.0) + 1.0 + min(count, 10) / 100
    ranked_edges = sorted(edge_score.items(), key=lambda kv: (-kv[1], kv[0]))[: cfg.retrieval.max_edges]
    ranked_nodes = sorted(node_score.items(), key=lambda kv: (-kv[1], kv[0]))[: cfg.retrieval.max_nodes]
    ranked_docs = sorted(doc_score.items(), key=lambda kv: (-kv[1], kv[0]))[: cfg.retrieval.max_docs]
    name = lambda eid: store.entities[eid]["name"]  # noqa: E731
    return Envelope(
        id=query_id,
        nodes=[Node(type=store.entities[n]["type"], name=name(n), aliases=list(store.entities[n]["aliases"]), score=round(s, 3)) for n, s in ranked_nodes],
        edges=[Edge(source=name(s), target=name(t), semantic_type=label, score=round(score, 3)) for (s, t, label), score in ranked_edges],
        docs=[Doc(doc_uri=uri, score=round(s, 3)) for uri, s in ranked_docs],
    )
