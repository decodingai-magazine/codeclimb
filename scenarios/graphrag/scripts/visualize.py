"""Render the graph a kept solution extracted, one standalone HTML page per split.

    uv run python scripts/visualize.py                         # the latest finished night's kept experiment
    uv run python scripts/visualize.py --night <id> --exp <exp_id> --split dev --out /tmp/graphs
    uv run python scripts/visualize.py --diff                  # dev against gold: dev-diff.html

The graph is the program's own extraction (`extraction/outputs/predictions.jsonl` of an eval),
never gold. Dev comes from the experiment's own eval, the one its keep decision scored; test from
the night's test eval, which exists only for the experiment the night tested.

- **Entities.** Every `entity_mention` row, merged across documents on type plus the dataset's name
  key (`normalize`, README.md, Identity). The shown name is the most frequent surface.
- **Relations.** Every `related_to` row, collapsed to one edge per directed pair. Its label is the
  most frequent `semantic_type`, its weight the number of documents behind it.

`--diff` marks the graph against gold with the extraction evaluator's own matching, document by
document, so its colors agree with the score: each predicted entity is matched, of the wrong type or
not in gold, each gold entity no predicted row matched is added as missed, and each relation is
matched, not in gold or missed. Coined gold rows (labels absent from the body) are never missed, as
in the score. Dev only: test is scored once, without reading its errors (`evaluators/common.py`).

The page loads sigma, graphology and d3-force from jsdelivr at pinned versions with SRI hashes, so it
needs a network connection; everything else is inline.
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from string import Template

import click
from loguru import logger

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "evaluators"))
# The scorers' own gold loading and matching, so the diff agrees with the score.
from common import graph as gold_graph
from common import held_out, log_rows, read_predictions, terminal_of
from compile import normalize  # the dataset's key function, from the scripts dir above
from extraction import Prediction, coined_rows, resolve_end, score_document

SCENARIO = Path(__file__).resolve().parent.parent
RUNS = SCENARIO.parent.parent / "runs" / "graphrag-cloud"
TEMPLATE = Path(__file__).resolve().parent / "graph_template.html"
TOP_PICKS = 10
"""How many entities get the highlight ring: the ones the most documents mention."""

# d3-force reads quadtree, dispatch and timer off the global `d3`, so those load first.
CDN = (
    (
        "https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js",
        "sha384-YdXPUVLFDJ3oITK7LFAPRyzkOcDK06bb7KRaE8GiQyGLsrvHaLS9Ej/lELMC7aCE",
    ),
    (
        "https://cdn.jsdelivr.net/npm/d3-dispatch@3.0.1/dist/d3-dispatch.min.js",
        "sha384-oGUk7ZMuIJXyjegrWZrjUkxuWZHJoUPTeaUNKzjcEhND8HzfagI4EnXVspF2mP60",
    ),
    (
        "https://cdn.jsdelivr.net/npm/d3-quadtree@3.0.1/dist/d3-quadtree.min.js",
        "sha384-JzQQZeN94rbeGRpksNSu8TCkRWLlzTHev53JZngDT0faxrmd9bApgXS5pZWShqJb",
    ),
    (
        "https://cdn.jsdelivr.net/npm/d3-timer@3.0.1/dist/d3-timer.min.js",
        "sha384-brChTSJXF1bpEGi+e8fNotmiEQtehLbv5EWt3njlDFlYjl/SwmXs4xofe0gvWd7E",
    ),
    (
        "https://cdn.jsdelivr.net/npm/d3-force@3.0.0/dist/d3-force.min.js",
        "sha384-RM+ykRJc5/xPC56TVMOAYbZeVThoKXqcRlmRHZZc3YDHDCvFJrsEH2dpLMqL50K8",
    ),
    (
        "https://cdn.jsdelivr.net/npm/sigma@3.0.3/dist/sigma.min.js",
        "sha384-2BM4IWUXdUSofkFc94Y1PY8U+cZYLJjB+EqQAoA2vfFGBvZK8aVaxEhICqCY4rlq",
    ),
)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def kept_night(runs: Path, night: str | None) -> tuple[str, str]:
    """The night and its kept experiment: `night`, or the latest finished night that kept a commit."""
    done = {}
    for path in (runs / "nights").glob("*/done.json"):
        d = json.loads(path.read_text())
        if d.get("kept"):
            done[d["night_id"]] = d
    if night is None:
        if not done:
            raise click.ClickException(f"no finished night under {runs} kept a commit")
        night = max(done, key=lambda n: done[n]["finished_at"])
    if night not in done:
        raise click.ClickException(
            f"night {night} has no done.json with a kept commit under {runs}"
        )
    return night, done[night]["kept"]["exp_id"]


def eval_ids(runs: Path, night: str, exp: str) -> dict[str, str]:
    """Split -> eval id for `exp`: dev from its experiment row, test from the night's test row."""
    found = {}
    for row in read_jsonl(runs / "results.jsonl"):
        if (
            row["night_id"] != night
            or row["exp_id"] != exp
            or row["decision"] == "error"
        ):
            continue
        if row["kind"] == "experiment" and row["split"] == "dev":
            found["dev"] = row["eval_id"]
        elif row["kind"] == "test":
            found["test"] = row["eval_id"]
    return found


