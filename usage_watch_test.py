"""usage_watch.py on fixture streams: which trials count as stopped by the usage limit. No trial is run."""

import json
import tempfile
import unittest
from pathlib import Path

from usage_watch import usage_limited


def stream(trial: Path, *events: dict) -> None:
    (trial / "agent").mkdir(parents=True)
    (trial / "agent" / "claude-code.txt").write_text("".join(json.dumps(e) + "\n" for e in events))


class UsageLimited(unittest.TestCase):
    def test_finds_only_usage_limit_stops_under_the_prefix(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs = Path(tmp)
            ok = {"type": "result", "subtype": "success", "num_turns": 3}
            stream(jobs / "all-1200-inngest-bare" / "t1", {"type": "assistant", "error": "rate_limit"})
            stream(jobs / "all-1200-langchain-full" / "t2", {"type": "result", "api_error_status": 429})
            stream(jobs / "all-1200-inngest-full" / "t3", ok)
            stream(jobs / "all-1200-inngest-skills" / "t4", {"type": "assistant", "error": "authentication_failed"})
            stream(jobs / "all-0900-inngest-bare" / "t5", {"type": "assistant", "error": "billing_error"})  # another run
            self.assertEqual(usage_limited(str(jobs / "all-1200-*")),
                             [jobs / "all-1200-inngest-bare" / "t1", jobs / "all-1200-langchain-full" / "t2"])

    def test_none_while_streams_are_clean_or_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "all-1200-inngest-bare" / "t1").mkdir(parents=True)  # no stream yet
            self.assertEqual(usage_limited(str(Path(tmp) / "all-1200-*")), [])


if __name__ == "__main__":
    unittest.main()
