"""Stage 3: one envelope per query from the gold graph (task.md, 3. Retrieval).

Gold graph -> Ladybug store -> anchors (the entities the query names, by key) -> Cypher per shape
(an anchor's edges; paths and the common neighbour between two anchors; the documents that mention
them) -> ranking and caps -> envelope. No anchor resolves: an empty envelope (abstention).
"""

import json
import logging
import tempfile
from pathlib import Path

from ..config import Config
from .anchors import Anchors
from .rank import envelope
from .store import Store

log = logging.getLogger("graphrag.retrieval")


def run(cfg: Config, items: list[dict], graph_path: Path) -> list[dict]:
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        store = Store(graph, Path(tmp) / "graph.lbug")
        anchors = Anchors(graph["entities"])
        out = []
        for q in items:
            found = anchors.find(q["query"])
            env = envelope(cfg, store, q["id"], found)
            log.info("%s: %d anchors, %d nodes, %d edges, %d docs", q["id"], len(found), len(env.nodes), len(env.edges), len(env.docs))
            out.append(env.model_dump(exclude_none=True))
    return out
