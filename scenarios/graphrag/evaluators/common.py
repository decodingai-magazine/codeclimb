"""What the three evaluators share: gold loading, the split selection, the key and the report.

The held-out part is train, dev or test; its history is every document before it in log order
(README.md, Splits): none for train, train for dev, train and dev for test.
"""

import functools
import json
import random
import sys
from pathlib import Path

import click
from pydantic import BaseModel, ValidationError

ROOT = Path(__file__).resolve().parent.parent
GOLD = ROOT / "gold"
sys.path.insert(1, str(ROOT / "scripts"))
from compile import normalize, terminal_of  # noqa: E402  (the dataset's key function, README.md Identity)

__all__ = ["normalize", "terminal_of"]

BOOTSTRAP_RESAMPLES = 1000
BOOTSTRAP_SEED = 0


@functools.cache
def log_rows() -> tuple[dict, ...]:
    return tuple(json.loads(line) for line in (GOLD / "log.jsonl").read_text(encoding="utf-8").splitlines())


@functools.cache
def graph() -> dict:
    return json.loads((GOLD / "graph.json").read_text(encoding="utf-8"))


@functools.cache
def splits() -> dict:
    return json.loads((GOLD / "splits.json").read_text(encoding="utf-8"))


@functools.cache
def retrieval_rows() -> tuple[dict, ...]:
    return tuple(json.loads(line) for line in (GOLD / "retrieval.jsonl").read_text(encoding="utf-8").splitlines())


def keys(*names: str) -> set[str]:
    """Non-empty keys of the given surfaces; an empty key matches nothing (README.md, Identity, requirement 7)."""
    return {k for k in map(normalize, names) if k}


PARTS = ("train", "dev", "test")


def split_options(command):
    """`--split train|dev|test`: the part held out and scored."""
    return click.option("--split", "split_name", type=click.Choice(PARTS), required=True, help="Which part is held out and scored.")(
        command
    )


def held_out(split_name: str) -> tuple[list[str], list[str]]:
    """(history, held-out) document uris, both in log order. History is every document before the held-out part."""
    part = splits()["documents"][split_name]
    order = [r["doc_uri"] for r in log_rows() if r["kind"] == "document"]
    start = order.index(part[0])
    assert order[start : start + len(part)] == part, "splits.json: a held-out part is not contiguous in log order"
    return order[:start], part


def held_out_rows(split_name: str) -> list[str]:
    """Retrieval row ids of the held-out part, in file order."""
    return splits()["retrieval"][split_name]


def refuse_test_details(split_name: str, details: bool) -> None:
    """Test is scored once with the system frozen; per-item errors on it would invite tuning on it."""
    if details and split_name == "test":
        raise click.UsageError("--details is for train and dev only: test is scored once, without reading its errors")


def read_predictions[M: BaseModel](path: Path, model: type[M]) -> list[M]:
    """One JSON object per line, validated; a bad line fails with its line number."""
    out = []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            out.append(model.model_validate_json(line))
        except ValidationError as e:
            raise click.ClickException(f"{path}:{n}: {e}") from e
    return out


def write_jsonl(path: Path, rows) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(r, ensure_ascii=False) for r in rows]
    path.write_text("".join(f"{line}\n" for line in lines), encoding="utf-8")
    return len(lines)


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def split_header(split_name: str, history: int, held: int, unit: str) -> dict:
    return {"split": split_name, "splits_params": splits()["params"], f"history_{unit}": history, f"held_out_{unit}": held}


def ratio(a: int, b: int) -> float | None:
    """A ratio with an empty denominator does not apply: null, never zero."""
    return a / b if b else None


def f1(p: float | None, r: float | None) -> float | None:
    """Zero when either side is zero (nothing predicted, or nothing found); null when neither applies."""
    if p == 0 or r == 0:
        return 0.0
    if p is None or r is None:
        return None
    return 2 * p * r / (p + r) if p + r else 0.0


def prf(tp: int, predicted: int, gold: int) -> dict:
    """Precision, recall and F1 with their counts."""
    p, r = ratio(tp, predicted), ratio(tp, gold)
    return {"precision": p, "recall": r, "f1": f1(p, r), "tp": tp, "predicted": predicted, "gold": gold}


def fmt(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.3f}"


def mean_ci(values: list[float]) -> dict:
    """Mean with a percentile bootstrap 95% interval (seeded), over the values that apply."""
    if not values:
        return {"n": 0, "mean": None, "ci95": None}
    rng = random.Random(BOOTSTRAP_SEED)
    means = sorted(sum(rng.choices(values, k=len(values))) / len(values) for _ in range(BOOTSTRAP_RESAMPLES))
    lo, hi = means[int(0.025 * BOOTSTRAP_RESAMPLES)], means[int(0.975 * BOOTSTRAP_RESAMPLES) - 1]
    return {"n": len(values), "mean": sum(values) / len(values), "ci95": [lo, hi]}


def max_matching(candidates: list[list[int]], n_right: int) -> dict[int, int]:
    """Maximum one-to-one matching, left index -> right index. `candidates[i]` lists the right items
    left item i may take, best first; left items are tried in order, so the result is deterministic."""
    owner: list[int | None] = [None] * n_right

    def augment(i: int, seen: set[int]) -> bool:
        for j in candidates[i]:
            if j in seen:
                continue
            seen.add(j)
            if owner[j] is None or augment(owner[j], seen):
                owner[j] = i
                return True
        return False

    for i in range(len(candidates)):
        augment(i, set())
    return {i: j for j, i in enumerate(owner) if i is not None}
