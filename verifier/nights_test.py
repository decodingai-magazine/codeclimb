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

    def rows(self, nt: N.Night, rows: list[dict]) -> None:
        write(nt.dir / "results.jsonl", "\n".join(json.dumps({"night_id": nt.night_id, **r}) for r in rows) + "\n")

    def test_lost_connection_wants_an_error_then_clean_turns(self):
        nt = self.night(name="datenorm-smoke", n=6)
        exp = nt.night_dir / "exps/t1-r1-e0/session/s.jsonl"
        msg = lambda stop: json.dumps({"type": "message", "message": {"role": "assistant", "content": [], "stopReason": stop}})
        write(exp, "\n".join([msg("stop"), msg("error")]) + "\n")
        self.assertFalse(N.lost_connection(nt)[0])
        write(exp, "\n".join([msg("error"), msg("stop")]) + "\n")
        self.assertTrue(N.lost_connection(nt)[0])

    def test_graphrag_rows_allow_e1_only_after_an_e0_error(self):
        nt = self.night(name="graphrag-smoke", n=7)
        write(nt.night_dir / "done.json", {"rounds": 1})
        self.rows(nt, [
            {"exp_id": "t1-r1-e0", "kind": "experiment", "decision": "error"},
            {"exp_id": "t1-r1-e1", "kind": "experiment", "decision": "error"},
            {"exp_id": "t1-r0-starter", "kind": "test"},
        ])
        self.assertTrue(N.g_rows(nt)[0])
        self.rows(nt, [
            {"exp_id": "t1-r1-e0", "kind": "experiment", "decision": "discard"},
            {"exp_id": "t1-r1-e1", "kind": "experiment", "decision": "error"},
            {"exp_id": "t1-r0-starter", "kind": "test"},
        ])
        self.assertFalse(N.g_rows(nt)[0])

    def test_stage_metric_names(self):
        good = {f"{s}.{m}": 0 for s in N.STAGES for m in ("f1", "output_bytes")} | {"cost_usd": 0, "model_calls": 3, "latency_total_s": 1}
        self.assertTrue(N.stage_metric_names(good)[0])
        self.assertFalse(N.stage_metric_names(good | {"accuracy": 0})[0])
        self.assertFalse(N.stage_metric_names({k: v for k, v in good.items() if k != "graph.output_bytes"})[0])

    def test_graphrag_noise_only_if_kept(self):
        nt = self.night(name="graphrag-smoke", n=7)
        self.rows(nt, [{"exp_id": "t1-r1-e0", "kind": "experiment", "decision": "error"}])
        self.assertTrue(N.g_noise(nt)[0])
        write(nt.night_dir / "noise.json", {})
        self.assertFalse(N.g_noise(nt)[0])

    def test_graphrag_lessons_need_the_scenario_file_unchanged(self):
        app = self.root / "app"
        nt = N.Night(7, "configs/graphrag-smoke.yaml", "t1", "graphrag-smoke", app / "runs-x/mock/graphrag-smoke", 0, "done\n")
        write(nt.night_dir / "done.json", {"rounds": 2})
        d = nt.dir / "lessons/t1-r2"
        write(d / "lessons.md", "x")
        write(d / "changes.md", "x")
        write(d / "proposal.json", {"ops": [], "applied": False})
        write(app / N.GRAPHRAG_LESSONS, "lessons")
        nt.lessons_before = N.sha256_file(app / N.GRAPHRAG_LESSONS)
        self.assertTrue(N.g_lessons(nt)[0])
        write(app / N.GRAPHRAG_LESSONS, "changed")
        self.assertFalse(N.g_lessons(nt)[0])

    def test_results_name(self):
        write(self.root / "configs/x.yaml", "scenario: s\nresults_path: e2e-plateau/results.jsonl  # mock\n")
        self.assertEqual(N.results_name(self.root, "configs/x.yaml"), "e2e-plateau")


if __name__ == "__main__":
    unittest.main()
