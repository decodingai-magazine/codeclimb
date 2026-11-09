"""The rows each stage writes (train.md, Inputs and predictions) and the shapes model replies are read into.

Predictions forbid unknown fields, as the evaluator does: a field not in the table fails the stage.
Model replies use a strict envelope and lenient rows: a whole reply must have exactly the keys asked
for (else it is asked for again, once, with the error), each row keeps what validates and drops the
rest, and a truncated reply is salvaged row by row.
"""

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

TYPES = ("person", "organization", "model", "tool", "method", "system")
EntityType = Literal["person", "organization", "model", "tool", "method", "system"]


class Forbid(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Mention(Forbid):
    kind: Literal["entity_mention"] = "entity_mention"
    doc_uri: str
    name: str
    type: EntityType
    aliases: list[str] = []
    description: str | None = None
    properties: dict[str, Any] | None = None
    count: int | None = None
    confidence: float | None = None


class Relation(Forbid):
    kind: Literal["related_to"] = "related_to"
    doc_uri: str
    source_name: str
    target_name: str
    semantic_type: str | None = None
    source_type: EntityType | None = None
    target_type: EntityType | None = None
    confidence: float | None = None


class Assignment(Forbid):
    surface_id: str
    entity_id: str


class Node(Forbid):
    type: str
    name: str
    aliases: list[str] = []
    score: float | None = None


class Edge(Forbid):
    source: str
    target: str
    semantic_type: str | None = None
    score: float | None = None


class Doc(Forbid):
    doc_uri: str
    score: float | None = None


class Envelope(Forbid):
    id: str
    nodes: list[Node] = []
    edges: list[Edge] = []
    docs: list[Doc] = []
    passage_tokens: int | None = None


# Model replies: the rows the chat model writes, before the filter turns them into predictions.


class Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RawMention(Lenient):
    name: str
    type: str
    aliases: list[str] = []
    description: str | None = None
    properties: dict[str, Any] | None = None
    count: int | None = None
    confidence: float | None = None


class RawRelation(Lenient):
    source: str
    target: str
    semantic_type: str
    confidence: float | None = None


class RawDecision(Lenient):
    name: str
    action: Literal["keep", "drop", "retype"]
    type: str | None = None


class EntitiesReply(Forbid):
    mentions: list[dict[str, Any]]


class ClaimsReply(Forbid):
    relations: list[dict[str, Any]]


class CriticReply(Forbid):
    decisions: list[dict[str, Any]]


def lenient_rows[T: Lenient](rows: list[dict[str, Any]], model: type[T]) -> tuple[list[T], int]:
    """The rows that validate, and how many did not."""
    kept, dropped = [], 0
    for row in rows:
        try:
            kept.append(model.model_validate(row))
        except ValidationError:
            dropped += 1
    return kept, dropped


FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")
ARRAY_START = re.compile(r'"(\w+)"\s*:\s*\[')
BETWEEN_ROWS = re.compile(r"\s*,?\s*")


def parse_reply(text: str, envelope: type[BaseModel], key: str) -> tuple[list[dict[str, Any]], str | None]:
    """The rows under `key`, and the envelope error if the reply parsed but had the wrong shape.

    A whole reply must validate as `envelope` (exactly the keys asked for), else the error comes back
    for a re-ask. A reply cut short (`finish_reason: "length"`) is not JSON: it is read up to its last
    complete row, so the rows before the cut are not lost, and no error is reported.
    """
    text = FENCE.sub("", text)
    try:
        parsed = json.loads(text)
    except ValueError:
        return salvage_rows(text, key), None
    try:
        rows = getattr(envelope.model_validate(parsed), key)
    except ValidationError as e:
        return [], "; ".join(f"{'.'.join(map(str, err['loc'])) or 'reply'}: {err['msg']}" for err in e.errors()[:3])
    return [r for r in rows if isinstance(r, dict)], None


def salvage_rows(text: str, key: str) -> list[dict[str, Any]]:
    decoder = json.JSONDecoder()
    for start in ARRAY_START.finditer(text):
        if start.group(1) != key:
            continue
        pos, rows = start.end(), []
        while True:
            pos = BETWEEN_ROWS.match(text, pos).end()
            if pos >= len(text) or text[pos] != "{":
                break
            try:
                row, pos = decoder.raw_decode(text, pos)
            except ValueError:
                break
            rows.append(row)
        return rows
    return []
