"""Score graph building: which surfaces a builder folded into one entity, against the gold `same_as`
chains (README.md, Scoring and Splits).

    uv run python evaluators/graph.py inputs --split dev --out in.jsonl
    uv run python evaluators/graph.py score  --split dev \
        --predictions clusters.jsonl --out report.json

The log is cut at the end of the held-out part. `inputs` writes the history rows, then (in
`gold-history` mode) the `same_as` rows given as history, then the held-out rows. A `same_as` row
is given only when both of its surfaces are first seen in history documents; every other one whose
surfaces are both in the cut log is hidden, and is a decision the builder must make.

Predictions are one `{"surface_id", "entity_id"}` per line: the entity each surface was folded
into. B-cubed is computed over `entity_mention` rows, with clusters spanning every row of the cut
log and the average taken over held-out rows only.
"""

from collections import Counter, defaultdict
from pathlib import Path
from typing import Literal

import click
from common import (
    fmt,
    held_out,
    log_rows,
    read_predictions,
    refuse_test_details,
    split_header,
    split_options,
    terminal_of,
    write_jsonl,
    write_report,
)
from loguru import logger
from pydantic import BaseModel, ConfigDict

Mode = Literal["gold-history", "end-to-end"]
mode_option = click.option(
    "--mode",
    type=click.Choice(["gold-history", "end-to-end"]),
    default="gold-history",
    show_default=True,
    help="gold-history gives the history's same_as rows; end-to-end gives none.",
)


class Assignment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    surface_id: str
    entity_id: str


def cut_log(split_name: str) -> dict:
    """The log up to the end of the held-out part, with its `same_as` rows sorted into given and hidden."""
    history, held = held_out(split_name)
    hist_docs, held_docs = set(history), set(held)
    rows = [r for r in log_rows() if r["kind"] != "same_as" and r["doc_uri"] in hist_docs | held_docs]
    first_seen: dict[str, str] = {}
    for r in rows:
        if r["kind"] == "entity_mention":
            first_seen.setdefault(r["surface_id"], r["doc_uri"])
    given, hidden = [], []
    for r in log_rows():
        if r["kind"] == "same_as" and r["from_id"] in first_seen and r["to_id"] in first_seen:
            both_history = first_seen[r["from_id"]] in hist_docs and first_seen[r["to_id"]] in hist_docs
            (given if both_history else hidden).append(r)
    return {
        "history": history,
        "held": held,
        "held_docs": held_docs,
        "rows": rows,
        "first_seen": first_seen,
        "given": given,
        "hidden": hidden,
    }


def b_cubed(mentions: list[dict], gold_of, pred_of, held_docs: set[str]) -> dict:
    """B-cubed precision and recall per held-out row, averaged; clusters span every row in `mentions`."""
    gold_size, pred_size, both = Counter(), Counter(), Counter()
    for m in mentions:
        g, p = gold_of(m["surface_id"]), pred_of(m["surface_id"])
        gold_size[g] += 1
        pred_size[p] += 1
        both[(g, p)] += 1
    scored = [m for m in mentions if m["doc_uri"] in held_docs]
    if not scored:
        return {"precision": None, "recall": None, "rows": 0}
    precision = recall = 0.0
    for m in scored:
        g, p = gold_of(m["surface_id"]), pred_of(m["surface_id"])
        precision += both[(g, p)] / pred_size[p]
        recall += both[(g, p)] / gold_size[g]
    return {"precision": precision / len(scored), "recall": recall / len(scored), "rows": len(scored)}


@click.group()
def cli() -> None:
    """Graph-building evaluator (spec/agent/train.md, Graph building)."""


@cli.command()
@split_options
@mode_option
@click.option(
    "--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL of log rows, each with a `part`."
)
def inputs(split_name: str, mode: Mode, out_path: Path) -> None:
    """Write the cut log the builder resolves: history rows, given same_as rows, held-out rows."""
    cut = cut_log(split_name)
    history = [{**r, "part": "history"} for r in cut["rows"] if r["doc_uri"] not in cut["held_docs"]]
    given = [{**r, "part": "history"} for r in cut["given"]] if mode == "gold-history" else []
    held = [{**r, "part": "held_out"} for r in cut["rows"] if r["doc_uri"] in cut["held_docs"]]
    n = write_jsonl(out_path, [*history, *given, *held])
    logger.info(f"{n} rows ({len(history)} history, {len(given)} given same_as, {len(held)} held-out) -> {out_path}")


