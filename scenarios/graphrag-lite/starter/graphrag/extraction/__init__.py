"""Stage 1: a document's entity_mention and related_to rows (task.md, 1. Extraction).

Document -> body without frontmatter -> sections at headings, size-bounded -> per section an
entities call, then a claims call between them, with the canon of known entities injected -> typed
parse -> deterministic filter and fold into one row per (type, key) per document -> rows. Rejected
rows go to rejected.jsonl beside the output: read them on train to tune the filter.

The model calls fan out over every (document, section) pair at once, so one long document never
holds the stage: with sections in sequence, a 14-section article is 28 calls one after another.
"""

import logging
from pathlib import Path

from ..config import Config
from ..jsonl import write_jsonl
from ..llm import Client
from .chunking import Section, sections
from .critic import critique
from .extract import extract_section, fold_document

log = logging.getLogger("graphrag.extraction")


def run(cfg: Config, root: Path, items: list[dict], out: Path) -> list[dict]:
    client = Client(cfg)
    tasks: list[tuple[int, Section]] = []
    for i, item in enumerate(items):
        text = (root / item["path"]).read_text(encoding="utf-8")
        tasks += [(i, s) for s in sections(text, cfg.extraction.section_max_chars)]
    results = client.map(lambda t: extract_section(cfg, client, items[t[0]], t[1]), tasks)
    rows, rejected = [], []
    for i, item in enumerate(items):
        parts = [r for (j, _), r in zip(tasks, results) if j == i]
        mentions, relations, rejects = fold_document(item, [m for ms, _ in parts for m in ms], [r for _, rs in parts for r in rs])
        if cfg.extraction.critic and mentions:
            mentions, relations, critic_rejects = critique(cfg, client, root, item, mentions, relations)
            rejects += critic_rejects
        log.info("%s: %d sections, %d mentions, %d relations", item["doc_uri"], len(parts), len(mentions), len(relations))
        if not mentions:
            log.warning("%s: no rows", item["doc_uri"])
        rows += [m.model_dump(exclude_none=True) for m in mentions]
        rows += [r.model_dump(exclude_none=True) for r in relations]
        rejected += rejects
    write_jsonl(out.parent / "rejected.jsonl", rejected)
    log.info("%d documents, %d sections, %d rows, %d rejected", len(items), len(tasks), len(rows), len(rejected))
    return rows
