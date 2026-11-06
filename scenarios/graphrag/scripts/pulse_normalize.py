"""Pulse's `_normalize`, vendored from scrabble (`src/pulse`) so the dataset's
key no longer needs the scrabble project. Behaviour is unchanged; `scripts/compile.py` builds the
dataset key (README.md, Identity) on top of it. The copy is codeclimb's: it is not synced back.

    _normalize(" Word-Lists ") == "word list"

Steps: every run of non-alphanumerics (underscore included) becomes a space, each token is
singularized in its own case, then the key is lowercased. Lowercasing comes last because the plural
rule reads case: `LLMs` is a plural, `HTTPS` is not.
"""

import re

_PUNCTUATION = re.compile(r"[\W_]+")
"""Every run of non-alphanumerics, replaced by a space (never deleted, so `PL/SQL` and `PL/pgSQL` stay apart)."""

_MIN_SINGULAR_LENGTH = 4
"""Shortest token `_singularize` touches: `its`, `bus` and `is` are under it."""

_MIN_IES_LENGTH = 5
"""Shortest token the `ies` -> `y` rule fires on, so `ties` -> `tie`."""

_SIBILANT_ES = ("sses", "xes", "zes", "ches", "shes")
"""Plural endings whose stem takes `-es` (`classes`, `boxes`); `sses`, not `ses`, so `databases` keys `database`."""

_PLURAL_S_EXCEPTIONS = ("ss", "us", "is")
"""Trailing-`s` endings that are not plurals: `class`, `focus`, `analysis`."""

_VOWELS = frozenset("aeiouy")
"""A stem with a vowel is a pronounceable word; a vowelless one may be an initialism."""


def _is_acronym_s(token: str) -> bool:
    """Whether the trailing `s` is a letter of an initialism, not a plural marker.

    A stem with a vowel is a word, so its `s` is a plural (`agents`). On a vowelless stem, a lowercase
    `s` after a stem with an uppercase letter is an acronym plural (`LLMs`); anything else is part of
    the acronym (`HTTPS`, `https`). Stable under lowercasing, which `_normalize`'s idempotence needs.
    """
    stem = token[:-1]
    if not stem or _VOWELS & set(stem.lower()):
        return False
    return not (token[-1].islower() and stem != stem.lower())


def _singularize(token: str) -> str:
    """Fold one token to a conservative English singular, reading its original case; first rule wins.

    Only purely alphabetic tokens of length >= 4 are touched, so `GPT-4s` keeps its `4s`. Wrong
    singulars that collide with nothing are harmless (`kubernetes` keys `kubernete`): the key is for
    matching only.
    """
    if len(token) < _MIN_SINGULAR_LENGTH or not token.isalpha():
        return token
    lowered = token.lower()
    if lowered.endswith("ies") and len(token) >= _MIN_IES_LENGTH:
        return f"{token[:-3]}y"
    if lowered.endswith(_SIBILANT_ES):
        return token[:-2]
    if lowered.endswith("s") and not lowered.endswith(_PLURAL_S_EXCEPTIONS) and not _is_acronym_s(token):
        return token[:-1]
    return token


def _fold(name: str) -> str:
    """One pass: punctuation spaced out, each token singularized in its own case (no lowercasing)."""
    return " ".join(_singularize(token) for token in _PUNCTUATION.sub(" ", name).split())


def _normalize(name: str) -> str:
    """`name`'s matching key: punctuation spaced out, tokens singularized, lowercased; idempotent.

    `str.lower` can add a character (`İ` lowercases to `i` + a combining dot, which counts as a
    separator), so when lowercasing changes the length the fold runs again to reach a fixed point.
    """
    folded = _fold(name)
    key = folded.lower()
    return key if len(key) == len(folded) else _fold(key)
