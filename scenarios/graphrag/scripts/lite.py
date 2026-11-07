"""Cut a lighter copy of this dataset: a few hard documents per part, their gold, and the queries they answer.

    uv run python scripts/lite.py select --train 4 --dev 8 --test 8 --out gold/lite-docs.json
    uv run python scripts/lite.py build --docs gold/lite-docs.json --out ../graphrag-lite

`select` picks documents from each part (train from train, dev from dev, test from test), so the
cut keeps the time order and each part stays a contiguous run of the log. It scores a set of
documents jointly, since a multi-document query survives only if all its documents do:

- queries kept, weighted by difficulty (easy 1, medium 2, hard 3), plus a bonus for each
  `kind` x `difficulty` stratum a part covers, so the queries stay varied;
- extraction load: `entity_mention` and `related_to` rows per document;
- merge decisions: kept surfaces that share an entity with an earlier kept surface;
- extraction traps (`Full.edge_cases`): each kind a part covers, then diminishing credit per instance.

Greedy first, then one-for-one swaps inside a part until nothing improves.

`build` trims the log to the chosen documents and reuses the full dataset's identity decisions: each
full entity, restricted to its kept surfaces, stays one entity. Original `same_as` rows whose two
surfaces survive are kept; where a dropped surface broke a chain, the cut chain is rejoined to the
entity's surviving root (`name_key` when the keys match, `alias_key` when the key is an earlier alias
claim, otherwise `ruling`). Then it compiles `graph.json` and rewrites the retrieval rows against it:

- `multi_hop` and `intersection` keep a row only when every document of the path survives;
- `single_hop`, `comparison`, `aggregation` and `temporal` keep the expected items whose documents
  survive (the lite graph is the full graph restricted to them, so the set stays complete);
- `unanswerable` rows are thinned to `--unanswerable` per part;
- node names follow their entity to its lite canonical name; difficulty is recomputed by the rule;
- every row must then pass `retrieval_gold.py check` on the lite graph, or it is dropped.

Queries stay in their original part, so anchor groups never straddle dev and test.
"""

import json
import math
import shutil
import sys
from collections import Counter, defaultdict
from pathlib import Path

import click
from loguru import logger

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compile import compile_graph, normalize, rows_through, terminal_of  # noqa: E402
from retrieval_gold import Gold, Row, check_row, difficulty_of  # noqa: E402

HERE = Path(__file__).resolve().parent.parent
PARTS = ("train", "dev", "test")
WEIGHT = {"easy": 1.0, "medium": 2.0, "hard": 3.0}
PATH_KINDS = {"multi_hop", "intersection"}
COPY = ("evaluators", "scripts", "spec", "starter", "README.md", "pyproject.toml", "uv.lock", "requirements.txt", "scenario.yaml")


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def row_docs(row: dict) -> set[str]:
    ex = row["expected"]
    return {d["doc_uri"] for d in ex["docs"]} | {e["doc_uri"] for e in ex["edges"]}


