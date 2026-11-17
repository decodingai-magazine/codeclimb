"""Tests for gate.py. Run: python3 -m unittest gate_test"""

import json
import tempfile
import unittest
from pathlib import Path

from gate import Run, gate, import_hops, runs_from_jobs

TARGETS = ("backstop-mid-step", "pause-timeout")


def run(passed: dict[str, int], typecheck: int = 1, seconds: float = 50.0) -> Run:
    reward = {"checks.services-up": 1, "checks.typecheck": typecheck, "checks.unit-tests": 1,
              **{f"hidden.{t}": v for t, v in passed.items()}}
    return Run(reward=reward, seconds={t: seconds for t in passed})


PASS = {t: 1 for t in TARGETS}
FAIL = {t: 0 for t in TARGETS}


def stack(base=None, task=None) -> dict[str, list[Run]]:
    return {"base": base or [run(PASS)] * 3, "task": task or [run(FAIL)] * 3}


FIX = {"inngest": {"lines": 20, "files": 2}, "langchain": {"lines": 15, "files": 1}}
HOPS = {"inngest": 2, "langchain": 3}


class Gate(unittest.TestCase):
    def test_pass(self):
        v = gate(TARGETS, {"inngest": stack(), "langchain": stack()}, FIX, HOPS)
        self.assertTrue(v["pass"], v["reasons"])
        self.assertEqual(v["stacks"]["inngest"]["failing"], sorted(TARGETS))
        self.assertEqual(v["stacks"]["langchain"]["hops"], 3)
        self.assertEqual(v["stacks"]["inngest"]["reproduce_s"], 100.0)
        self.assertEqual(v["stacks"]["inngest"]["fix"], {"lines": 20, "files": 2})

    def test_base_fails_a_target(self):
        base = [run(PASS), run({**PASS, "pause-timeout": 0}), run(PASS)]
        v = gate(TARGETS, {"inngest": stack(base=base), "langchain": stack()}, FIX, HOPS)
        self.assertFalse(v["pass"])
        self.assertIn("inngest: base passes pause-timeout 2 of 3", v["reasons"])

    def test_task_commit_passes_a_target(self):
        task = [run(FAIL), run(FAIL), run({**FAIL, "backstop-mid-step": 1})]
        v = gate(TARGETS, {"inngest": stack(), "langchain": stack(task=task)}, FIX, HOPS)
        self.assertFalse(v["pass"])
        self.assertIn("langchain: task commit fails backstop-mid-step 2 of 3", v["reasons"])
        self.assertEqual(v["stacks"]["langchain"]["failing"], ["pause-timeout"])

    def test_different_failing_sets(self):
        task = [run({**FAIL, "backstop-mid-step": 1})] * 3
        v = gate(TARGETS, {"inngest": stack(), "langchain": stack(task=task)}, FIX, HOPS)
        self.assertFalse(v["pass"])
        self.assertIn("failing sets differ: inngest ['backstop-mid-step', 'pause-timeout'], langchain ['pause-timeout']",
                      v["reasons"])

    def test_fix_more_than_twice_as_large(self):
        fix = {"inngest": {"lines": 65, "files": 7}, "langchain": {"lines": 13, "files": 2}}
        v = gate(TARGETS, {"inngest": stack(), "langchain": stack()}, fix, HOPS)
        self.assertFalse(v["pass"])
        self.assertIn("fix sizes differ more than 2x: inngest 65 lines, langchain 13 lines", v["reasons"])

    def test_a_target_that_did_not_run_is_not_a_failure(self):
        missing = Run(reward={"checks.services-up": 0, "checks.typecheck": 1, "checks.unit-tests": 1}, seconds={})
        v = gate(TARGETS, {"inngest": stack(task=[run(FAIL), run(FAIL), missing]), "langchain": stack()}, FIX, HOPS)
        self.assertFalse(v["pass"])
        self.assertIn("inngest: task run 3: services not up", v["reasons"])
        self.assertIn("inngest: task commit fails backstop-mid-step 2 of 3", v["reasons"])

    def test_typecheck_must_stay_green(self):
        base = [run(PASS), run(PASS, typecheck=0), run(PASS)]
        v = gate(TARGETS, {"inngest": stack(base=base), "langchain": stack()}, FIX, HOPS)
        self.assertIn("inngest: base run 2: typecheck failed", v["reasons"])

    def test_three_runs_each(self):
        v = gate(TARGETS, {"inngest": stack(base=[run(PASS)] * 2), "langchain": stack()}, FIX, HOPS)
        self.assertIn("inngest: 2 base runs, not 3", v["reasons"])


class ImportHops(unittest.TestCase):
    FILES = {
        "src/cli/run-night.ts": "import { loop } from '../night/loop.ts';\nimport x from 'yaml';\n",
        "src/night/loop.ts": "export { hook } from './hook.js';\nconst p = await import('./pause');\n",
        "src/night/hook.ts": "export const hook = 1;\n",
        "src/night/pause/index.ts": "export const p = 1;\n",
        "src/orphan.ts": "export const o = 1;\n",
    }

    def test_hops_from_the_entry(self):
        self.assertEqual(import_hops(self.FILES, "src/cli/run-night.ts", ["src/cli/run-night.ts"]), 0)
        self.assertEqual(import_hops(self.FILES, "src/cli/run-night.ts", ["src/night/hook.ts"]), 2)
        self.assertEqual(import_hops(self.FILES, "src/cli/run-night.ts", ["src/night/pause/index.ts"]), 2)
        self.assertEqual(import_hops(self.FILES, "src/cli/run-night.ts", ["src/night/hook.ts", "src/night/loop.ts"]), 1)

    def test_unreachable(self):
        self.assertIsNone(import_hops(self.FILES, "src/cli/run-night.ts", ["src/orphan.ts"]))


class RunsFromJobs(unittest.TestCase):
    def test_reads_reference_trials_by_stack_and_commit(self):
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d)
            for job, trial, reward in [
                ("reference-inngest-bcabd72-101010", "codeclimb-inngest__a", {"hidden.pause-timeout": 1}),
                ("reference-inngest-bcabd72-101010", "codeclimb-inngest__b", {"hidden.pause-timeout": 1}),
                ("reference-langchain-9567643-111111", "codeclimb-langchain__a", {"hidden.pause-timeout": 0}),
            ]:
                v = jobs / job / trial / "verifier"
                v.mkdir(parents=True)
                (v / "reward.json").write_text(json.dumps(reward))
                (v / "checks.json").write_text(json.dumps({"families": [{"name": "hidden.pause-timeout", "seconds": 61.5}]}))
            (jobs / "reference-inngest-bcabd72-101010" / "result.json").write_text("{}")
            runs = runs_from_jobs([jobs])
        self.assertEqual(sorted(runs), [("inngest", "bcabd72"), ("langchain", "9567643")])
        self.assertEqual(len(runs[("inngest", "bcabd72")]), 2)
        self.assertEqual(runs[("langchain", "9567643")][0].seconds, {"pause-timeout": 61.5})


if __name__ == "__main__":
    unittest.main()
