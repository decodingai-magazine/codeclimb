"""The gold graph in Ladybug, an embedded graph database queried with Cypher (runtime.md, Ladybug).

Tables: Entity(id, name, type, aliases, description), Document(uri, title, published), MENTIONS
(Document -> Entity, count), RELATED_TO(Entity -> Entity, semantic_type, doc_uri, confidence).
Built in a temporary directory: nothing persists between stages. An `embedding FLOAT[]` column on
Entity is the natural place for name-and-description vectors.
"""

from pathlib import Path

import ladybug as lb

SCHEMA = (
    "CREATE NODE TABLE Entity(id STRING PRIMARY KEY, name STRING, type STRING, aliases STRING[], description STRING)",
    "CREATE NODE TABLE Document(uri STRING PRIMARY KEY, title STRING, published DATE)",
    "CREATE REL TABLE MENTIONS(FROM Document TO Entity, count INT64)",
    "CREATE REL TABLE RELATED_TO(FROM Entity TO Entity, semantic_type STRING, doc_uri STRING, confidence DOUBLE)",
)


class Store:
    def __init__(self, graph: dict, path: Path):
        self.entities = {e["id"]: e for e in graph["entities"]}
        self.documents = {d["uri"]: d for d in graph["documents"]}
        self._edges: dict[frozenset[str], set[tuple[str, str, str]]] = {}
        for r in graph["relationships"]["related_to"]:
            self._edges.setdefault(frozenset((r["source_id"], r["target_id"])), set()).add((r["source_id"], r["target_id"], r["semantic_type"]))
        self.conn = lb.Connection(lb.Database(str(path)))
        for statement in SCHEMA:
            self.conn.execute(statement)
        # One UNWIND per table: about a hundred times faster than a CREATE per row.
        self.conn.execute(
            "UNWIND $rows AS r CREATE (:Entity {id: r.id, name: r.name, type: r.type, aliases: r.aliases, description: r.description})",
            {
                "rows": [
                    {"id": e["id"], "name": e["name"], "type": e["type"], "aliases": list(e["aliases"]), "description": e["description"] or ""}
                    for e in graph["entities"]
                ]
            },
        )
        self.conn.execute(
            "UNWIND $rows AS r CREATE (:Document {uri: r.uri, title: r.title, published: CAST(r.published AS DATE)})",
            {"rows": [{"uri": d["uri"], "title": d["title"], "published": d["published"]} for d in graph["documents"]]},
        )
        self.conn.execute(
            "UNWIND $rows AS r MATCH (d:Document {uri: r.uri}), (e:Entity {id: r.id}) CREATE (d)-[:MENTIONS {count: r.count}]->(e)",
            {"rows": [{"uri": m["doc_uri"], "id": m["entity_id"], "count": int(m["count"] or 0)} for m in graph["relationships"]["mentions"]]},
        )
        self.conn.execute(
            "UNWIND $rows AS r MATCH (a:Entity {id: r.a}), (b:Entity {id: r.b}) "
            "CREATE (a)-[:RELATED_TO {semantic_type: r.semantic_type, doc_uri: r.doc_uri, confidence: r.confidence}]->(b)",
            {
                "rows": [
                    {
                        "a": r["source_id"],
                        "b": r["target_id"],
                        "semantic_type": r["semantic_type"],
                        "doc_uri": r["doc_uri"],
                        "confidence": float(r["confidence"] or 0),
                    }
                    for r in graph["relationships"]["related_to"]
                ]
            },
        )

    def edges_between(self, a: str, b: str) -> list[tuple[str, str, str]]:
        """The directed, labeled edges between two entities, either way round (one per document in the gold, folded)."""
        return sorted(self._edges.get(frozenset((a, b)), ()))

    def query(self, cypher: str, params: dict | None = None) -> list[list]:
        result = self.conn.execute(cypher, params or {})
        rows = []
        while result.has_next():
            rows.append(result.get_next())
        return rows
