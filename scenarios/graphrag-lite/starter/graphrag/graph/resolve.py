"""The resolver chain, one surface at a time in seq order, within one type:

1. exact: the name key equals an earlier surface's name key -> one entity (identity);
2. alias: an alias key equals an earlier entity's name key, or the name key equals an earlier alias
   key -> one entity, unless the alias narrows the name (adds a content word: a variant, not an
   alias) or another entity of the type already owns that key (a collision: the claim is dropped);
3. nominations: acronym and fuzzy candidates, which only propose a pair for a verdict. The hook
   returns nothing here; the decision model or an embedding comparison goes behind it.

A wrong merge is worse than a wrong split: every step that is not an identity prefers "new".
"""

from .keys import normalize, tokens

Key = tuple[str, str]  # (type, key)


def narrows(name: str, alias: str) -> bool:
    """Whether the alias adds a content word to the name (`Pydantic for Agents` on `Pydantic`)."""
    a, b = tokens(name), tokens(alias)
    return len(b) > len(a) and set(a) <= set(b)


class Resolver:
    def __init__(self):
        self.parent: dict[str, str] = {}
        self.name_keys: dict[Key, str] = {}  # (type, key) of a surface name -> a surface id of its entity
        self.alias_keys: dict[Key, str] = {}  # (type, key) of an alias -> a surface id of the entity that claimed it

    def find(self, sid: str) -> str:
        self.parent.setdefault(sid, sid)
        while self.parent[sid] != sid:
            self.parent[sid] = self.parent[self.parent[sid]]
            sid = self.parent[sid]
        return sid

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra

    def same_as(self, from_id: str, to_id: str) -> None:
        self.union(to_id, from_id)

    def nominations(self, surface: dict) -> list[str]:
        """Surface ids of candidate entities for a verdict (acronym, fuzzy, embeddings): none in the starter."""
        return []

    def resolve(self, surface: dict) -> None:
        sid, t = surface["surface_id"], surface["type"]
        self.find(sid)
        key = (t, normalize(surface["name"]))
        if key[1]:
            owner = self.name_keys.get(key) or self.alias_keys.get(key)
            if owner is not None:
                self.union(owner, sid)
            self.name_keys.setdefault(key, sid)
        for alias in surface.get("aliases") or []:
            akey = (t, normalize(alias))
            if not akey[1] or akey == key or narrows(surface["name"], alias):
                continue
            claimed = self.alias_keys.get(akey)
            if claimed is not None and self.find(claimed) != self.find(sid):
                continue  # another entity owns this alias: a collision, not a merge
            named = self.name_keys.get(akey)
            if named is not None:
                self.union(named, sid)
            else:
                self.alias_keys.setdefault(akey, sid)
        for candidate in self.nominations(surface):
            # a nomination needs a verdict before it merges; the starter makes none
            del candidate
