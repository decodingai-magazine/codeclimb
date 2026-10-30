"""capitals scorer (score_cmd). Runs on the worker host; reads gold from --items.

    python3 score.py --items <jsonl> --outputs <dir> --out metrics.json

Writes every metric plus `per_item` ({id: 0|1} primary scores). Latency and
cost are codeclimb's standard metrics, computed outside the scorer.
"""

import argparse
import json
import os


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

    per_item, violations = {}, 0
    for item in items:
        o = outputs.get(item["id"])
        answer, valid = None, False
        if o is not None and o.get("raw") is not None:
            try:
                parsed = json.loads(o["raw"])
                answer = parsed.get("capital") if isinstance(parsed, dict) else None
                valid = isinstance(parsed, dict) and parsed.get("id") == item["id"] and (answer is None or isinstance(answer, str))
            except json.JSONDecodeError:
                valid = False
        if not valid:
            violations += 1
        per_item[item["id"]] = int(valid and isinstance(answer, str) and answer.strip().lower() == item["gold"].lower())

    n = len(items)
    metrics = {
        "accuracy": round(sum(per_item.values()) / n, 4) if n else 0.0,
        "schema_violations": violations,
        "n_items": n,
        "per_item": per_item,
    }
    with open(args.out, "w") as f:
        json.dump(metrics, f, indent=2)


if __name__ == "__main__":
    main()
