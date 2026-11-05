"""Compile `gold/graph.json` from `gold/log.jsonl`, the log being the only source of truth.

Every surface follows its `same_as` chain to a terminal id, the entity id; entities and relationships are
built on terminal ids only (README.md, Gold data). Edit the log, then re-run:

    uv run python scripts/compile.py
"""

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import click
from loguru import logger

from pulse_normalize import _normalize  # vendored from scrabble's pulse

HERE = Path(__file__).resolve().parent.parent  # the dataset root
PROPERTIES = {  # spec/agent/ontology.md: the keys each type declares
    "organization": ("country",),
    "model": ("country", "released"),
    "tool": ("released",),
    "method": ("released",),
    "person": ("country",),
    "system": (),
}
DOCUMENT_FIELDS = ("source_id", "title", "type", "published", "length", "origin_id", "origin_kind", "author", "domain", "path")


SEPARATORS = set("-_–,():.'’")
"""Characters that only separate words; with whitespace they split the key into tokens."""

SYMBOL_WORDS = {"@": "at", "^": "pow", "+": "plus", "#": "sharp", "/": "slash", "&": "and", "$": "dollar", "*": "star", "×": "by"}
"""Every other symbol carries meaning inside a name, so it becomes a word: `pass@k` and `pass^k` are two
metrics, `C#` is not `C`, `memory/` is not `memory`. A symbol missing here falls back to its Unicode name."""

ACRONYM_PLURAL = re.compile(r"\b([A-Z][A-Z0-9]*[A-Z])s\b")
"""An all-caps stem plus a lowercase `s` is a plural (`APIs`, `CLIs`, `KGs`), whatever its length or ending."""


def _spell(symbol: str) -> str:
    if symbol in SEPARATORS:
        return " "
    return f" {SYMBOL_WORDS.get(symbol) or unicodedata.name(symbol, 'symbol').lower()} "


def normalize(name: str) -> str:
    """The name key (README.md, Identity): acronym plurals folded, symbols spelled out as words,
    then Pulse's `_normalize`, tokens joined by `-`."""
    spelled = re.sub(r"[^\w\s]|_", lambda m: _spell(m.group()), ACRONYM_PLURAL.sub(r"\1", name))
    return "-".join(_normalize(spelled).split())


def relationship_id(kind: str, *parts: str) -> str:
    return f"{kind}:{hashlib.sha1('\x00'.join(parts).encode()).hexdigest()[:16]}"


def terminal_of(rows: list[dict]):
    """Follow `same_as` from a surface id to the entity id it compiles into."""
    same_as = {r["from_id"]: r["to_id"] for r in rows if r["kind"] == "same_as"}

    def terminal(sid: str) -> str:
        seen = set()
        while sid in same_as:
            assert sid not in seen, f"same_as cycle through {sid}"
            seen.add(sid)
            sid = same_as[sid]
        return sid

    return terminal


def check(rows: list[dict]) -> None:
    """The log's own invariants: contiguous `seq`, every row inside a documented document, every
    reference to a logged surface, and one mention row per entity per document."""
    assert [r["seq"] for r in rows] == list(range(len(rows))), "seq is not 0..n-1"
    documents = {r["doc_uri"] for r in rows if r["kind"] == "document"}
    surfaces = {r["surface_id"] for r in rows if r["kind"] == "entity_mention"}
    for r in rows:
        assert (r["kind"] == "same_as" and r["doc_uri"] is None) or r["doc_uri"] in documents, (
            f"seq {r['seq']}: no document row for {r['doc_uri']}"
        )
        ends = {"related_to": ("source_id", "target_id"), "same_as": ("from_id", "to_id")}.get(r["kind"], ())
        assert all(r[k] in surfaces for k in ends), f"seq {r['seq']}: references a surface with no mention row"
    terminal = terminal_of(rows)
    per_doc = Counter((r["doc_uri"], terminal(r["surface_id"])) for r in rows if r["kind"] == "entity_mention")
    repeated = [k for k, n in per_doc.items() if n > 1]
    assert not repeated, f"an entity has two entity_mention rows in one document: {repeated}"


def rows_through(rows: list[dict], uris: set[str]) -> list[dict]:
    """The log as it stood after the documents `uris` (a prefix of its documents): their rows, and every
    `same_as` whose two surfaces both first appear in them."""
    kept = [r for r in rows if r["kind"] != "same_as" and r["doc_uri"] in uris]
    surfaces = {r["surface_id"] for r in kept if r["kind"] == "entity_mention"}
    return kept + [r for r in rows if r["kind"] == "same_as" and r["from_id"] in surfaces and r["to_id"] in surfaces]


