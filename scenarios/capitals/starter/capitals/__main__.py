import json
import os
import sys
import urllib.request

MODEL = "github-copilot/claude-haiku-4.5"


def ask(country: str) -> str | None:
    """One chat completion per country."""
    req = urllib.request.Request(
        os.environ["OPENAI_BASE_URL"].rstrip("/") + "/chat/completions",
        data=json.dumps(
            {
                "model": MODEL,
                "max_tokens": 20,
                "messages": [
                    {"role": "system", "content": "Answer with the capital city's name only."},
                    {"role": "user", "content": f"What is the capital of {country}?"},
                ],
            }
        ).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + os.environ["OPENAI_API_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=50) as res:
        text = json.load(res)["choices"][0]["message"]["content"]
    return text.strip().rstrip(".") or None


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
            out = {"id": item.get("id"), "capital": ask(item.get("country", ""))}
        except Exception as exc:  # never crash on bad input
            print(f"error: {exc}", file=sys.stderr)
            out = {"id": None, "capital": None}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
