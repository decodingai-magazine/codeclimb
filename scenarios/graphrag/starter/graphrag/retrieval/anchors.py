"""Anchors: the entities a query names, found by key (task.md, Anchors).

Every n-gram of the query's key tokens is looked up against the names and aliases of every entity;
the longest matches win and don't overlap. A key that several entities share (a tool and the company
of the same name) returns all of them. Embedding the query's phrases is the next step for anchors a
key can't find (a paraphrase, a plural the key doesn't fold).
"""

from ..graph.keys import tokens

MAX_NGRAM = 6


class Anchors:
    def __init__(self, entities: list[dict]):
        self.by_key: dict[str, list[str]] = {}
        for e in entities:
            for surface in [e["name"], *e["aliases"]]:
                key = "-".join(tokens(surface))
                if key:
                    self.by_key.setdefault(key, []).append(e["id"])

    def find(self, query: str) -> list[str]:
        words = tokens(query)
        taken = [False] * len(words)
        found: list[str] = []
        for n in range(min(MAX_NGRAM, len(words)), 0, -1):
            for i in range(len(words) - n + 1):
                if any(taken[i : i + n]):
                    continue
                ids = self.by_key.get("-".join(words[i : i + n]))
                if ids:
                    found += [x for x in ids if x not in found]
                    for j in range(i, i + n):
                        taken[j] = True
        return found
