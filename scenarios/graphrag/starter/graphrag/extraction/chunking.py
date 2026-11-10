"""Sections of a document: the body without its frontmatter, cut at ATX headings and bounded in size.

Every character of the body is in exactly one section. A document without headings is one section;
a section over the size bound is cut at paragraph breaks, and a paragraph over the bound at the bound.
"""

import re
from dataclasses import dataclass

FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)
HEADING = re.compile(r"^#{1,6} .*$", re.M)


@dataclass
class Section:
    heading: str | None
    text: str
    position: int


def body(text: str) -> str:
    return FRONTMATTER.sub("", text, count=1)


def bounded(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pieces, current = [], ""
    for paragraph in text.split("\n\n"):
        while len(paragraph) > max_chars:  # one paragraph over the bound: cut it hard
            if current:
                pieces.append(current)
                current = ""
            pieces.append(paragraph[:max_chars])
            paragraph = paragraph[max_chars:]
        joined = f"{current}\n\n{paragraph}" if current else paragraph
        if len(joined) > max_chars:
            pieces.append(current)
            current = paragraph
        else:
            current = joined
    if current:
        pieces.append(current)
    return pieces


def sections(text: str, max_chars: int) -> list[Section]:
    text = body(text)
    starts = [m.start() for m in HEADING.finditer(text)]
    bounds = [0, *starts, len(text)] if not starts or starts[0] != 0 else [*starts, len(text)]
    out: list[Section] = []
    for a, b in zip(bounds, bounds[1:]):
        chunk = text[a:b]
        if not chunk.strip():
            continue
        heading = HEADING.match(chunk)
        for piece in bounded(chunk, max_chars):
            if piece.strip():
                out.append(Section(heading.group().lstrip("# ").strip() if heading else None, piece, len(out)))
    return out


def halves(text: str) -> list[str]:
    """`text` cut in two at a paragraph break near its middle (three pieces when no break fits)."""
    return [p for p in bounded(text, (len(text) + 1) // 2) if p.strip()]
