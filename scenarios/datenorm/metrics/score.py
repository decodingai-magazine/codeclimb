"""datenorm scorer (score_cmd). Runs on the worker host; reads gold from --items.

    python3 score.py --items <jsonl> --outputs <dir> --out metrics.json

Writes every metric plus `per_item` ({id: 0|1} primary scores).
"""

import argparse
import json
import math
import os
import re

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FAMILIES = ["iso", "numeric", "textual_en", "textual_intl", "ordinal_words", "relative", "embedded", "invalid"]


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--items", required=True)
    ap.add_argument("--outputs", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    items = [json.loads(l) for l in open(args.items) if l.strip()]
    outputs = {}
    path = os.path.join(args.outputs, "outputs.jsonl")
    if os.path.exists(path):
        for line in open(path):
            if line.strip():
                o = json.loads(line)
                outputs[o["id"]] = o

    per_item, violations, latencies = {}, 0, []
    by_family: dict[str, list[int]] = {f: [] for f in FAMILIES}
    answered_null = null_correct = 0
    for i, item in enumerate(items):
        o = outputs.get(item["id"])
        answer, valid = None, False
        if o is not None and o.get("raw") is not None:
            try:
                parsed = json.loads(o["raw"])
                answer = parsed.get("date") if isinstance(parsed, dict) else None
                valid = (
                    isinstance(parsed, dict)
                    and parsed.get("id") == item["id"]
                    and (answer is None or (isinstance(answer, str) and DATE_RE.match(answer) is not None))
                )
            except json.JSONDecodeError:
                valid = False
            if i > 0:  # first answer is a warm-up
                latencies.append(o["latency_ms"])
        if not valid:
            violations += 1
        score = int(valid and answer == item["gold"])
        if valid and answer is None:
            answered_null += 1
            null_correct += int(item["gold"] is None)
        per_item[item["id"]] = score
        by_family.setdefault(item["family"], []).append(score)

    n = len(items)
    metrics = {
        "accuracy": round(sum(per_item.values()) / n, 4) if n else 0.0,
        **{f"acc_{f}": round(sum(v) / len(v), 4) for f, v in by_family.items() if v},
        "null_precision": round(null_correct / answered_null, 4) if answered_null else 1.0,
        "schema_violations": violations,
        "p50_ms": round(percentile(latencies, 0.5), 3),
        "p95_ms": round(percentile(latencies, 0.95), 3),
        "n_items": n,
        "per_item": per_item,
    }
    with open(args.out, "w") as f:
        json.dump(metrics, f, indent=2)


if __name__ == "__main__":
    main()
