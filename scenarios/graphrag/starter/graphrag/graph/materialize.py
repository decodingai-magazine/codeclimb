"""Run the resolver over the log and write one assignment per surface: history first (its same_as rows
all applied before any held-out row), then every mention in seq order."""

from ..contracts import Assignment
from .resolve import Resolver


def assignments(rows: list[dict]) -> list[Assignment]:
    resolver = Resolver()
    for r in rows:
        if r["kind"] == "same_as":
            resolver.same_as(r["from_id"], r["to_id"])
    seen: dict[str, None] = {}
    for r in sorted((r for r in rows if r["kind"] == "entity_mention"), key=lambda r: r["seq"]):
        seen.setdefault(r["surface_id"], None)
        resolver.resolve(r)  # every row: a later document may add an alias to a known surface
    return [Assignment(surface_id=sid, entity_id=resolver.find(sid)) for sid in seen]
