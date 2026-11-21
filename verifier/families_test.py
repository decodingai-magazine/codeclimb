"""The verifier's own deadline (#69). Run: cd verifier && python3 -m unittest families_test"""

import os
import re
import time
import unittest
from pathlib import Path
from unittest import mock

import families as F
import real_tests as R

TASKS = Path(__file__).resolve().parents[1] / "tasks"


class Ctx:
    stack = "inngest"

    def ensure_services(self):
        return True, ""


class Deadline(unittest.TestCase):
    def run_two(self, left_s: float) -> tuple[list[tuple], int]:
        """Two hidden tests with `left_s` seconds left: what was recorded, and how often the reward files were written."""
        calls, writes = [], []
        tests = [F.Test(n, "hidden-1", lambda ctx: (True, "ok")) for n in ("a", "b")]
        with mock.patch.object(F, "all_tests", return_value=tests), \
             mock.patch.object(F, "STARTED", time.monotonic() - F.DEADLINE_S + left_s), \
             mock.patch.dict(os.environ, {"CODECLIMB_VERIFIER_FAMILIES": "hidden"}):
            F.run_families(Ctx(), lambda *a: calls.append(a), lambda: writes.append(1))
        return calls, len(writes)

    def test_tests_run_and_the_reward_is_written_after_each(self):
        calls, writes = self.run_two(F.DEADLINE_S)
        self.assertEqual([(c[0], c[1]) for c in calls], [("hidden.a", True), ("hidden.b", True)])
        self.assertEqual(writes, 3)  # after each test and after the tier

    def test_no_test_starts_past_the_deadline(self):
        calls, _ = self.run_two(F.START_LEFT_S - 1)
        self.assertEqual([(c[0], c[1]) for c in calls], [("hidden.a", False), ("hidden.b", False)])
        self.assertTrue(all(c[2].startswith(F.DEADLINE) for c in calls))

    def test_a_fail_on_a_cut_night_is_the_deadlines(self):
        cut, whole = R.Real("R2", cut=True), R.Real("R3")

        def reads(r):
            def fn(ctx):
                R._TOUCHED.append(r)
                return False, "no hypothesis"
            return fn

        self.assertTrue(R.guard(reads(cut))(Ctx())[1].startswith(F.DEADLINE))
        self.assertEqual(R.guard(reads(whole))(Ctx()), (False, "no hypothesis"))

    def test_each_real_night_records_its_time_and_end(self):
        # #70: checks.json's runtime holds each real night's seconds and how it ended.
        ends = {"R2": ("", False), "R3": ("neither done.json nor stop.json within 30 min", False),
                "R4": (f"{F.DEADLINE} stopped after 3 of its 40 min", True), "R5": ("run-night --no-wait exited 1", False)}

        def fake(ctx, key, real):
            real.error, real.cut = ends[key]
            real.night = object() if not real.error else None

        ctx = F.Ctx(app=Path("/x"), stack="inngest", adapter=None, services=None, tag="t-70")
        with mock.patch.object(R, "run_real", fake):
            for key in ends:
                R.real_night(ctx, key)
        self.assertEqual({k: v["end"] for k, v in ctx.runtime["real_nights"].items()},
                         {"R2": "ended", "R3": "cap", "R4": "deadline", "R5": "error"})
        self.assertTrue(all(isinstance(v["s"], float) for v in ctx.runtime["real_nights"].values()))

    def test_the_deadline_ends_before_harbors_limit(self):
        # Harbor collects nothing from a verifier it timed out: the deadline, then the services' stop and the writes,
        # must end before every build task's `[verifier] timeout_sec`.
        tomls = sorted(TASKS.glob("codeclimb-*/task.toml"))
        if not tomls:
            self.skipTest("no tasks/ next to verifier/")
        for toml in tomls:
            verifier = toml.read_text().partition("[verifier]")[2].partition("\n[")[0]
            limit = float(re.search(r"(?m)^timeout_sec = ([0-9.]+)", verifier).group(1))
            self.assertGreaterEqual(limit - F.DEADLINE_S, 1800, toml)


if __name__ == "__main__":
    unittest.main()