def key(kind: str, name: str) -> str:
    return f"{kind}:{normalize(name)}"


def build_graph(eval_dir: Path) -> dict:
    """The predicted graph of one eval: entities, relations and the documents they come from."""
    docs = {
        d["doc_uri"]: {
            "uri": d["doc_uri"],
            "title": d["title"],
            "published": d.get("published"),
        }
        for d in read_jsonl(eval_dir / "extraction" / "inputs.jsonl")
    }
    rows = read_jsonl(eval_dir / "extraction" / "outputs" / "predictions.jsonl")

    surfaces: dict[str, Counter] = defaultdict(Counter)
    entities: dict[str, dict] = {}
    for r in (r for r in rows if r["kind"] == "entity_mention"):
        k = key(r["type"], r["name"])
        e = entities.setdefault(
            k,
            {
                "id": k,
                "type": r["type"],
                "aliases": set(),
                "description": "",
                "mentions": 0,
                "docs": set(),
            },
        )
        surfaces[k][r["name"]] += 1
        e["aliases"].update(r.get("aliases") or [])
        if len(r.get("description") or "") > len(e["description"]):
            e["description"] = r["description"]
        e["mentions"] += r.get("count") or 1
        e["docs"].add(r["doc_uri"])

    pairs: dict[tuple[str, str], dict] = {}
    dangling = 0
    for r in (r for r in rows if r["kind"] == "related_to"):
        s, t = (
            key(r["source_type"], r["source_name"]),
            key(r["target_type"], r["target_name"]),
        )
        if s not in entities or t not in entities:
            dangling += 1
            continue
        if s == t:
            continue
        p = pairs.setdefault((s, t), {"labels": Counter(), "docs": set()})
        p["labels"][r["semantic_type"]] += 1
        p["docs"].add(r["doc_uri"])
    if dangling:
        logger.warning(
            f"{eval_dir.name}: {dangling} relations name an entity no mention row has; left out"
        )

    picks = sorted(
        entities, key=lambda k: (-len(entities[k]["docs"]), -entities[k]["mentions"], k)
    )[:TOP_PICKS]
    nodes = []
    for k, e in entities.items():
        name = surfaces[k].most_common(1)[0][0]
        nodes.append(
            {
                "id": k,
                "name": name,
                "type": e["type"],
                "aliases": sorted(e["aliases"] - {name}),
                "description": e["description"],
                "mentions": e["mentions"],
                "docs": sorted(e["docs"]),
                "pick": k in picks,
            }
        )
    edges = [
        {
            "source": s,
            "target": t,
            "label": p["labels"].most_common(1)[0][0],
            "labels": dict(p["labels"]),
            "weight": len(p["docs"]),
            "docs": sorted(p["docs"]),
        }
        for (s, t), p in pairs.items()
    ]
    return {"documents": list(docs.values()), "nodes": nodes, "edges": edges}