class Full:
    """The full dataset, indexed for selection and trimming."""

    def __init__(self):
        self.log = read_jsonl(HERE / "gold" / "log.jsonl")
        self.graph = json.loads((HERE / "gold" / "graph.json").read_text(encoding="utf-8"))
        self.rows = read_jsonl(HERE / "gold" / "retrieval.jsonl")
        self.splits = json.loads((HERE / "gold" / "splits.json").read_text(encoding="utf-8"))
        self.terminal = terminal_of(self.log)
        self.doc_part = {u: p for p in PARTS for u in self.splits["documents"][p]}
        self.row_part = {r: p for p in PARTS for r in self.splits["retrieval"][p]}
        self.order = [r["doc_uri"] for r in self.log if r["kind"] == "document"]
        self.load: Counter[str] = Counter()
        self.surfaces: dict[str, list[str]] = defaultdict(list)  # doc -> surfaces first seen there
        seen: set[str] = set()
        for r in self.log:
            if r["kind"] in ("entity_mention", "related_to"):
                self.load[r["doc_uri"]] += 1
            if r["kind"] == "entity_mention" and r["surface_id"] not in seen:
                seen.add(r["surface_id"])
                self.surfaces[r["doc_uri"]].append(r["surface_id"])
        self.mentions: dict[str, set[str]] = defaultdict(set)
        for m in self.graph["relationships"]["mentions"]:
            self.mentions[m["entity_id"]].add(m["doc_uri"])
        self.by_name = {(e["type"], e["name"]): e["id"] for e in self.graph["entities"]}
        self.published = {d["uri"]: d["published"] for d in self.graph["documents"]}
        self.cases = self.edge_cases()

    def edge_cases(self) -> dict[str, Counter]:
        """Per document, the extraction traps its gold holds (README.md, Corrections to the extraction):

        - `alias_only`: a row whose name is absent from the body, matched only through an alias;
        - `variant`: a surface that keeps its own wording and is merged into another entity;
        - `coined`: a coined label for an unnamed method or system;
        - `sibling`: an entity the rulings keep apart from a near-identical one (`pass@k` / `pass^k`);
        - `type_twin`: a name that is a different entity under another type (`LangChain` org / tool);
        - `negative_alias`, `renamed`, `retyped`: entities a ruling corrected;
        - `not_a_tool`: a dropped tool-like name (`Grep`, `/compact`) the body uses, which must not be extracted;
        - `isolated`: a mention with no `related_to` row;
        - `type:<t>`: one per entity type present.
        """
        rulings = json.loads((HERE / "gold" / "rulings.json").read_text(encoding="utf-8"))
        key_set = lambda names: {normalize(n) for n in names} - {""}  # noqa: E731
        coined = {(c["type"], normalize(c["name"])) for c in rulings["coined_labels"]}
        sibling = {(k["type"], normalize(n)) for k in rulings["kept_separate"] for n in k["names"]}
        negative = {(n["type"], normalize(n["entity"])) for n in rulings["negative_aliases"]}
        renamed = {(r["type"], normalize(r["to"])): set(r.get("except_docs", [])) for r in rulings["renames"]}
        retyped = key_set(r["name"] for r in rulings["retypes"])
        dropped = key_set(n for d in rulings["drops"] for n in d["names"])
        types_of: dict[str, set[str]] = defaultdict(set)
        for e in self.graph["entities"]:
            for n in [e["name"], *e["aliases"]]:
                types_of[normalize(n)].add(e["type"])
        related = defaultdict(set)
        for r in self.log:
            if r["kind"] == "related_to":
                related[r["doc_uri"]] |= {self.terminal(r["source_id"]), self.terminal(r["target_id"])}
        cases: dict[str, Counter] = defaultdict(Counter)
        for d in self.graph["documents"]:
            text = (HERE / d["path"]).read_text(encoding="utf-8").replace("`", "")
            body = f"-{normalize(text[text.index(chr(10) + '---' + chr(10), 4) + 5 :])}-"
            cases[d["uri"]]["not_a_tool"] += sum(f"-{k}-" in body for k in dropped)
            for r in (r for r in self.log if r["kind"] == "entity_mention" and r["doc_uri"] == d["uri"]):
                c, t, k = cases[d["uri"]], r["type"], normalize(r["name"])
                in_body = lambda n: (key := normalize(n)) and f"-{key}-" in body  # noqa: E731
                c[f"type:{t}"] += 1
                c["alias_only"] += not in_body(r["name"]) and any(map(in_body, r["aliases"]))
                c["variant"] += self.terminal(r["surface_id"]) != r["surface_id"]
                c["coined"] += (t, k) in coined
                c["sibling"] += (t, k) in sibling
                c["type_twin"] += len(types_of[k]) > 1
                c["negative_alias"] += (t, k) in negative
                c["renamed"] += (t, k) in renamed and d["uri"] not in renamed[(t, k)]
                c["retyped"] += k in retyped
                c["isolated"] += self.terminal(r["surface_id"]) not in related[d["uri"]]
        return {u: +c for u, c in cases.items()}


def survives(full: Full, row: dict, kept: set[str]) -> bool:
    """A cheap stand-in for `check` during selection: does the row keep an answer in `kept`?"""
    if row["kind"] == "unanswerable":
        return False  # thinned separately, never a reason to pick a document
    docs = row_docs(row)
    if row["kind"] in PATH_KINDS:
        return docs <= kept
    if row["kind"] in ("aggregation", "temporal"):
        eid = full.by_name[(row["expected"]["nodes"][0]["type"], row["expected"]["nodes"][0]["name"])]
        inside = full.mentions[eid] & kept
        if row["kind"] == "aggregation":
            return len(inside) >= 3
        w = row["window"]
        within = {u for u in inside if w["from"] <= full.published[u][: len(w["from"])] and full.published[u][: len(w["to"])] <= w["to"]}
        return bool(within) and within != inside
    anchors = [full.by_name[(n["type"], n["name"])] for n in row["expected"]["nodes"] if n["role"] == "anchor"]
    if not all(full.mentions[a] & kept for a in anchors):
        return False
    return any(e["doc_uri"] in kept for e in row["expected"]["edges"])


