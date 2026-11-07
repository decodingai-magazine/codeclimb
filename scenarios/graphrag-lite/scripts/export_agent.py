"""Export the coding agent's bundle: `spec/agent/`, train's documents and train's gold, nothing else
(README.md, Splits). The agent works from this directory only; dev and test reach it as the
evaluator's reports.

    uv run python scripts/export_agent.py --out <dir>

Layout of `<dir>`:

    spec/                       task.md, ontology.md, train.md, runtime.md
    corpus/                     the train documents
    train/graph.json            the gold graph of the train documents only
    train/examples/<stage>.jsonl  train gold per stage (few-shot material); retrieval rows without
                                  their `why`, a reviewer note that may name later documents' facts
    train/inputs/<stage>.jsonl    what the evaluator hands each stage, for train
    scorer/                       the official scorers on train alone: their gold holds nothing else

The export fails if any written file names a dev or test document (its uri or corpus file name).
"""

import json
import shutil
import sys
from pathlib import Path

import click
import loguru
from loguru import logger

HERE = Path(__file__).resolve().parent.parent  # the dataset root
sys.path.insert(0, str(HERE / "evaluators"))
import extraction  # noqa: E402
import graph  # noqa: E402
import retrieval  # noqa: E402
from common import held_out, log_rows, retrieval_rows, splits, write_jsonl  # noqa: E402
from compile import compile_graph, rows_through  # noqa: E402

STAGES = {"extraction": extraction, "graph": graph, "retrieval": retrieval}


def leaks(out: Path, others: set[str]) -> list[str]:
    """Every `path: name` where a written file names a document outside train."""
    found = []
    for path in sorted(p for p in out.rglob("*") if p.is_file()):
        text = path.read_text(encoding="utf-8")
        found += [f"{path.relative_to(out)}: {name}" for name in sorted(others) if name in text]
    return found


def write_scorer(out: Path, train: list[str], train_graph: dict) -> None:
    """The scorers with a gold of train only, plus the pure-Python packages they need that the sandbox lacks."""
    ignore = shutil.ignore_patterns("__pycache__")
    (out / "evaluators").mkdir(parents=True)
    (out / "scripts").mkdir()
    (out / "gold").mkdir()
    for name in ("common", "extraction", "graph", "retrieval"):
        shutil.copy(HERE / "evaluators" / f"{name}.py", out / "evaluators")
    for name in ("compile", "pulse_normalize"):
        shutil.copy(HERE / "scripts" / f"{name}.py", out / "scripts")
    for package in (click, loguru):
        source = Path(package.__file__).parent
        shutil.copytree(source, out / "vendor" / source.name, ignore=ignore)
    ids = splits()["retrieval"]["train"]
    log = rows_through(list(log_rows()), set(train))
    write_jsonl(out / "gold" / "log.jsonl", log)
    for row in log:
        if row["kind"] == "document":
            target = out / row["path"]
            target.parent.mkdir(exist_ok=True)
            shutil.copy(HERE / row["path"], target)
    mentioned = {(r["type"], r["name"]) for r in log if r["kind"] == "entity_mention"}
    coined = json.loads((HERE / "gold" / "rulings.json").read_text(encoding="utf-8"))["coined_labels"]
    rulings = {"coined_labels": [{"type": c["type"], "name": c["name"]} for c in coined if (c["type"], c["name"]) in mentioned]}
    (out / "gold" / "rulings.json").write_text(json.dumps(rulings, ensure_ascii=False), encoding="utf-8")
    write_jsonl(out / "gold" / "retrieval.jsonl", ({k: v for k, v in r.items() if k != "why"} for r in retrieval_rows() if r["id"] in set(ids)))
    (out / "gold" / "graph.json").write_text(json.dumps(train_graph, ensure_ascii=False), encoding="utf-8")
    empty = {"train": [], "dev": [], "test": []}
    only_train = {"params": splits()["params"], "documents": {**empty, "train": train}, "retrieval": {**empty, "train": ids}}
    (out / "gold" / "splits.json").write_text(json.dumps(only_train), encoding="utf-8")


@click.command()
@click.option("--out", "out_dir", type=click.Path(file_okay=False, path_type=Path), required=True, help="A new or empty directory.")
def main(out_dir: Path) -> None:
    if out_dir.exists() and any(out_dir.iterdir()):
        raise click.UsageError(f"{out_dir} is not empty")
    _, train = held_out("train")
    docs = {r["doc_uri"]: r for r in log_rows() if r["kind"] == "document"}

    (out_dir / "spec").mkdir(parents=True)
    for md in sorted((HERE / "spec" / "agent").glob("*.md")):
        shutil.copy(md, out_dir / "spec" / md.name)
    for uri in train:
        target = out_dir / docs[uri]["path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(HERE / docs[uri]["path"], target)

    train_graph = compile_graph(rows_through(list(log_rows()), set(train)))
    (out_dir / "train").mkdir()
    (out_dir / "train" / "graph.json").write_text(json.dumps(train_graph, ensure_ascii=False, indent=1), encoding="utf-8")
    for name, stage in STAGES.items():
        stage.examples.callback(out_path=out_dir / "train" / "examples" / f"{name}.jsonl")
        kwargs = {"mode": "gold-history"} if name == "graph" else {}
        stage.inputs.callback(split_name="train", out_path=out_dir / "train" / "inputs" / f"{name}.jsonl", **kwargs)
    queries = out_dir / "train" / "examples" / "retrieval.jsonl"
    write_jsonl(
        queries, ({k: v for k, v in json.loads(line).items() if k != "why"} for line in queries.read_text(encoding="utf-8").splitlines())
    )

    write_scorer(out_dir / "scorer", train, train_graph)

    others = {u for u in docs if u not in set(train)}
    others |= {Path(docs[u]["path"]).stem for u in others}
    found = leaks(out_dir, others)
    if found:
        shutil.rmtree(out_dir)
        raise click.ClickException("the bundle names dev or test documents, export removed:\n" + "\n".join(found[:20]))
    logger.info(
        f"{len(train)} train documents, {len(train_graph['entities'])} entities, "
        f"{len(train_graph['relationships']['related_to'])} relations -> {out_dir}"
    )


if __name__ == "__main__":
    main()
