"""Per section, an entities call then a claims call, with the canon injected; then the document's rows.

The canon is the known entities (the gold of every earlier document) the section names, first, then
the rest up to a cap per type, under one rule: when a thing listed is named, write that name. The
system prompt is the ontology itself (prompts/ontology.md) plus the reply format. A reply whose
envelope has the wrong shape is asked for again once, with the validation error; a reply cut short
is salvaged row by row.
"""

import logging

from pydantic import BaseModel

from ..config import ROOT, Config
from ..contracts import TYPES, ClaimsReply, EntitiesReply, Mention, RawMention, RawRelation, Relation, lenient_rows, parse_reply
from ..llm import Client
from .chunking import Section
from .filter import fold_mentions, fold_relations

log = logging.getLogger("graphrag.extract")

ONTOLOGY = (ROOT / "graphrag" / "prompts" / "ontology.md").read_text(encoding="utf-8")

ENTITIES_FORMAT = f"""
# Reply format

Return one JSON object: {{"mentions": [{{"name": "...", "type": "...", "aliases": [], "description": "...",
"properties": {{}}, "count": 1, "confidence": 0.9}}]}}. One row per entity this section engages with, by the
rules above; `type` is one of {", ".join(TYPES)}. `count` is how often the section names it. When a known
entity listed in the request is named, write its name as `name` and the section's own wording as an
alias if it differs. Named once is enough: there is no frequency floor.
"""

CLAIMS_FORMAT = """
# Reply format

Return one JSON object: {"relations": [{"source": "...", "target": "...", "semantic_type": "...", "confidence": 0.9}]}.
One row per claim this section states between two of the entities listed in the request, in the
direction the claim reads (component part_of whole, instance instance_of class, organization develops
product, tool used_for method, method applied_to system). `source` and `target` are names from the list.
`semantic_type` is a snake_case label: reuse one of the labels listed when it fits, coin one otherwise.
"""


def canon(known: list[dict], text: str, per_type: int) -> str:
    """The known entities per type: those the section names first, then the rest, up to the cap."""
    lower = text.lower()
    lines = []
    for t in TYPES:
        rows = [k for k in known if k["type"] == t]
        named = [k for k in rows if any(s.lower() in lower for s in [k["name"], *k["aliases"]])]
        rest = [k for k in rows if k not in named]
        chosen = sorted(named, key=lambda k: k["name"]) + sorted(rest, key=lambda k: k["name"])
        if chosen[:per_type]:
            lines.append(f"{t}: " + "; ".join(k["name"] + (f" ({', '.join(k['aliases'])})" if k["aliases"] else "") for k in chosen[:per_type]))
    if not lines:
        return ""
    return "Known entities, from earlier documents. If one of them is named here, write that name.\n" + "\n".join(lines) + "\n\n"


def ask_rows[T: BaseModel](client: Client, system: str, user: str, envelope: type[BaseModel], key: str, row: type[T], what: str) -> list[T]:
    """The rows under `key` of a reply to (system, user): one re-ask when the envelope has the wrong shape."""
    reply = client.chat_json(system, user)
    if reply is None:
        return []
    raw, error = parse_reply(reply, envelope, key)
    if error is not None:
        log.info("%s: reply did not match the format (%s); asking again", what, error[:120])
        reply = client.chat_json(system, user + f"\n\nYour previous reply did not match the reply format: {error[:500]}\nReply again, in the format.")
        raw, error = parse_reply(reply or "", envelope, key)
    rows, dropped = lenient_rows(raw, row)
    if dropped:
        log.info("%s: %d rows did not validate", what, dropped)
    return rows


def extract_section(cfg: Config, client: Client, item: dict, section: Section) -> tuple[list[RawMention], list[RawRelation]]:
    head = f"Document: {item['title']} ({item['published']})" + (f", section: {section.heading}" if section.heading else "") + "\n\n"
    what = f"{item['doc_uri']} #{section.position}"
    user = canon(item["known_entities"], section.text, cfg.extraction.canon_per_type) + head + section.text
    mentions = ask_rows(client, ONTOLOGY + ENTITIES_FORMAT, user, EntitiesReply, "mentions", RawMention, what)
    if not mentions:
        return [], []
    names = "\n".join(f"- {m.name} ({m.type})" for m in mentions)
    labels = ("Labels in use: " + ", ".join(cfg.extraction.seed_labels) + "\n\n") if cfg.extraction.seed_labels else ""
    user = labels + "Entities in this section:\n" + names + "\n\n" + head + section.text
    relations = ask_rows(client, ONTOLOGY + CLAIMS_FORMAT, user, ClaimsReply, "relations", RawRelation, what)
    return mentions, relations


def fold_document(item: dict, raw_mentions: list[RawMention], raw_relations: list[RawRelation]) -> tuple[list[Mention], list[Relation], list[dict]]:
    """The document's rows from every section's: one row per (type, key), claims resolved to them."""
    mentions, rejected = fold_mentions(raw_mentions, item["doc_uri"])
    relations, rejected_relations = fold_relations(raw_relations, mentions, item["doc_uri"])
    return mentions, relations, rejected + rejected_relations
