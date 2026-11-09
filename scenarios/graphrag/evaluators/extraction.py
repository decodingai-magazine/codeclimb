"""Score extraction: predicted `entity_mention` and `related_to` rows against the gold rows of the
held-out documents (README.md, Scoring and Splits).

    uv run python evaluators/extraction.py inputs --split dev --out in.jsonl
    uv run python evaluators/extraction.py score  --split dev \
        --predictions pred.jsonl --out report.json

`inputs` lists the held-out documents, each with the gold entities of every earlier document in
view, as the gold extraction had them. `score` matches predictions per document, one to one, on
type plus the key of any name or alias (README.md, Scoring).
"""

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Annotated, Any, Literal

import click
from common import (
    ROOT,
    f1,
    fmt,
    held_out,
    keys,
    log_rows,
    max_matching,
    normalize,
    prf,
    ratio,
    read_predictions,
    refuse_test_details,
    split_header,
    split_options,
    terminal_of,
    write_jsonl,
    write_report,
)
from loguru import logger
from pydantic import BaseModel, ConfigDict, Field, RootModel

TYPES = ("person", "organization", "model", "tool", "method", "system")
EntityType = Literal["person", "organization", "model", "tool", "method", "system"]


class MentionPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["entity_mention"]
    doc_uri: str
    name: str
    type: EntityType
    aliases: list[str] = []
    description: str | None = None
    properties: dict[str, Any] | None = None
    count: int | None = None
    confidence: float | None = None


class RelatedToPrediction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["related_to"]
    doc_uri: str
    source_name: str
    target_name: str
    semantic_type: str | None = None
    source_type: EntityType | None = None
    target_type: EntityType | None = None
    confidence: float | None = None


class Prediction(RootModel):
    root: Annotated[MentionPrediction | RelatedToPrediction, Field(discriminator="kind")]


def coined_rows() -> set[tuple[str, str]]:
    """(doc_uri, surface_id) of the coined rows: a `coined_labels` ruling whose name and aliases occur
    nowhere in the row's own body (README.md, Corrections to the extraction). No extractor can reproduce them."""
    coined = {(c["type"], c["name"]) for c in json.loads((ROOT / "gold" / "rulings.json").read_text(encoding="utf-8"))["coined_labels"]}
    paths = {r["doc_uri"]: ROOT / r["path"] for r in log_rows() if r["kind"] == "document"}
    out = set()
    for r in log_rows():
        if r["kind"] == "entity_mention" and (r["type"], r["name"]) in coined:
            text = paths[r["doc_uri"]].read_text(encoding="utf-8")
            body = f"-{normalize(text.split('---', 2)[2] if text.startswith('---') else text)}-"
            if not any(f"-{k}-" in body for k in keys(r["name"], *r["aliases"])):
                out.add((r["doc_uri"], r["surface_id"]))
    return out


def known_entities(held: list[str]) -> dict[str, list[dict]]:
    """For each held-out document, the gold entities named by every earlier document (lower `seq`):
    the canonical name when its surface was already seen, else the first name seen, plus every other
    name and alias seen so far."""
    terminal = terminal_of(list(log_rows()))
    held_set, seen, out = set(held), {}, {}
    for r in log_rows():
        if r["kind"] == "document" and r["doc_uri"] in held_set:
            out[r["doc_uri"]] = sorted(
                (
                    {"type": e["type"], "name": (name := e["surfaces"].get(eid, e["first"])), "aliases": sorted(e["names"] - {name})}
                    for eid, e in seen.items()
                ),
                key=lambda e: (e["type"], e["name"]),
            )
        elif r["kind"] == "entity_mention":
            eid = terminal(r["surface_id"])
            e = seen.setdefault(eid, {"type": r["type"], "first": r["name"], "surfaces": {}, "names": set()})
            e["surfaces"].setdefault(r["surface_id"], r["name"])
            e["names"] |= {r["name"], *r["aliases"]}
    return out


def match_mentions(gold: list[dict], pred: list[MentionPrediction], typed: bool) -> dict[int, int]:
    """pred index -> gold index, one to one: equal types (when `typed`) and a shared key between any
    name or alias; a name-to-name hit is preferred over an alias hit."""
    gold_keys = [keys(g["name"], *g["aliases"]) for g in gold]
    candidates = []
    for p in pred:
        p_keys, p_name = keys(p.name, *p.aliases), normalize(p.name)
        hits = [i for i, g in enumerate(gold) if (not typed or g["type"] == p.type) and p_keys & gold_keys[i]]
        candidates.append(sorted(hits, key=lambda i: normalize(gold[i]["name"]) != p_name))
    return max_matching(candidates, len(gold))