def score(full: Full, kept: set[str]) -> float:
    total = 0.0
    strata: dict[str, set] = defaultdict(set)
    for row in full.rows:
        if survives(full, row, kept):
            total += WEIGHT[row["difficulty"]]
            strata[full.row_part[row["id"]]].add((row["kind"], row["difficulty"]))
    total += 3.0 * sum(len(s) for s in strata.values())
    total += 0.05 * sum(full.load[u] for u in kept)
    for p in PARTS:  # extraction traps: each kind a part covers, then diminishing credit for more of it
        cases = sum((full.cases.get(u, Counter()) for u in kept if full.doc_part[u] == p), Counter())
        total += 4.0 * len(cases) + sum(math.sqrt(n) for n in cases.values())
    clusters = Counter(full.terminal(s) for u in kept for s in full.surfaces[u])
    total += 2.0 * sum(n - 1 for n in clusters.values())
    return total


def select_docs(full: Full, sizes: dict[str, int]) -> dict[str, list[str]]:
    pools = {p: [u for u in full.splits["documents"][p] if full.load[u]] for p in PARTS}
    chosen: dict[str, set[str]] = {p: set() for p in PARTS}
    flat = lambda: set().union(*chosen.values())  # noqa: E731
    while any(len(chosen[p]) < sizes[p] for p in PARTS):
        best = max(
            ((p, u) for p in PARTS if len(chosen[p]) < sizes[p] for u in pools[p] if u not in chosen[p]),
            key=lambda pu: score(full, flat() | {pu[1]}),
        )
        chosen[best[0]].add(best[1])
    current = score(full, flat())
    improved = True
    while improved:
        improved = False
        for p in PARTS:
            for out in sorted(chosen[p]):
                for inn in pools[p]:
                    if inn in chosen[p]:
                        continue
                    trial = (flat() - {out}) | {inn}
                    if (s := score(full, trial)) > current + 1e-9:
                        chosen[p] = (chosen[p] - {out}) | {inn}
                        current, improved = s, True
                        break
                if improved:
                    break
            if improved:
                break
    logger.info(f"score {current:.1f}")
    return {p: [u for u in full.order if u in chosen[p]] for p in PARTS}


def trim_log(full: Full, kept: set[str]) -> list[dict]:
    """The log of the kept documents, its `same_as` rows rejoined so each full entity stays one entity."""
    body = [r for r in full.log if r["kind"] != "same_as" and r["doc_uri"] in kept]
    first: dict[str, int] = {}
    for i, r in enumerate(body):
        if r["kind"] == "entity_mention":
            first.setdefault(r["surface_id"], i)
    same_as = [r for r in full.log if r["kind"] == "same_as" and r["from_id"] in first and r["to_id"] in first]
    # a surface recurs across documents: a merge triggered in a dropped document moves to the first kept one
    same_as = [r if r["doc_uri"] in kept or r["doc_uri"] is None else {**r, "doc_uri": body[first[r["from_id"]]]["doc_uri"]} for r in same_as]
    lite_terminal = terminal_of(same_as)
    clusters: dict[str, set[str]] = defaultdict(set)
    for s in first:
        clusters[full.terminal(s)].add(s)
    rows_by_surface: dict[str, list[dict]] = defaultdict(list)
    for r in body:
        if r["kind"] == "entity_mention":
            rows_by_surface[r["surface_id"]].append(r)

    added: list[tuple[int, dict]] = []
    for full_id, members in clusters.items():
        roots = sorted({lite_terminal(s) for s in members}, key=first.get)
        if len(roots) == 1:
            continue
        root = full_id if full_id in roots else roots[0]
        for other in roots:
            if other == root:
                continue
            mention = rows_by_surface[other][0]
            earlier = [r for s in members for r in rows_by_surface[s] if first[s] < first[other]]
            names = {normalize(r["name"]) for r in earlier}
            claimed = {normalize(a) for r in earlier for a in [r["name"], *r["aliases"]]}
            key = normalize(mention["name"])
            reason = "name_key" if key in names else "alias_key" if key in claimed else "ruling"
            row = {"kind": "same_as", "doc_uri": None if reason == "ruling" else mention["doc_uri"], "observed_at": mention["observed_at"]}
            row |= {"from_id": other, "to_id": root, "reason": reason}
            if reason == "ruling":
                row["why"] = "lite cut: the full dataset resolves these surfaces to one entity through a dropped document"
            added.append((first[other], row))

    # same_as rows follow the document that triggered them; rulings come after every document
    out: list[dict] = []
    triggered: dict[str, list[dict]] = defaultdict(list)
    rulings: list[dict] = []
    for r in same_as:
        (rulings if r["doc_uri"] is None else triggered[r["doc_uri"]]).append(r)
    for _, r in sorted(added, key=lambda x: x[0]):
        (rulings if r["doc_uri"] is None else triggered[r["doc_uri"]]).append(r)
    for i, r in enumerate(body):
        out.append(r)
        last_of_doc = i + 1 == len(body) or body[i + 1]["doc_uri"] != r["doc_uri"]
        if last_of_doc:
            out += triggered.pop(r["doc_uri"], [])
    out += rulings
    assert not triggered, f"same_as rows of documents with no rows: {list(triggered)}"
    out = [{"seq": i, **{k: v for k, v in r.items() if k != "seq"}} for i, r in enumerate(out)]

    lite = terminal_of(out)
    want = {frozenset(m) for m in clusters.values()}
    got: dict[str, set[str]] = defaultdict(set)
    for s in first:
        got[lite(s)].add(s)
    assert {frozenset(m) for m in got.values()} == want, "lite entities differ from the full ones restricted to kept surfaces"
    return out


