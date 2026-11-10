"""Render the graph a kept solution extracted, one standalone HTML page per split.

    uv run python scripts/visualize.py                         # the latest finished night's kept experiment
    uv run python scripts/visualize.py --night <id> --exp <exp_id> --split dev --out /tmp/graphs

The graph is the program's own extraction (`extraction/outputs/predictions.jsonl` of an eval),
never gold. Dev comes from the experiment's own eval, the one its keep decision scored; test from
the night's test eval, which exists only for the experiment the night tested.

- **Entities.** Every `entity_mention` row, merged across documents on type plus the dataset's name
  key (`normalize`, README.md, Identity). The shown name is the most frequent surface.
- **Relations.** Every `related_to` row, collapsed to one edge per directed pair. Its label is the
  most frequent `semantic_type`, its weight the number of documents behind it.

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
from compile import normalize  # the dataset's key function, from the scripts dir above

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
    default=("dev", "test"),
    show_default=True,
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
    out: Path | None,
) -> None:
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
        graph = build_graph(runs / "nights" / night / "evals" / evals[split])
        meta = {
            "split": split,
            "night": night,
            "exp": exp,
            "eval": evals[split],
            "kept": exp == kept,
        }
        path = out / f"{split}.html"
        path.write_text(render(graph, meta))
        logger.info(
            f"{split}: {len(graph['nodes'])} entities, {len(graph['edges'])} relations, {len(graph['documents'])} documents -> {path}"
        )


if __name__ == "__main__":
    main()
