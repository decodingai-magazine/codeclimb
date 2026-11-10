"""Stage 2: fold surfaces into entities, in document order (task.md, 2. Graph building).

The history's same_as rows are applied first, all of them; then every surface is resolved in seq
order through the chain in resolve.py. One assignment per surface in the log, history included, so a
held-out surface that joins a history entity shares its id.
"""

from .materialize import assignments


def run(items: list[dict]) -> list[dict]:
    return [a.model_dump() for a in assignments(items)]
