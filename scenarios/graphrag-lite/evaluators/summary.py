"""One report for one stage across every split part: dev, and optionally train and test, with the
headline metrics side by side (README.md, Evaluators).

    uv run python evaluators/summary.py --stage retrieval \
        --predictions-dir runs/v3 --out runs/v3/summary.json

`--predictions-dir` holds `dev.jsonl` (required), `train.jsonl` and `test.jsonl` (optional). Each
is exactly what that stage's `score` command takes. Without `test.jsonl`, `test` and every `gap`
are null: the evaluator runs it on each dev submission, then once with test.
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import click
from common import PARTS, fmt, splits, write_report
from loguru import logger

HERE = Path(__file__).resolve().parent
STAGES = ("extraction", "graph", "retrieval")
HEADLINE = {
    "extraction": [
        "mentions.f1",
        "mentions.precision",
        "mentions.recall",
        "relations.directed.f1",
        "type_accuracy.accuracy",
    ],
    "graph": [
        "b_cubed.precision",
        "b_cubed.recall",
        "baselines.history_only.recall",
        "merge_decisions.rate",
        "merge_decisions.wrong_merges",
    ],
}


def lookup(report: dict, path: str):
    """A dotted path into a report; `merge_decisions.rate` is derived, so test and dev compare as rates, not counts."""
    if path == "merge_decisions.rate":
        m = report.get("merge_decisions", {})
        return m["correct"] / m["gold"] if m.get("gold") else None
    node = report
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def headline_paths(stage: str, reports: list[dict]) -> list[tuple[str, str]]:
    """(label, path into the report). Retrieval's headline is each kind's primary metrics, read from the reports."""
    if stage != "retrieval":
        return [(p, p) for p in HEADLINE[stage]]
    out = {}
    for r in reports:
        for kind, v in r["by_kind"].items():
            for metric in v["primary"]:
                out[f"{kind}.{metric}"] = f"by_kind.{kind}.metrics.{metric}.mean"
    return sorted(out.items())


def run_score(stage: str, split_name: str, predictions: Path, extra: list[str], tmp: Path) -> dict:
    out = tmp / f"{split_name}.json"
    cmd = [sys.executable, str(HERE / f"{stage}.py"), "score", "--split", split_name, "--predictions", str(predictions), "--out", str(out)]
    done = subprocess.run(cmd + extra, capture_output=True, text=True)
    if done.returncode:
        raise click.ClickException(f"{stage} score on {predictions.name} failed:\n{done.stderr.strip()}")
    return json.loads(out.read_text(encoding="utf-8"))


@click.command()
@click.option("--stage", type=click.Choice(STAGES), required=True, help="Which evaluator to run.")
@click.option(
    "--predictions-dir",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    required=True,
    help="Holds dev.jsonl and, optionally, train.jsonl and test.jsonl.",
)
@click.option(
    "--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="Where the JSON summary is written."
)
@click.option("--mode", type=click.Choice(["gold-history", "end-to-end"]), default=None, help="Graph only: passed to graph.py score.")
@click.option("--ranked/--unranked", default=True, show_default=True, help="Retrieval only: passed to retrieval.py score.")
def main(stage: str, predictions_dir: Path, out_path: Path, mode: str | None, ranked: bool) -> None:
    """Score every split part of one stage and write the headline metrics side by side."""
    if mode and stage != "graph":
        raise click.UsageError("--mode applies to --stage graph only")
    if not ranked and stage != "retrieval":
        raise click.UsageError("--unranked applies to --stage retrieval only")
    extra = (["--mode", mode] if mode else []) + ([] if ranked else ["--unranked"])
    files = {part: predictions_dir / f"{part}.jsonl" for part in PARTS}
    if not files["dev"].exists():
        raise click.UsageError(f"{predictions_dir} lacks dev.jsonl: dev is required")

    with tempfile.TemporaryDirectory() as tmp:
        reports = {part: run_score(stage, part, f, extra, Path(tmp)) if f.exists() else None for part, f in files.items()}

    headline = {}
    for label, path in headline_paths(stage, [r for r in reports.values() if r]):
        values = {part: lookup(r, path) if r else None for part, r in reports.items()}
        ci = lookup(reports["dev"], path.removesuffix(".mean") + ".ci95") if path.endswith(".mean") else None
        dev, test = values["dev"], values["test"]
        headline[label] = {
            "train": values["train"],
            "dev": dev,
            "dev_ci95": ci,
            "test": test,
            "gap": test - dev if test is not None and dev is not None else None,
        }

    report = {
        "stage": stage,
        "splits_params": splits()["params"],
        "options": {"mode": mode, "ranked": ranked},
        "parts": {part: r is not None for part, r in reports.items()},
        "headline": headline,
        "note": "gap = test minus dev; a drop beyond dev_ci95 (retrieval) or a few points (extraction, graph) "
        "means the system was fit to dev. Train is few-shot material, so a high train score proves nothing. "
        "Retrieval kinds are never averaged together.",
        **reports,
    }
    write_report(out_path, report)
    first = next(iter(headline.items()), None)
    if first:
        label, h = first
        logger.info(f"{stage}: {label} train={fmt(h['train'])} dev={fmt(h['dev'])} test={fmt(h['test'])} gap={fmt(h['gap'])} -> {out_path}")


if __name__ == "__main__":
    main()