@cli.command()
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL of train examples.")
def examples(out_path: Path) -> None:
    """Write the train log with every merge decision it holds: few-shot material, never scored."""
    cut = cut_log("train")
    n = write_jsonl(out_path, [*cut["rows"], *cut["hidden"]])
    logger.info(f"{n} rows ({len(cut['hidden'])} same_as) over {len(cut['held'])} train documents -> {out_path}")


@cli.command()
@split_options
@mode_option
@click.option(
    "--predictions", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True, help="JSONL of {surface_id, entity_id}."
)
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="Where the JSON report is written.")
@click.option("--details", is_flag=True, help="Add the missed and wrong merges (train and dev only).")
def score(split_name: str, mode: Mode, predictions: Path, out_path: Path, details: bool) -> None:
    """Score a surface -> entity assignment against the gold same_as chains of the held-out part."""
    refuse_test_details(split_name, details)
    cut = cut_log(split_name)
    first_seen, held_docs = cut["first_seen"], cut["held_docs"]
    mentions = [r for r in cut["rows"] if r["kind"] == "entity_mention"]
    names = {m["surface_id"]: m["name"] for m in mentions}
    gold = terminal_of(cut["given"] + cut["hidden"])
    given = terminal_of(cut["given"])

    assigned: dict[str, str] = {}
    ignored = 0
    for a in read_predictions(predictions, Assignment):
        if a.surface_id not in first_seen:
            ignored += 1
        elif assigned.setdefault(a.surface_id, a.entity_id) != a.entity_id:
            raise click.ClickException(f"{predictions}: surface {a.surface_id} is assigned to two entities")
    is_held = lambda s: first_seen[s] in held_docs  # noqa: E731
    missing_held = sorted(s for s in first_seen if is_held(s) and s not in assigned)
    missing_history = sorted(s for s in first_seen if not is_held(s) and s not in assigned)

    def pred(s: str) -> str:
        if s in assigned:
            return assigned[s]
        return given(s) if mode == "gold-history" and not is_held(s) else s

    result = b_cubed(mentions, gold, pred, held_docs)
    no_merge = b_cubed(mentions, gold, lambda s: s, held_docs)
    history_only = b_cubed(mentions, gold, lambda s: s if is_held(s) else given(s), held_docs)

    decisions = Counter()
    missed = []
    for r in cut["hidden"]:
        ok = pred(r["from_id"]) == pred(r["to_id"])
        decisions[(r["reason"], ok)] += 1
        if not ok:
            missed.append(f"{names[r['from_id']]} -> {names[r['to_id']]} ({r['reason']})")
    members = defaultdict(set)
    for s in first_seen:
        members[pred(s)].add(s)
    wrong = []
    for s in sorted(first_seen, key=lambda s: names[s]):
        if is_held(s):
            others = sorted({names[u] for u in members[pred(s)] if gold(u) != gold(s)})
            if others:
                wrong.append(f"{names[s]} merged with {', '.join(others)}")
    reasons = sorted({r for r, _ in decisions})

    report = {
        **split_header(split_name, len(cut["history"]), len(cut["held"]), "documents"),
        "mode": mode,
        "rows": {"in_cut_log": len(mentions), "held_out": result["rows"]},
        "surfaces": {
            "held_out": sum(map(is_held, first_seen)),
            "missing_held_out_assignments": len(missing_held),
            "missing_history_assignments": len(missing_history),
            "assignments_outside_cut_log": ignored,
            "note": "a missing held-out surface is its own entity; a missing history surface takes the given history in gold-history mode",
        },
        "b_cubed": {"precision": result["precision"], "recall": result["recall"]},
        "baselines": {
            "no_merge": {"precision": no_merge["precision"], "recall": no_merge["recall"]},
            "history_only": {
                "precision": history_only["precision"],
                "recall": history_only["recall"],
                "note": "the given history, and every held-out surface its own entity: what a builder that merges nothing new scores",
            },
        },
        "merge_decisions": {
            "gold": sum(decisions.values()),
            "correct": sum(n for (_, ok), n in decisions.items() if ok),
            "by_reason": {r: {"gold": decisions[(r, True)] + decisions[(r, False)], "correct": decisions[(r, True)]} for r in reasons},
            "wrong_merges": len(wrong),
            "note": "a decision is a hidden same_as row; a wrong merge puts a held-out surface with another gold entity",
        },
    }
    if details:
        report["details"] = {"missed_merges": missed, "wrong_merges": wrong}
    write_report(out_path, report)
    logger.info(
        f"B-cubed P={fmt(result['precision'])} R={fmt(result['recall'])} (history-only R={fmt(history_only['recall'])}); "
        f"merges {report['merge_decisions']['correct']}/{report['merge_decisions']['gold']}, wrong {len(wrong)} -> {out_path}"
    )


if __name__ == "__main__":
    cli()
