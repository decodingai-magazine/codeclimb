"""Tests for the pure parts of the platform tests on synthetic files. Run: cd verifier && python3 -m unittest platform_tests_test"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import families
import platform_tests as P
from durability_tests import Broken
from nights import Night

SCENARIO_YAML = """name: datenorm
image: codeclimb-python
bundle: python3 scripts/export_agent.py --out {out}
stages:
  - name: answer
    run: python3 /eval/run.py --queries {inputs} --repo /repo --out {out}
"""


class FakeAdapter:
    SERVICES_UP_S = 1

    def __init__(self, env: Path, up: bool = True):
        self.env, self.up, self.seen = env, up, []

    def stop_services(self, services):
        self.seen.append(("stop", self.env.read_text() if self.env.exists() else None))

    def start_services(self, app):
        return "services"

    def wait_until_up(self, services, timeout_s):
        return self.up, "fake"

    def service_logs(self, services):
        return ""


class Platform(unittest.TestCase):
    def setUp(self):
        self.app = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.app)
        (self.app / "scenarios/datenorm/starter").mkdir(parents=True)
        (self.app / "scenarios/datenorm/scenario.yaml").write_text(SCENARIO_YAML)

    def ctx(self, adapter=None):
        return SimpleNamespace(app=self.app, adapter=adapter, services=None, ensure_services=lambda: (True, ""))

    def test_scenario_copy_edits_and_renames(self):
        rel = P.scenario_copy(self.ctx(), "fail-init", lambda t: t.replace("bundle: python3 scripts/export_agent.py --out {out}", "bundle: exit 1"))
        self.assertEqual(rel, "scenarios/verifier-fail-init")
        text = (self.app / rel / "scenario.yaml").read_text()
        self.assertIn("bundle: exit 1", text)
        self.assertTrue(text.startswith("name: verifier-fail-init\n"))
        self.assertTrue((self.app / rel / "starter").is_dir())
        # The given scenario is untouched.
        self.assertEqual((self.app / "scenarios/datenorm/scenario.yaml").read_text(), SCENARIO_YAML)

    def test_scenario_copy_refuses_an_edit_that_misses(self):
        with self.assertRaises(Broken):
            P.scenario_copy(self.ctx(), "x", lambda t: t)

    def test_slow_stage_edit_matches_the_given_scenario(self):
        given = Path(__file__).resolve().parent.parent / "scenarios/datenorm/scenario.yaml"
        if not given.exists():
            self.skipTest("no given scenarios here")
        text = given.read_text()
        self.assertIn("run: python3 /eval/run.py", text)
        self.assertIn("bundle: python3 scripts/export_agent.py --out {out}", text)

    def test_with_hooks_writes_then_restores_env(self):
        env = self.app / ".env"
        env.write_text("LANGSMITH_API_KEY=x")
        adapter = FakeAdapter(env)
        seen = {}

        @P.with_hooks({"CODECLIMB_BACKSTOP_S": "30"})
        def fn(ctx):
            seen["env"] = env.read_text()
            return True, "ran"

        self.assertEqual(fn(self.ctx(adapter)), (True, "ran"))
        self.assertEqual(seen["env"], "LANGSMITH_API_KEY=x\nCODECLIMB_BACKSTOP_S=30\n")
        self.assertEqual(env.read_text(), "LANGSMITH_API_KEY=x")
        # Restarted with the hooks in, then again after they were taken out.
        self.assertEqual([e for _, e in adapter.seen], ["LANGSMITH_API_KEY=x\nCODECLIMB_BACKSTOP_S=30\n", "LANGSMITH_API_KEY=x"])

    def test_with_hooks_removes_an_env_it_created_even_on_failure(self):
        env = self.app / ".env"
        adapter = FakeAdapter(env)

        @P.with_hooks({"CODECLIMB_MOCK_CREDIT": "coder:1"})
        def fn(ctx):
            raise RuntimeError("boom")

        with self.assertRaises(RuntimeError):
            fn(self.ctx(adapter))
        self.assertFalse(env.exists())

    def test_stop_reason_and_r1_row(self):
        nt = Night(0, "c.yaml", "t1", "d", self.app / "runs", 0, "")
        self.assertIsNone(P.stop_reason(nt))
        nt.night_dir.mkdir(parents=True)
        (nt.night_dir / "stop.json").write_text("{")
        self.assertIsNone(P.stop_reason(nt))  # being written
        (nt.night_dir / "stop.json").write_text(json.dumps({"reason": "cancelled"}))
        self.assertEqual(P.stop_reason(nt), "cancelled")
        self.assertFalse(P.r1_row(nt))
        (nt.dir / "results.jsonl").write_text(json.dumps({"night_id": "t1", "kind": "experiment", "exp_id": "t1-r1-e0"}) + "\n")
        self.assertTrue(P.r1_row(nt))

    def test_names_tiers_and_order(self):
        self.assertEqual([t.name for t in P.TESTS], [
            "continue-after-stop", "outside-cancel", "fail-at-init", "eval-keeps-failing", "hard-deadline-mid-step",
            "kill-after-row", "stop-then-crash", "backstop-mid-step", "pause-timeout", "pause-resume",
        ])
        # Driven by a config key, not a hook in .env: it needs no restart of the services.
        self.assertEqual(next(t.tier for t in P.TESTS if t.name == "hard-deadline-mid-step"), "hidden-3a")
        self.assertTrue(all(t.tier in families.TIERS for t in P.TESTS))
        # The hook tests run last of all.
        self.assertEqual(families.TIERS[-1], "hidden-4")
        self.assertEqual({t.tier for t in P.TESTS if "pause" in t.name or "backstop" in t.name}, {"hidden-4"})


if __name__ == "__main__":
    unittest.main()
