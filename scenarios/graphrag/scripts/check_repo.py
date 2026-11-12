"""Check a branch's repository before it is evaluated (scenario.yaml `check`, docs/scenario-contract.md Q9, Q22).

    uv run python scripts/check_repo.py --repo <dir> --out <report.json>

Errors, which keep the branch from being evaluated: `fewshot.json` is missing, malformed or names
anything outside train; a file names a dev or test document (uri or corpus file name) or query id.
Notes, which go to the reviewer: dev-only entity names found in the repository. A name can come from
the agent's own knowledge, so it can't fail the branch; a copied id can only come from a dev report.
"""

import json
import re
import sys
from pathlib import Path

import click

HERE = Path(__file__).resolve().parent.parent  # the dataset root
sys.path.insert(0, str(HERE / "evaluators"))
from common import held_out, log_rows, splits  # noqa: E402
from compile import compile_graph, rows_through  # noqa: E402

MANIFEST = "fewshot.json"
MANIFEST_KEYS = {"doc_uris", "query_ids"}
MAX_LISTED = 20
"""Findings named in a report: enough to act on, short enough for the reviewer's prompt."""
MIN_NAME_LENGTH = 4
NAMED_TYPES = {"person", "organization", "tool", "model"}  # the entity types a dev-only name is scanned for
"""Shorter entity names match ordinary words and acronyms."""


def pattern(tokens: set[str], flags: int = 0) -> re.Pattern[str]:
    """Matches a whole token: `sh-001` is not found inside `tr-sh-001` or `sh-0012`."""
    alternatives = "|".join(map(re.escape, sorted(tokens, key=len, reverse=True)))
    return re.compile(rf"(?<![\w-])(?:{alternatives})(?![\w-])", flags)


def manifest_errors(repo: Path, train_docs: set[str], train_queries: set[str]) -> list[str]:
    """Why the repository's manifest fails, if it does."""
    path = repo / MANIFEST
    if path.is_symlink() or not path.is_file():
        return [f"{MANIFEST} is missing: record the train ids the system uses, even if none"]
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        return [f"{MANIFEST} is not JSON: {e}"]
    valid = (
        isinstance(manifest, dict)
        and set(manifest) == MANIFEST_KEYS
        and all(isinstance(v, list) and all(isinstance(i, str) for i in v) for v in manifest.values())
    )
    if not valid:
        return [f"{MANIFEST} must be an object with two lists of strings, doc_uris and query_ids"]
    outside = [*(u for u in manifest["doc_uris"] if u not in train_docs), *(q for q in manifest["query_ids"] if q not in train_queries)]
    return [f"{MANIFEST} names items outside train: {', '.join(outside[:MAX_LISTED])}"] if outside else []


def repo_texts(repo: Path) -> list[tuple[str, str]]:
    """(relative path, text) of every regular file. The commit is the agent's: a symlink stays unread."""
    texts = []
    for path in sorted(p for p in repo.rglob("*") if p.is_file() and not p.is_symlink()):
        texts.append((str(path.relative_to(repo)), path.read_text(encoding="utf-8", errors="ignore")))
    return texts


def dev_only_names() -> set[str]:
    """Names of the entities dev's documents add to train's that the bundle's text doesn't hold either.

    Only named things (people, organizations, tools, models): a method or system is a concept such as
    "vector database" or "Prompt Chaining", a phrase any system may use without having seen dev.
    """
    rows = list(log_rows())
    train = compile_graph(rows_through(rows, set(held_out("train")[1])))
    history, dev = held_out("dev")
    through_dev = compile_graph(rows_through(rows, {*history, *dev}))
    known = {e["name"] for e in train["entities"]}
    names = {e["name"] for e in through_dev["entities"] if e["type"] in NAMED_TYPES and e["name"] not in known and len(e["name"]) >= MIN_NAME_LENGTH}
    # what the bundle holds as text: train documents, the agent's spec, and the scorer code it ships
    # (export_agent.py, write_scorer), which a coder may copy: a name there is no sign of fitting dev
    scorer = [HERE / "evaluators" / f"{n}.py" for n in ("common", "extraction", "graph", "retrieval")] + [HERE / "scripts" / f"{n}.py" for n in ("compile", "text_normalize")]
    bundle = [HERE / d["path"] for d in train["documents"]] + sorted((HERE / "spec" / "agent").glob("*.md")) + scorer
    in_bundle = {m.lower() for path in bundle for m in pattern(names, re.IGNORECASE).findall(path.read_text(encoding="utf-8"))}
    return {n for n in names if n.lower() not in in_bundle}


def held_out_ids() -> set[str]:
    """Uris and corpus file names of the dev and test documents, and the dev and test query ids."""
    documents = {r["doc_uri"]: r["path"] for r in log_rows() if r["kind"] == "document"}
    outside_docs = set(documents) - set(held_out("train")[1])
    return {*outside_docs, *(Path(documents[u]).stem for u in outside_docs), *splits()["retrieval"]["dev"], *splits()["retrieval"]["test"]}


def check(repo: Path) -> dict:
    train_docs = set(held_out("train")[1])
    errors = manifest_errors(repo, train_docs, set(splits()["retrieval"]["train"]))
    forbidden_ids, names = pattern(held_out_ids()), pattern(dev_only_names(), re.IGNORECASE)
    leaks: set[str] = set()
    found_names: set[str] = set()
    for path, text in repo_texts(repo):
        leaks |= {f"{path}: {m}" for m in set(forbidden_ids.findall(text))}
        found_names |= {m.lower() for m in set(names.findall(text))}
    if leaks:
        errors.append(f"the repository names dev or test items: {'; '.join(sorted(leaks)[:MAX_LISTED])}")
    notes = [f"dev-only entity names in the repository: {', '.join(sorted(found_names)[:MAX_LISTED])}"] if found_names else []
    return {"errors": errors, "notes": notes}


@click.command()
@click.option("--repo", type=click.Path(exists=True, file_okay=False, path_type=Path), required=True, help="The branch's files.")
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="The report to write.")
def main(repo: Path, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(check(repo), ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
