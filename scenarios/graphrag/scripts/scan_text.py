"""Find the held-out names in a text bound for a coder (scenario.yaml `scan`, docs/scenario-contract.md).

    uv run python scripts/scan_text.py --text <file> --out <report.json>

Writes {"found": [...]}, the matches as the text has them: the ids `check_repo.py` forbids, dev-only
entity names, and dev and test queries copied whole. A paraphrase goes unseen.
"""

import json
import re
import sys
from pathlib import Path

import click

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from check_repo import dev_only_names, held_out_ids, pattern  # noqa: E402
from common import retrieval_rows, splits  # noqa: E402


def scan(text: str) -> list[str]:
    retrieval = splits()["retrieval"]
    outside = {*retrieval["dev"], *retrieval["test"]}
    queries = {r["query"] for r in retrieval_rows() if r["id"] in outside}
    return sorted({*pattern(held_out_ids()).findall(text), *pattern({*dev_only_names(), *queries}, re.IGNORECASE).findall(text)})


@click.command()
@click.option("--text", "text_path", type=click.Path(exists=True, dir_okay=False, path_type=Path), required=True, help="The text to scan.")
@click.option("--out", "out_path", type=click.Path(dir_okay=False, path_type=Path), required=True, help="The report to write.")
def main(text_path: Path, out_path: Path) -> None:
    out_path.write_text(json.dumps({"found": scan(text_path.read_text(encoding="utf-8"))}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