def rewrite_rows(full: Full, lite_graph: dict, kept: set[str], unanswerable: int) -> list[dict]:
    """Retrieval rows restricted to the kept documents, names moved to the lite canonical names."""
    lite_names = {e["id"]: e["name"] for e in lite_graph["entities"]}
    surfaces_of = defaultdict(set)  # full entity id -> its lite entity ids (each a kept surface)
    for lid in lite_names:
        surfaces_of[full.terminal(lid)].add(lid)
    rename: dict[tuple[str, str], str] = {}
    for (etype, name), fid in full.by_name.items():
        ids = surfaces_of.get(fid)
        if ids:
            assert len(ids) == 1, f"{name}: split into {len(ids)} lite entities"
            rename[(etype, name)] = lite_names[next(iter(ids))]

    out, unanswered = [], Counter()
    for row in full.rows:
        part = full.row_part[row["id"]]
        if row["kind"] == "unanswerable":
            if unanswered[part] < unanswerable:
                unanswered[part] += 1
                out.append(row)
            continue
        if not survives(full, row, kept):
            continue
        ex = row["expected"]
        types = {n["name"]: n["type"] for n in ex["nodes"]}
        edges = [e for e in ex["edges"] if e["doc_uri"] in kept]
        docs = [d for d in ex["docs"] if d["doc_uri"] in kept]
        if row["kind"] in ("single_hop", "comparison"):
            on_edge = {n for e in edges for n in (e["source"], e["target"])}
            nodes = [n for n in ex["nodes"] if n["role"] == "anchor" or n["name"] in on_edge]
            names = {n["name"] for n in nodes}
            docs = [d for d in docs if any(row_mentions(full, types, n, d["doc_uri"]) for n in names)]
        else:
            nodes = ex["nodes"]
        if any((n["type"], n["name"]) not in rename for n in nodes):
            continue
        new = lambda name: rename[(types[name], name)]  # noqa: E731
        row = {
            **row,
            "expected": {
                "nodes": [{**n, "name": new(n["name"])} for n in nodes],
                "edges": [{**e, "source": new(e["source"]), "target": new(e["target"])} for e in edges],
                "docs": docs,
            },
        }
        row["difficulty"] = difficulty_of(Row.model_validate(row))
        out.append(row)
    return out


def row_mentions(full: Full, types: dict[str, str], name: str, uri: str) -> bool:
    return uri in full.mentions[full.by_name[(types[name], name)]]


@click.group()
def cli() -> None:
    """Cut a lighter copy of the dataset."""


@cli.command()
@click.option("--train", type=int, default=4, show_default=True)
@click.option("--dev", type=int, default=8, show_default=True)
@click.option("--test", type=int, default=8, show_default=True)
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True)
def select(train: int, dev: int, test: int, out_path: Path) -> None:
    """Pick the documents of each part and write them as JSON."""
    full = Full()
    chosen = select_docs(full, {"train": train, "dev": dev, "test": test})
    titles = {d["uri"]: d for d in full.graph["documents"]}
    for p in PARTS:
        for u in chosen[p]:
            logger.info(f"{p:5} {titles[u]['published']} load={full.load[u]:3} {titles[u]['title'][:70]}")
    out_path.write_text(json.dumps(chosen, indent=1) + "\n", encoding="utf-8")