def compile_graph(rows: list[dict]) -> dict:
    """The gold graph as a pure function of the log: documents, every entity (no gate), document `mentions` and
    `related_to` relationships, all on terminal ids. A `related_to` row whose two ends compile into one entity is dropped."""
    terminal = terminal_of(rows)
    names = {r["surface_id"]: r["name"] for r in rows if r["kind"] == "entity_mention"}
    grouped: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if r["kind"] == "entity_mention":
            grouped[terminal(r["surface_id"])].append(r)

    def earliest(eid: str, get) -> object:
        for r in sorted(grouped[eid], key=lambda r: (r["observed_at"], r["doc_uri"], r["seq"])):
            if (value := get(r)) is not None:
                return value
        return None

    entities = []
    for eid in sorted(grouped):
        kind = grouped[eid][0]["type"]
        aliases = {s for m in grouped[eid] for s in [m["name"], *m["aliases"]]} - {names[eid]}
        entities.append(
            {
                "id": eid,
                "name": names[eid],
                "type": kind,
                "aliases": sorted(aliases),
                "description": earliest(eid, lambda r: r["description"]),
                "properties": {k: earliest(eid, lambda r, k=k: r["properties"][k]) for k in PROPERTIES[kind]},
                "doc_count": len({r["doc_uri"] for r in grouped[eid]}),
                "mention_count": sum(r["count"] for r in grouped[eid]),
            }
        )

    mentions: dict[tuple[str, str], dict] = {}
    for eid, group in grouped.items():
        for m in group:
            e = mentions.setdefault(
                (m["doc_uri"], eid),
                {
                    "id": relationship_id("mentions", m["doc_uri"], eid),
                    "doc_uri": m["doc_uri"],
                    "entity_id": eid,
                    "count": 0,
                    "confidence": 0.0,
                },
            )
            e["count"] += m["count"]
            e["confidence"] = max(e["confidence"], m["confidence"])

    related: dict[tuple, dict] = {}
    for r in (r for r in rows if r["kind"] == "related_to"):
        src, tgt = terminal(r["source_id"]), terminal(r["target_id"])
        if src == tgt:
            continue
        label = r["semantic_type"]
        e = related.setdefault(
            (r["doc_uri"], src, tgt, label),
            {
                "id": relationship_id("related_to", r["doc_uri"], src, tgt, label),
                "doc_uri": r["doc_uri"],
                "source_id": src,
                "target_id": tgt,
                "semantic_type": label,
                "confidence": 0.0,
            },
        )
        e["confidence"] = max(e["confidence"], r["confidence"])
    return {
        "documents": [{"uri": r["doc_uri"], **{k: r[k] for k in DOCUMENT_FIELDS}} for r in rows if r["kind"] == "document"],
        "entities": entities,
        "relationships": {
            "mentions": sorted(mentions.values(), key=lambda e: (e["doc_uri"], e["entity_id"])),
            "related_to": sorted(related.values(), key=lambda e: (e["doc_uri"], e["source_id"], e["target_id"], e["semantic_type"])),
        },
    }


@click.command()
@click.option("--log", "log_path", type=click.Path(exists=True, dir_okay=False, path_type=Path), default=HERE / "gold" / "log.jsonl")
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), default=HERE / "gold" / "graph.json")
def main(log_path: Path, out_path: Path) -> None:
    rows = [json.loads(line) for line in log_path.read_text(encoding="utf-8").splitlines()]
    check(rows)
    graph = compile_graph(rows)
    holders = defaultdict(set)
    for e in graph["entities"]:
        for n in [e["name"], *e["aliases"]]:
            holders[(e["type"], normalize(n))].add(e["name"])
    shared = {k: v for k, v in holders.items() if len(v) > 1}
    assert not shared, f"a name key sits on two entities of one type: {shared}"
    out_path.write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
    kinds = Counter(r["kind"] if r["kind"] != "same_as" else f"same_as:{r['reason']}" for r in rows)
    logger.info(
        f"rows={dict(kinds)} documents={len(graph['documents'])} entities={len(graph['entities'])} "
        f"mentions={len(graph['relationships']['mentions'])} related_to={len(graph['relationships']['related_to'])} -> {out_path}"
    )


if __name__ == "__main__":
    main()
