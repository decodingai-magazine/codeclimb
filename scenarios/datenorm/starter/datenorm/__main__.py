import json
import sys


def normalize(text: str, locale: str) -> str | None:
    """Return the date `text` refers to as YYYY-MM-DD, or None."""
    return None


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
            date = normalize(item.get("text", ""), item.get("locale", "US"))
            out = {"id": item.get("id"), "date": date}
        except Exception as exc:  # never crash on bad input
            print(f"error: {exc}", file=sys.stderr)
            out = {"id": None, "date": None}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
