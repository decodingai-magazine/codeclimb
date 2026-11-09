"""An optional second pass (config `extraction.critic`): the document's rows back to the chat model, which
keeps, drops or retypes each one by the ontology's rules. Targets the recurring false positives: agent
roles, code identifiers, files, list-only names, generic process words. A dropped mention takes its
claims along; a retyped one keeps them.
"""

from pathlib import Path

from ..config import Config
from ..contracts import TYPES, CriticReply, Mention, RawDecision, Relation
from ..llm import Client
from .chunking import body
from .extract import ONTOLOGY, ask_rows

CRITIC_FORMAT = f"""
# Reply format

The request lists the entities extracted from the article, then the article. For each listed entity
decide by the rules above: keep it, drop it (not an entity of this ontology, or the article does not
engage with it), or retype it. Return one JSON object:
{{"decisions": [{{"name": "...", "action": "keep" | "drop" | "retype", "type": "..."}}]}}, `type` one of
{", ".join(TYPES)} and only for retype. Every listed name gets one decision.
"""


def critique(
    cfg: Config, client: Client, root: Path, item: dict, mentions: list[Mention], relations: list[Relation]
) -> tuple[list[Mention], list[Relation], list[dict]]:
    listing = "\n".join(f"- {m.name} ({m.type})" for m in mentions)
    text = body((root / item["path"]).read_text(encoding="utf-8"))
    decisions = ask_rows(
        client, ONTOLOGY + CRITIC_FORMAT, "Entities:\n" + listing + "\n\nArticle:\n" + text, CriticReply, "decisions", RawDecision, f"{item['doc_uri']} critic"
    )
    if not decisions:
        return mentions, relations, []
    by_name = {d.name.strip().lower(): d for d in decisions}
    kept, rejects = [], []
    for m in mentions:
        d = by_name.get(m.name.lower())
        if d is None or d.action == "keep":
            kept.append(m)
        elif d.action == "drop":
            rejects.append({"doc_uri": item["doc_uri"], "reason": "critic_drop", "row": m.model_dump(exclude_none=True)})
        elif d.type in TYPES:
            kept.append(m.model_copy(update={"type": d.type}))
        else:
            kept.append(m)
    names = {m.name: m.type for m in kept}
    relations = [
        r.model_copy(update={"source_type": names[r.source_name], "target_type": names[r.target_name]})
        for r in relations
        if r.source_name in names and r.target_name in names
    ]
    return kept, relations, rejects
