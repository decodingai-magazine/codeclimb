"""Per section, an entities call then a claims call, with the canon injected; then the document's rows.

The canon is the known entities (the gold of every earlier document) the section names, matched by
whole key tokens, up to a cap per type, under one rule: when a thing listed is named, write that
name. The system prompt is the ontology itself (prompts/ontology.md) plus the reply format. A reply
whose envelope has the wrong shape is asked for again once, with the validation error.

A reply cut at max_tokens, or with more rows than `max_rows_per_reply`, is a loop: the model repeats
rows until the limit. Its rows are dropped, never salvaged. When the entities reply loops, the section
is extracted again in two halves, once. When only the claims reply loops, the entities are kept and
the claims are asked for again per half, with the same entity list. A part that loops again is given
up and counted.
"""

import logging
from dataclasses import dataclass
from functools import lru_cache

from pydantic import BaseModel

from ..config import ROOT, Config
from ..contracts import TYPES, ClaimsReply, EntitiesReply, Mention, RawMention, RawRelation, Relation, lenient_rows, parse_reply
from ..graph.keys import tokens
from ..llm import Client
from .chunking import Section, halves
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


@lru_cache(maxsize=1 << 16)
def key_tokens(name: str) -> tuple[str, ...]:
    return tuple(tokens(name))


def named_in(known: list[dict], text: str) -> list[dict]:
    """The known entities `text` names: a name or alias whose key tokens occur there as whole tokens.

    Whole tokens, not substrings: `cli` is not named by "client", nor `uv` by "uvicorn".
    """
    keys = {id(k): [ks for s in [k["name"], *k["aliases"]] if (ks := key_tokens(s))] for k in known}
    longest = max((len(ks) for v in keys.values() for ks in v), default=0)
    words = tokens(text)
    grams = {tuple(words[i : i + n]) for n in range(1, longest + 1) for i in range(len(words) - n + 1)}
    return [k for k in known if any(ks in grams for ks in keys[id(k)])]


def canon(known: list[dict], text: str, per_type: int) -> str:
    """The known entities the section names, per type, up to the cap."""
    named = named_in(known, text)
    lines = []
    for t in TYPES:
        rows = sorted((k for k in named if k["type"] == t), key=lambda k: k["name"])[:per_type]
        if rows:
            lines.append(f"{t}: " + "; ".join(k["name"] + (f" ({', '.join(k['aliases'])})" if k["aliases"] else "") for k in rows))
    if not lines:
        return ""
    return "Known entities, from earlier documents, that this section names. Write these names.\n" + "\n".join(lines) + "\n\n"


def ask_rows[T: BaseModel](
    client: Client, system: str, user: str, envelope: type[BaseModel], key: str, row: type[T], what: str, max_rows: int | None = None
) -> list[T] | None:
    """The rows under `key` of a reply to (system, user): one re-ask when the envelope has the wrong shape.

    None when the reply looped (cut at max_tokens, or over `max_rows` rows): the caller asks smaller.
    """
    reply = client.chat_json(system, user)
    for attempt in range(2):
        if reply is None:
            return []
        if reply.cut:
            log.warning("%s: %s reply cut at max_tokens; dropped", what, key)
            return None
        raw, error = parse_reply(reply.text, envelope, key)
        if error is None or attempt == 1:
            break
        log.info("%s: reply did not match the format (%s); asking again", what, error[:120])
        reply = client.chat_json(system, user + f"\n\nYour previous reply did not match the reply format: {error[:500]}\nReply again, in the format.")
    if max_rows is not None and len(raw) > max_rows:
        log.warning("%s: %d %s rows, over max_rows_per_reply=%d; dropped", what, len(raw), key, max_rows)
        return None
    rows, dropped = lenient_rows(raw, row)
    if dropped:
        log.info("%s: %d rows did not validate", what, dropped)
    return rows


@dataclass
class SectionRows:
    mentions: list[RawMention]
    relations: list[RawRelation]
    splits: int = 0
    """Looping replies answered by extracting the section again in halves."""
    lost: int = 0
    """Parts given up: they looped again after the split."""


def claims(cfg: Config, client: Client, head: str, text: str, mentions: list[RawMention], what: str) -> list[RawRelation] | None:
    """The claims `text` states between the listed entities; None when the reply looped."""
    names = "\n".join(f"- {m.name} ({m.type})" for m in mentions)
    labels = ("Labels in use: " + ", ".join(cfg.extraction.seed_labels) + "\n\n") if cfg.extraction.seed_labels else ""
    user = labels + "Entities in this section:\n" + names + "\n\n" + head + text
    return ask_rows(client, ONTOLOGY + CLAIMS_FORMAT, user, ClaimsReply, "relations", RawRelation, what, cfg.extraction.max_rows_per_reply)


def extract_section(cfg: Config, client: Client, item: dict, section: Section, depth: int = 0) -> SectionRows:
    head = f"Document: {item['title']} ({item['published']})" + (f", section: {section.heading}" if section.heading else "") + "\n\n"
    what = f"{item['doc_uri']} #{section.position}" + (" (half)" if depth else "")
    user = canon(item["known_entities"], section.text, cfg.extraction.canon_per_type) + head + section.text
    mentions = ask_rows(client, ONTOLOGY + ENTITIES_FORMAT, user, EntitiesReply, "mentions", RawMention, what, cfg.extraction.max_rows_per_reply)
    parts = halves(section.text)
    if mentions is None:
        if depth or len(parts) < 2:
            log.warning("%s: entities looped again; part given up", what)
            return SectionRows([], [], lost=1)
        log.info("%s: entities looped; extracting again in %d parts", what, len(parts))
        done = [extract_section(cfg, client, item, Section(section.heading, p, section.position), depth + 1) for p in parts]
        return SectionRows(
            [m for d in done for m in d.mentions], [r for d in done for r in d.relations], 1 + sum(d.splits for d in done), sum(d.lost for d in done)
        )
    relations = claims(cfg, client, head, section.text, mentions, what) if mentions else []
    if relations is not None:
        return SectionRows(mentions, relations)
    if depth or len(parts) < 2:
        log.warning("%s: claims looped again; its claims given up", what)
        return SectionRows(mentions, [], lost=1)
    log.info("%s: claims looped; asking for claims again in %d parts, same entities", what, len(parts))
    per_part = [claims(cfg, client, head, p, mentions, what + " (half)") for p in parts]
    return SectionRows(mentions, [r for p in per_part if p for r in p], splits=1, lost=sum(p is None for p in per_part))


def fold_document(item: dict, raw_mentions: list[RawMention], raw_relations: list[RawRelation]) -> tuple[list[Mention], list[Relation], list[dict]]:
    """The document's rows from every section's: one row per (type, key), claims resolved to them."""
    mentions, rejected = fold_mentions(raw_mentions, item["doc_uri"])
    relations, rejected_relations = fold_relations(raw_relations, mentions, item["doc_uri"])
    return mentions, relations, rejected + rejected_relations
