"""The normalized key (task.md, When two strings are the same name), the scorer's own: acronym plurals
folded, symbols spelled as words, then `_normalize`, tokens joined by `-`. Copied from the
bundle's scorer (`scorer/scripts/compile.py`), which the evaluator does not ship.

    normalize("JSON Schemas") == normalize("json-schema") == "json-schema"
    normalize("C#") == "c-sharp"; normalize("---") == ""
"""

import re
import unicodedata

from .text_normalize import _normalize

SEPARATORS = set("-_–,():.'’")
"""Characters that only separate words; with whitespace they split the key into tokens."""

SYMBOL_WORDS = {"@": "at", "^": "pow", "+": "plus", "#": "sharp", "/": "slash", "&": "and", "$": "dollar", "*": "star", "×": "by"}
"""Every other symbol carries meaning inside a name, so it becomes a word: `a@k` and `a^k` are two
names, `C#` is not `C`, `memory/` is not `memory`. A symbol missing here falls back to its Unicode name."""

ACRONYM_PLURAL = re.compile(r"\b([A-Z][A-Z0-9]*[A-Z])s\b")
"""An all-caps stem plus a lowercase `s` is a plural (`APIs`, `CLIs`, `KGs`), whatever its length or ending."""


def _spell(symbol: str) -> str:
    if symbol in SEPARATORS:
        return " "
    return f" {SYMBOL_WORDS.get(symbol) or unicodedata.name(symbol, 'symbol').lower()} "


def normalize(name: str) -> str:
    spelled = re.sub(r"[^\w\s]|_", lambda m: _spell(m.group()), ACRONYM_PLURAL.sub(r"\1", name))
    return "-".join(_normalize(spelled).split())


def tokens(name: str) -> list[str]:
    return [t for t in normalize(name).split("-") if t]
