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

The export fails if any written file names a dev or test document (its uri or corpus file name).
"""

import json
import shutil
import sys
from pathlib import Path

import click
from loguru import logger

HERE = Path(__file__).resolve().parent.parent  # the dataset root
sys.path.insert(0, str(HERE / "evaluators"))
import extraction  # noqa: E402
import graph  # noqa: E402
import retrieval  # noqa: E402
from common import held_out, log_rows, write_jsonl  # noqa: E402
from compile import compile_graph, rows_through  # noqa: E402

STAGES = {"extraction": extraction, "graph": graph, "retrieval": retrieval}


def leaks(out: Path, others: set[str]) -> list[str]:
    """Every `path: name` where a written file names a document outside train."""
    found = []
    for path in sorted(p for p in out.rglob("*") if p.is_file()):
        text = path.read_text(encoding="utf-8")
        found += [f"{path.relative_to(out)}: {name}" for name in sorted(others) if name in text]
    return found


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