def add_diff(graph: dict, eval_dir: Path, split: str) -> dict:
    """Mark `graph` against `split`'s gold and add what gold has that it lacks; returns the counts."""
    _, held = held_out(split)
    gold_m, gold_r = defaultdict(list), defaultdict(list)
    for r in log_rows():
        if r.get("doc_uri") in held and r["kind"] in ("entity_mention", "related_to"):
            (gold_m if r["kind"] == "entity_mention" else gold_r)[r["doc_uri"]].append(
                r
            )
    pred_m, pred_r = defaultdict(list), defaultdict(list)
    path = eval_dir / "extraction" / "outputs" / "predictions.jsonl"
    for p in (x.root for x in read_predictions(path, Prediction)):
        (pred_m if p.kind == "entity_mention" else pred_r)[p.doc_uri].append(p)
    coined, terminal = coined_rows(), terminal_of(list(log_rows()))
    gold_entities = {e["id"]: e for e in gold_graph()["entities"]}

    rows: dict[str, Counter] = defaultdict(
        Counter
    )  # node -> matched / wrong_type / extra rows
    gold_type: dict[str, str] = {}
    node_of: dict[
        str, str
    ] = {}  # gold entity id -> the predicted node that matched it somewhere
    missed: dict[str, set] = defaultdict(
        set
    )  # gold entity id -> documents it was missed in
    edge_rows: dict[tuple[str, str], Counter] = defaultdict(Counter)
    missed_pairs: list[
        tuple[str, str, str, str]
    ] = []  # (source, target, label, document)
    for u in held:
        gm, pm = gold_m[u], pred_m[u]
        doc_coined = {i for i, g in enumerate(gm) if (u, g["surface_id"]) in coined}
        sc = score_document(gm, gold_r[u], pm, pred_r[u], doc_coined)
        typed, untyped = sc["typed"], sc["untyped"]
        here: dict[int, str] = {}  # gold row -> predicted node, in this document
        for j, m in enumerate(pm):
            k = key(m.type, m.name)
            if j in typed:
                rows[k]["matched"] += 1
                here[typed[j]] = k
            elif j in untyped and gm[untyped[j]]["type"] != m.type:
                rows[k]["wrong_type"] += 1
                gold_type[k] = gm[untyped[j]]["type"]
                here.setdefault(untyped[j], k)
            else:
                rows[k]["extra"] += 1
        for i, g in enumerate(gm):
            eid = terminal(g["surface_id"])
            if i in here:
                node_of.setdefault(eid, here[i])
            elif i not in doc_coined:
                missed[eid].add(u)
        gold_pairs, pred_pairs = sc["pairs"]
        for r in pred_r[u]:
            a = resolve_end(r.source_name, r.source_type, pm)
            b = resolve_end(r.target_name, r.target_type, pm)
            hit = a in typed and b in typed and (typed[a], typed[b]) in gold_pairs
            ends = (
                key(r.source_type or "", r.source_name),
                key(r.target_type or "", r.target_name),
            )
            edge_rows[ends]["matched" if hit else "extra"] += 1
        index = {g["surface_id"]: i for i, g in enumerate(gm)}
        label = {
            (index[r["source_id"]], index[r["target_id"]]): r["semantic_type"]
            for r in gold_r[u]
        }
        for a, b in gold_pairs - pred_pairs:
            ends = [
                here.get(i) or f"gold:{terminal(gm[i]['surface_id'])}" for i in (a, b)
            ]
            missed_pairs.append((ends[0], ends[1], label[(a, b)], u))

    for n in graph["nodes"]:
        c = rows[n["id"]]
        n["status"] = (
            "matched" if c["matched"] else "wrong_type" if c["wrong_type"] else "extra"
        )
        n["rows"] = dict(c)
        if n["id"] in gold_type:
            n["gold_type"] = gold_type[n["id"]]
        n["pick"] = False
    for eid in sorted(set(missed) - set(node_of)):
        e = gold_entities[eid]
        graph["nodes"].append(
            {
                "id": f"gold:{eid}",
                "name": e["name"],
                "type": e["type"],
                "aliases": e["aliases"],
                "description": e.get("description") or "",
                "mentions": 0,
                "docs": sorted(missed[eid]),
                "pick": False,
                "status": "missed",
            }
        )
    for e in graph["edges"]:
        e["status"] = (
            "matched" if edge_rows[(e["source"], e["target"])]["matched"] else "extra"
        )
    have = {(e["source"], e["target"]) for e in graph["edges"]}
    # A coined gold row is never missed, so a missed relation to one has no node to end on.
    ids = {n["id"] for n in graph["nodes"]}
    gone: dict[tuple[str, str], dict] = {}
    for a, b, lab, u in missed_pairs:
        s, t = (node_of.get(n[5:], n) if n.startswith("gold:") else n for n in (a, b))
        if s == t or (s, t) in have or s not in ids or t not in ids:
            continue
        m = gone.setdefault((s, t), {"labels": Counter(), "docs": set()})
        m["labels"][lab] += 1
        m["docs"].add(u)
    graph["edges"] += [
        {
            "source": s,
            "target": t,
            "label": m["labels"].most_common(1)[0][0],
            "labels": dict(m["labels"]),
            "weight": len(m["docs"]),
            "docs": sorted(m["docs"]),
            "status": "missed",
        }
        for (s, t), m in gone.items()
    ]
    return {
        "entities": dict(Counter(n["status"] for n in graph["nodes"])),
        "relations": dict(Counter(e["status"] for e in graph["edges"])),
    }