def resolve_end(name: str, kind: str | None, pred: list[MentionPrediction]) -> int | None:
    """The predicted mention a relation end names, by key (and type when given); name hits first."""
    k = normalize(name)
    hits = [j for j, p in enumerate(pred) if (kind is None or p.type == kind) and k and k in keys(p.name, *p.aliases)]
    hits.sort(key=lambda j: normalize(pred[j].name) != k)
    return hits[0] if hits else None


def score_document(gold_m: list[dict], gold_r: list[dict], pred_m: list, pred_r: list, coined: set) -> dict:
    """Counts for one document; `coined` holds the indexes of its coined gold rows."""
    typed = match_mentions(gold_m, pred_m, typed=True)
    untyped = match_mentions(gold_m, pred_m, typed=False)
    index = {g["surface_id"]: i for i, g in enumerate(gold_m)}

    gold_pairs = {(index[r["source_id"]], index[r["target_id"]]) for r in gold_r}
    gold_labeled = {(index[r["source_id"]], index[r["target_id"]], r["semantic_type"]) for r in gold_r}
    pred_pairs, pred_labeled, unresolved = set(), set(), 0
    for r in pred_r:
        a, b = resolve_end(r.source_name, r.source_type, pred_m), resolve_end(r.target_name, r.target_type, pred_m)
        unresolved += (a is None) + (b is None)
        if a in typed and b in typed:
            pair = (typed[a], typed[b])
        else:  # an end with no matched mention: a false positive, kept distinct by its surfaces
            pair = (("x", normalize(r.source_name), r.source_type), ("x", normalize(r.target_name), r.target_type))
        pred_pairs.add(pair)
        pred_labeled.add((*pair, r.semantic_type))
    undirected = lambda pairs: {frozenset(p[:2]) for p in pairs}  # noqa: E731
    matched_gold = set(typed.values())
    return {
        "typed": typed,
        "untyped": untyped,
        "mentions": {
            "tp": len(typed),
            "tp_strict": len(matched_gold - coined),
            "predicted": len(pred_m),
            "gold_strict": len(gold_m) - len(coined),
            "coined_gold": len(coined),
            "coined_matched": len(matched_gold & coined),
        },
        "directed": (len(pred_pairs & gold_pairs), len(pred_pairs), len(gold_pairs)),
        "undirected": (len(undirected(pred_pairs) & undirected(gold_pairs)), len(undirected(pred_pairs)), len(undirected(gold_pairs))),
        "labeled": (len(pred_labeled & gold_labeled), len(pred_labeled), len(gold_labeled)),
        "unresolved_ends": unresolved,
        "pairs": (gold_pairs, pred_pairs),
    }


@click.group()
def cli() -> None:
    """Extraction evaluator (spec/agent/train.md, Extraction)."""


@cli.command()
@split_options
@click.option(
    "--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL, one held-out document per line."
)
def inputs(split_name: str, out_path: Path) -> None:
    """Write the held-out documents with the gold entities known before each."""
    _, held = held_out(split_name)
    docs = {r["doc_uri"]: r for r in log_rows() if r["kind"] == "document"}
    known = known_entities(held)
    n = write_jsonl(
        out_path,
        (
            {
                "doc_uri": u,
                "path": docs[u]["path"],
                "title": docs[u]["title"],
                "published": docs[u]["published"],
                "known_entities": known[u],
            }
            for u in held
        ),
    )
    logger.info(f"{n} held-out documents -> {out_path}")


