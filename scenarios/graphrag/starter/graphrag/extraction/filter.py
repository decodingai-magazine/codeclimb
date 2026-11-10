"""The deterministic filter: closed rejection reasons, the fold into one row per (type, key) per document,
and the endpoint check on claims. No count floor: a row named once is a row.

Reasons: `unknown_type` (not one of the six), `blank_name` (no key), `type_conflict` (the key already
has a row of another type in this document; folded into it as an alias), `endpoint_not_mentioned` (a
claim's end is no mention of the document), `self_loop` (both ends one mention), `duplicate_claim`, and
`critic_drop` (the optional critic dropped the mention, extraction/critic.py).
"""

from ..contracts import TYPES, Mention, RawMention, RawRelation, Relation
from ..graph.keys import normalize

REASONS = ("unknown_type", "blank_name", "type_conflict", "endpoint_not_mentioned", "self_loop", "duplicate_claim", "critic_drop")


def rejected(doc_uri: str, reason: str, row: RawMention | RawRelation | Mention) -> dict:
    assert reason in REASONS
    return {"doc_uri": doc_uri, "reason": reason, "row": row.model_dump(exclude_none=True)}


def label(semantic_type: str) -> str:
    return "_".join(semantic_type.strip().lower().replace("-", " ").split())


def fold_mentions(raw: list[RawMention], doc_uri: str) -> tuple[list[Mention], list[dict]]:
    by_key: dict[str, Mention] = {}
    rejects = []
    for row in raw:
        t = row.type.strip().lower()
        key = normalize(row.name)
        if t not in TYPES:
            rejects.append(rejected(doc_uri, "unknown_type", row))
            continue
        if not key:
            rejects.append(rejected(doc_uri, "blank_name", row))
            continue
        aliases = [a for a in row.aliases if a.strip() and normalize(a) and normalize(a) != key]
        found = by_key.get(key)
        if found is None:
            by_key[key] = Mention(
                doc_uri=doc_uri,
                name=row.name.strip(),
                type=t,
                aliases=sorted(set(aliases)),
                description=row.description,
                properties=row.properties,
                count=row.count or 1,
                confidence=row.confidence,
            )
            continue
        if found.type != t:
            rejects.append(rejected(doc_uri, "type_conflict", row))
        merged = set(found.aliases) | set(aliases)
        if row.name.strip() != found.name:
            merged.add(row.name.strip())
        found.aliases = sorted(merged)
        found.count = (found.count or 0) + (row.count or 1)
        found.description = found.description or row.description
        found.properties = found.properties or row.properties
        found.confidence = max(found.confidence or 0, row.confidence or 0) or None
    return list(by_key.values()), rejects


def fold_relations(raw: list[RawRelation], mentions: list[Mention], doc_uri: str) -> tuple[list[Relation], list[dict]]:
    by_key: dict[str, Mention] = {}
    for m in mentions:  # names first: a name owns its key before any other row's alias can claim it
        by_key.setdefault(normalize(m.name), m)
    for m in mentions:
        for alias in m.aliases:
            by_key.setdefault(normalize(alias), m)
    seen: set[tuple[str, str, str]] = set()
    out, rejects = [], []
    for row in raw:
        a, b = by_key.get(normalize(row.source)), by_key.get(normalize(row.target))
        if a is None or b is None:
            rejects.append(rejected(doc_uri, "endpoint_not_mentioned", row))
            continue
        if a is b:
            rejects.append(rejected(doc_uri, "self_loop", row))
            continue
        lab = label(row.semantic_type)
        if (a.name, b.name, lab) in seen:
            rejects.append(rejected(doc_uri, "duplicate_claim", row))
            continue
        seen.add((a.name, b.name, lab))
        out.append(
            Relation(
                doc_uri=doc_uri, source_name=a.name, target_name=b.name, semantic_type=lab, source_type=a.type, target_type=b.type, confidence=row.confidence
            )
        )
    return out, rejects