def render(graph: dict, meta: dict) -> str:
    data = json.dumps({"graph": graph, "meta": meta}, ensure_ascii=False).replace(
        "</", "<\\/"
    )
    scripts = "\n".join(
        f'<script src="{url}" integrity="{sri}" crossorigin="anonymous"></script>'
        for url, sri in CDN
    )
    return Template(TEMPLATE.read_text()).substitute(
        title=f"{meta['split']} graph · {meta['exp']}",
        cdn_scripts=scripts,
        data_json=data,
    )


@click.command()
@click.option(
    "--runs",
    type=click.Path(path_type=Path, file_okay=False),
    default=RUNS,
    show_default=True,
    help="The night results directory.",
)
@click.option(
    "--night", help="Night id. Default: the latest finished night that kept a commit."
)
@click.option("--exp", help="Experiment id. Default: the night's kept experiment.")
@click.option(
    "--split",
    "splits",
    type=click.Choice(["dev", "test"]),
    multiple=True,
    help="Default: dev and test; dev with --diff.",
)
@click.option(
    "--diff",
    is_flag=True,
    help="Mark the graph against gold and add what it missed, to <split>-diff.html. Dev only.",
)
@click.option(
    "--out",
    type=click.Path(path_type=Path, file_okay=False),
    help="Output directory. Default: nights/<id>/graphs/.",
)
def main(
    runs: Path,
    night: str | None,
    exp: str | None,
    splits: tuple[str, ...],
    diff: bool,
    out: Path | None,
) -> None:
    splits = splits or (("dev",) if diff else ("dev", "test"))
    if diff and "test" in splits:
        raise click.UsageError(
            "--diff is for dev only: test is scored once, without reading its errors"
        )
    runs = runs.resolve()
    night, kept = kept_night(runs, night)
    exp = exp or kept
    evals = eval_ids(runs, night, exp)
    out = out or runs / "nights" / night / "graphs"
    out.mkdir(parents=True, exist_ok=True)
    for split in splits:
        if split not in evals:
            logger.warning(
                f"{exp} has no successful {split} eval in night {night}; skipped"
            )
            continue
        eval_dir = runs / "nights" / night / "evals" / evals[split]
        graph = build_graph(eval_dir)
        meta = {
            "split": split,
            "night": night,
            "exp": exp,
            "eval": evals[split],
            "kept": exp == kept,
        }
        if diff:
            report = json.loads((eval_dir / "extraction" / "report.json").read_text())
            meta["diff"] = add_diff(graph, eval_dir, split)
            meta["scores"] = {
                "mentions": report["mentions"],
                "relations": report["relations"]["directed"],
            }
            logger.info(f"{split} against gold: {meta['diff']}")
        path = out / f"{split}{'-diff' if diff else ''}.html"
        path.write_text(render(graph, meta))
        logger.info(
            f"{split}: {len(graph['nodes'])} entities, {len(graph['edges'])} relations, {len(graph['documents'])} documents -> {path}"
        )


if __name__ == "__main__":
    main()