@cli.command()
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="JSONL of train examples.")
def examples(out_path: Path) -> None:
    """Write the train documents with their gold rows: few-shot material, never scored."""
    _, held = held_out("train")
    docs = {r["doc_uri"]: r for r in log_rows() if r["kind"] == "document"}
    known, held_set, coined = known_entities(held), set(held), coined_rows()
    mention_keys = ("kind", "doc_uri", "name", "type", "aliases", "description", "properties", "count", "confidence")
    relation_keys = ("kind", "doc_uri", "source_name", "target_name", "semantic_type", "confidence")
    rows = defaultdict(list)
    for r in log_rows():
        if r.get("doc_uri") in held_set:
            if r["kind"] == "entity_mention":
                row = {k: r[k] for k in mention_keys}
                if (r["doc_uri"], r["surface_id"]) in coined:
                    row["coined"] = True
                rows[r["doc_uri"]].append(row)
            elif r["kind"] == "related_to":
                rows[r["doc_uri"]].append({k: r[k] for k in relation_keys})
    n = write_jsonl(
        out_path,
        (
            {
                "doc_uri": u,
                "path": docs[u]["path"],
                "title": docs[u]["title"],
                "published": docs[u]["published"],
                "known_entities": known[u],
                "rows": rows[u],
            }
            for u in held
        ),
    )
    logger.info(f"{n} train documents, {sum(map(len, rows.values()))} gold rows -> {out_path}")


@cli.command()
@split_options
@click.option(
    "--predictions",
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
    required=True,
    help="JSONL of entity_mention and related_to rows.",
)
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="Where the JSON report is written.")
@click.option("--details", is_flag=True, help="Add per-document misses and false positives (train and dev only).")
@click.option(
    "--skip-doc",
    "skip_docs",
    multiple=True,
    help="A held-out doc_uri to leave out of the score, its predictions ignored: one your few-shot examples come from. Repeatable.",
)
def score(split_name: str, predictions: Path, out_path: Path, details: bool, skip_docs: tuple[str, ...]) -> None:
    """Score predicted rows against the held-out documents' gold rows."""
    refuse_test_details(split_name, details)
    history, held = held_out(split_name)
    unknown = sorted(set(skip_docs) - set(held))
    if unknown:
        raise click.BadParameter(f"not held-out documents of {split_name}: {', '.join(unknown)}", param_hint="--skip-doc")
    skipped = set(skip_docs)
    held = [u for u in held if u not in skipped]
    held_set = set(held)
    gold_m, gold_r = defaultdict(list), defaultdict(list)
    for r in log_rows():
        if r.get("doc_uri") in held_set and r["kind"] in ("entity_mention", "related_to"):
            (gold_m if r["kind"] == "entity_mention" else gold_r)[r["doc_uri"]].append(r)
    pred_m, pred_r, outside = defaultdict(list), defaultdict(list), 0
    for p in (x.root for x in read_predictions(predictions, Prediction)):
        if p.doc_uri in skipped:
            continue
        if p.doc_uri not in held_set:
            outside += 1
        else:
            (pred_m if p.kind == "entity_mention" else pred_r)[p.doc_uri].append(p)
    coined = coined_rows()

    totals, confusion, macro_m, macro_r, per_doc, groups = Counter(), defaultdict(Counter), [], [], {}, Counter()
    for u in held:
        gm = gold_m[u]
        doc_coined = {i for i, g in enumerate(gm) if (u, g["surface_id"]) in coined}
        s = score_document(gm, gold_r[u], pred_m[u], pred_r[u], doc_coined)
        m = s["mentions"]
        totals.update(m)
        for name in ("directed", "undirected", "labeled"):
            tp, pr, go = s[name]
            totals.update({f"{name}_tp": tp, f"{name}_predicted": pr, f"{name}_gold": go})
        totals["unresolved_ends"] += s["unresolved_ends"]
        for j, i in s["untyped"].items():
            confusion[gm[i]["type"]][pred_m[u][j].type] += 1
        if m["gold_strict"]:
            macro_m.append(f1(ratio(m["tp"], m["predicted"]), ratio(m["tp_strict"], m["gold_strict"])) or 0.0)
        if s["directed"][2]:
            tp, pr, go = s["directed"]
            macro_r.append(f1(ratio(tp, pr), ratio(tp, go)) or 0.0)
        if details:
            per_doc[u] = document_details(gm, pred_m[u], pred_r[u], gold_r[u], s, doc_coined)
            groups.update(error_groups(s))

    p_m = ratio(totals["tp"], totals["predicted"])
    r_m = ratio(totals["tp_strict"], totals["gold_strict"])
    matched_untyped = sum(sum(c.values()) for c in confusion.values())
    correct = sum(confusion[t][t] for t in confusion)
    report = {
        **split_header(split_name, len(history), len(held), "documents"),
        "documents": {
            "with_gold_mentions": sum(1 for u in held if gold_m[u]),
            "without_predictions": [u for u in held if not pred_m[u] and not pred_r[u]],
            "empty": sum(1 for u in held if not pred_m[u] and not pred_r[u]),
            "predicted_rows_outside_held_out": outside,
        },
        "mentions": {
            "precision": p_m,
            "recall": r_m,
            "f1": f1(p_m, r_m),
            "tp": totals["tp"],
            "predicted": totals["predicted"],
            "gold": totals["gold_strict"],
            "macro_f1": sum(macro_m) / len(macro_m) if macro_m else None,
            "macro_documents": len(macro_m),
            "note": "precision counts a match to any gold row; recall leaves the coined rows out",
        },
        "coined": {
            "gold": totals["coined_gold"],
            "matched": totals["coined_matched"],
            "note": "labels absent from the body; judged apart (not wired)",
        },
        "type_accuracy": {
            "matched_ignoring_type": matched_untyped,
            "correct": correct,
            "accuracy": ratio(correct, matched_untyped),
            "confusion": {g: dict(sorted(c.items())) for g, c in sorted(confusion.items())},
        },
        "relations": {
            "directed": prf(totals["directed_tp"], totals["directed_predicted"], totals["directed_gold"]),
            "undirected": prf(totals["undirected_tp"], totals["undirected_predicted"], totals["undirected_gold"]),
            "labeled": prf(totals["labeled_tp"], totals["labeled_predicted"], totals["labeled_gold"]),
            "macro_f1_directed": sum(macro_r) / len(macro_r) if macro_r else None,
            "macro_documents": len(macro_r),
            "unresolved_ends": totals["unresolved_ends"],
            "note": "directed is primary; labels are ignored except in `labeled`",
        },
        "not_measured": ["count", "confidence", "domain", "released", "country", "description (needs a judge)"],
    }
    if details:
        report["details"] = {"summary": dict(sorted(groups.items())), **per_doc}
    write_report(out_path, report)
    logger.info(
        f"mentions P={fmt(p_m)} R={fmt(r_m)} F1={fmt(f1(p_m, r_m))}; relations directed F1={fmt(report['relations']['directed']['f1'])} "
        f"over {len(held)} documents -> {out_path}"
    )