@cli.command()
@click.option("--docs", "docs_path", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True)
@click.option("--out", "out_dir", type=click.Path(file_okay=False, path_type=Path), required=True)
@click.option("--unanswerable", type=int, default=2, show_default=True, help="Unanswerable rows kept per part.")
def build(docs_path: Path, out_dir: Path, unanswerable: int) -> None:
    """Write the lite dataset into `out_dir`: code and spec copied, corpus and gold cut."""
    full = Full()
    chosen = json.loads(docs_path.read_text(encoding="utf-8"))
    kept = {u for p in PARTS for u in chosen[p]}
    assert all(full.doc_part[u] == p for p in PARTS for u in chosen[p]), "a document is not in the part it is listed under"
    out_dir.mkdir(parents=True, exist_ok=True)
    ignore = shutil.ignore_patterns("__pycache__", "lite.py", ".venv")
    for name in COPY:
        src, dst = HERE / name, out_dir / name
        if not dst.exists():
            (shutil.copytree(src, dst, ignore=ignore) if src.is_dir() else shutil.copy(src, dst))
    (out_dir / "corpus").mkdir(exist_ok=True)
    (out_dir / "gold").mkdir(exist_ok=True)
    log = trim_log(full, kept)
    paths = {Path(r["path"]).name for r in log if r["kind"] == "document"}
    stale = sorted(p.name for p in (out_dir / "corpus").iterdir() if p.name not in paths)
    if stale:
        raise click.ClickException(f"{out_dir / 'corpus'} holds documents outside this cut, clear it first: {stale[:5]}")
    for r in log:
        if r["kind"] == "document":
            shutil.copy(HERE / r["path"], out_dir / r["path"])
    write = lambda name, rows: (out_dir / "gold" / name).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))  # noqa: E731
    write("log.jsonl", log)
    shutil.copy(HERE / "gold" / "rulings.json", out_dir / "gold" / "rulings.json")
    lite_graph = compile_graph(log)

    (out_dir / "gold" / "graph.json").write_text(json.dumps(lite_graph, ensure_ascii=False, indent=1), encoding="utf-8")

    rows = rewrite_rows(full, lite_graph, kept, unanswerable)
    gold = Gold(lite_graph)
    train_gold = Gold(compile_graph(rows_through(log, set(chosen["train"]))))
    passing = []
    for r in rows:
        fails = check_row(train_gold if r["id"].startswith("tr-") and r["kind"] == "multi_hop" else gold, Row.model_validate(r))
        if fails:
            logger.info(f"drop {r['id']} ({r['kind']}): {' | '.join(fails)}")
        else:
            passing.append(r)
    # split.py's rule for train rows: the query names no entity that only dev or test documents mention
    train_docs = set(chosen["train"])
    seen_in: dict[str, set[str]] = defaultdict(set)
    for r in log:
        if r["kind"] == "entity_mention":
            for name in [r["name"], *r["aliases"]]:
                if key := normalize(name):
                    seen_in[key].add(r["doc_uri"])
    later_only = {k for k, ds in seen_in.items() if not ds & train_docs}
    grounded = lambda r: not any(f"-{k}-" in f"-{normalize(r['query'])}-" for k in later_only)  # noqa: E731
    dropped = [r["id"] for r in passing if r["id"].startswith("tr-") and not grounded(r)]
    if dropped:
        logger.info(f"drop {dropped}: train queries naming entities only dev or test documents mention")
    passing = [r for r in passing if r["id"] not in set(dropped)]
    logger.info(f"{len(passing)} of {len(rows)} rewritten rows pass check")
    rows = passing
    order = [r["doc_uri"] for r in log if r["kind"] == "document"]
    splits = {
        "params": {"lite_of": "graphrag", "documents": {p: len(chosen[p]) for p in PARTS}, "unanswerable_per_part": unanswerable},
        "documents": {p: [u for u in order if u in set(chosen[p])] for p in PARTS},
        "retrieval": {p: [r["id"] for r in rows if full.row_part[r["id"]] == p] for p in PARTS},
    }
    write("retrieval.jsonl", rows)
    (out_dir / "gold" / "splits.json").write_text(json.dumps(splits, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    kinds = Counter(r["kind"] if r["kind"] != "same_as" else f"same_as:{r['reason']}" for r in log)
    logger.info(f"{len(kept)} documents, rows={dict(kinds)}, {len(rows)} retrieval rows -> {out_dir}")


if __name__ == "__main__":
    cli()
