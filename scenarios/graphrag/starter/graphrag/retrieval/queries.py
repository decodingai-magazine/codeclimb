"""One Cypher template per query shape (task.md, Query kinds). Cypher walks the graph and returns entity
ids; the store's edge index turns consecutive ids back into directed, labeled edges."""

from .store import Store

NEIGHBOURS = """
MATCH (a:Entity)-[:RELATED_TO]-(b:Entity) WHERE a.id = $anchor
RETURN DISTINCT b.id
"""

PATHS_BETWEEN = """
MATCH p = (a:Entity)-[:RELATED_TO* SHORTEST 1..{max_hops}]-(b:Entity) WHERE a.id = $a AND b.id = $b
RETURN nodes(p)
"""

COMMON_NEIGHBOURS = """
MATCH (a:Entity)-[:RELATED_TO]-(x:Entity)-[:RELATED_TO]-(b:Entity) WHERE a.id = $a AND b.id = $b
RETURN DISTINCT x.id
"""

DOCUMENTS_OF = """
MATCH (d:Document)-[m:MENTIONS]->(e:Entity) WHERE e.id = $e
RETURN d.uri, m.count, CAST(d.published AS STRING)
"""


def edges_of(store: Store, anchor: str) -> list[tuple[str, str, str]]:
    """Every directed, labeled edge touching the anchor."""
    out: set[tuple[str, str, str]] = set()
    for (b,) in store.query(NEIGHBOURS, {"anchor": anchor}):
        out.update(store.edges_between(anchor, b))
    return sorted(out)


def paths_between(store: Store, a: str, b: str, max_hops: int) -> list[tuple[list[str], list[tuple[str, str, str]]]]:
    """Shortest paths from a to b, as (node ids, the edges along them)."""
    paths = []
    for (path_nodes,) in store.query(PATHS_BETWEEN.format(max_hops=max_hops), {"a": a, "b": b}):
        nodes = [n["id"] for n in path_nodes]
        edges = [e for x, y in zip(nodes, nodes[1:]) for e in store.edges_between(x, y)]
        paths.append((nodes, edges))
    return paths


def common_neighbours(store: Store, a: str, b: str) -> list[tuple[str, list[tuple[str, str, str]]]]:
    """Nodes adjacent to both anchors, with the edges that join them to each."""
    return [(x, store.edges_between(a, x) + store.edges_between(x, b)) for (x,) in store.query(COMMON_NEIGHBOURS, {"a": a, "b": b})]


def documents_of(store: Store, entity: str) -> list[tuple[str, int, str]]:
    """(doc_uri, mention count, published) of the documents that mention the entity."""
    return [(uri, int(count or 0), published) for uri, count, published in store.query(DOCUMENTS_OF, {"e": entity})]