def error_groups(s: dict) -> Counter:
    """The relation errors of one document by what holds them back: a relation counts only between two
    mentions matched with their type, so a missed end costs every relation that touches it."""
    gold_pairs, pred_pairs = s["pairs"]
    found = set(s["typed"].values())
    missed = gold_pairs - pred_pairs
    wrong = pred_pairs - gold_pairs
    ends = Counter((a in found) + (b in found) for a, b in missed)
    return Counter(
        {
            "missed_relations": len(missed),
            "missed_relations_both_ends_extracted": ends[2],
            "missed_relations_one_end_extracted": ends[1],
            "missed_relations_no_end_extracted": ends[0],
            "missed_relations_predicted_reversed": sum((b, a) in pred_pairs for a, b in missed),
            "false_positive_relations": len(wrong),
            "false_positive_relations_both_ends_gold": sum(isinstance(a, int) and isinstance(b, int) for a, b in wrong),
        }
    )


def document_details(gm, pm, pr, gr, s, doc_coined) -> dict:
    typed, untyped = s["typed"], s["untyped"]
    matched = set(typed.values())
    gold_pairs, pred_pairs = s["pairs"]
    label = lambda i: f"{gm[i]['name']} ({gm[i]['type']})"  # noqa: E731
    by_gold = {i: j for j, i in typed.items()}
    return {
        "missed_mentions": [label(i) for i in range(len(gm)) if i not in matched and i not in doc_coined],
        "false_positive_mentions": [f"{p.name} ({p.type})" for j, p in enumerate(pm) if j not in typed],
        "type_errors": [
            f"{gm[i]['name']}: gold {gm[i]['type']}, predicted {pm[j].type}" for j, i in untyped.items() if gm[i]["type"] != pm[j].type
        ],
        "missed_relations": sorted(f"{gm[a]['name']} -> {gm[b]['name']}" for a, b in gold_pairs - pred_pairs),
        "false_positive_relations": sorted(
            f"{gm[a]['name']} -> {gm[b]['name']}" if isinstance(a, int) and isinstance(b, int) else f"{a[1]} -> {b[1]}"
            for a, b in pred_pairs - gold_pairs
        ),
        "matched": {label(i): pm[j].name for i, j in sorted(by_gold.items())},
    }


if __name__ == "__main__":
    cli()
