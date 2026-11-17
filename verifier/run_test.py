"""Tests for the verifier's outputs. Run: cd verifier && python3 -m unittest run_test"""

import json
import tempfile
import time
import unittest
from pathlib import Path

import run as R
from adapters import ADAPTERS


class RuntimeMetrics(unittest.TestCase):
    def test_runtime_goes_to_checks_json_never_to_the_reward(self):
        r = R.Run(app=Path("/nonexistent"), adapter=ADAPTERS["inngest"])
        r.record("install", True)
        r.runtime.update(night_s={"1": 12.0}, cold_start_s=4.2, resume_latency_s=8.5)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "reward.json"
            reward = R.write_outputs(r, out, "inngest", {"leak": 0, "sessions": 0}, time.monotonic())
            checks = json.loads((Path(tmp) / "checks.json").read_text())
            written = json.loads(out.read_text())
        self.assertEqual(checks["runtime"], {"night_s": {"1": 12.0}, "cold_start_s": 4.2, "resume_latency_s": 8.5})
        self.assertEqual(written, reward)
        self.assertEqual(reward["reward"], 1.0)
        self.assertFalse([k for k in reward if "night_s" in k or "latency" in k or "cold" in k])
        self.assertEqual([c["name"] for c in checks["checks"]], ["install"])


if __name__ == "__main__":
    unittest.main()
