"""Tests for the night checks on synthetic nights. Run: cd verifier && python3 -m unittest nights_test"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import nights as N


def write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data))


def session(path: Path, users: list[str]) -> None:
    lines = [{"type": "session"}]
    for u in users:
        lines.append({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": u}]}})
        lines.append({"type": "message", "message": {"role": "assistant", "content": [], "stopReason": "stop"}})
    write(path, "\n".join(json.dumps(x) for x in lines) + "\n")


SENDBACK = "You stopped with 9 of 10 minutes left."
WRAPUP = "Your time is nearly up: change no more code."


class NightChecks(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)

    def night(self, name: str = "capitals-smoke", nid: str = "t1", n: int = 1, output: str = "done\n") -> N.Night:
        return N.Night(n, f"configs/{name}.yaml", nid, name, self.root / name, 0, output)

    def test_meter_row_fails_on_an_error_call(self):
        # A broken metering path: run-night still prints done, only meter.jsonl shows it.
        nt = self.night()
        write(nt.night_dir / "evals/t1-r1-e0-eval/meter.jsonl", json.dumps({"model": "m"}) + "\n")
        self.assertTrue(N.meter_files(nt)[0])
        write(nt.night_dir / "evals/t1-test-r1/meter.jsonl", json.dumps({"model": "m", "error": "connect ECONNREFUSED"}) + "\n")
        self.assertFalse(N.meter_files(nt)[0])

    def test_meter_row_fails_on_no_calls(self):
        nt = self.night()
        write(nt.night_dir / "evals/t1-r1-e0-eval/meter.jsonl", "")
        self.assertFalse(N.meter_files(nt)[0])

    def test_no_leftover_sandbox_needs_done_json(self):
        nt = self.night(nid="nonexistent-night-zz")
        ok, detail = N.no_leftover_sandbox(nt)
        self.assertFalse(ok)
        self.assertIn("no done.json", detail)

    def test_sendbacks_then_one_wrapup(self):
        exp = self.root / "exp"
        session(exp / "session/s.jsonl", ["prompt"] + [SENDBACK] * 8 + [WRAPUP])
        self.assertTrue(N.sendbacks_then_wrapup(exp)[0])
        session(exp / "session/s.jsonl", ["prompt"] + [SENDBACK] * 7 + [WRAPUP])
        self.assertFalse(N.sendbacks_then_wrapup(exp)[0])
        session(exp / "session/s.jsonl", ["prompt", WRAPUP] + [SENDBACK] * 8)
        self.assertFalse(N.sendbacks_then_wrapup(exp)[0])

    def test_cli_done_wants_plateau_on_night_3(self):
        nt = self.night(name="e2e-plateau", n=3)
        write(nt.night_dir / "done.json", {"stop_reason": "max_rounds"})
        self.assertFalse(N.cli_done(nt)[0])
        write(nt.night_dir / "done.json", {"stop_reason": "plateau"})
        self.assertTrue(N.cli_done(nt)[0])

    def test_cli_done_needs_the_printed_done(self):
        nt = self.night(output="stopped\n")
        write(nt.night_dir / "done.json", {"stop_reason": "max_rounds"})
        self.assertFalse(N.cli_done(nt)[0])

    def test_keep_rule(self):
        nt = self.night(name="datenorm-smoke")
        rows = [
            {"night_id": "t1", "exp_id": "t1-r1-e0", "kind": "experiment", "round": 1, "decision": "keep", "metrics": {"accuracy": 0.125}},
            {"night_id": "t1", "exp_id": "t1-r1-e0", "kind": "noise", "round": 2, "decision": "keep"},
        ]
        write(nt.dir / "results.jsonl", "\n".join(json.dumps(r) for r in rows) + "\n")
        self.assertFalse(N.keep_rule(nt)[0])  # no noise.json yet
        write(nt.night_dir / "noise.json", {})
        self.assertTrue(N.keep_rule(nt)[0])

    def test_results_name(self):
        write(self.root / "configs/x.yaml", "scenario: s\nresults_path: e2e-plateau/results.jsonl  # mock\n")
        self.assertEqual(N.results_name(self.root, "configs/x.yaml"), "e2e-plateau")


if __name__ == "__main__":
    unittest.main()
