"""regrade.py's choice of trials on a fixture jobs folder. No regrade is run."""

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from maintenance import FAMILIES
from regrade import due


class Due(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.jobs, self.regrades, self.refs = root / "jobs", root / "regrades", root / "refs"
        # A maintenance task as assemble.py writes it: its base and target tests.
        self.task = root / "tasks" / "codeclimb-inngest-r2"
        self.task.mkdir(parents=True)
        (self.task / "assembled.json").write_text(json.dumps({"base": "bcabd72", "targets": ["backstop-mid-step"]}))

    def tearDown(self):
        self.tmp.cleanup()

    def trial(self, job: Path, name: str, rewards: dict | None, task: str = "", stack: str = "inngest",
              app: bool = True, usage_limit: bool = False, source: Path | None = None, nop: bool = False) -> Path:
        d = job / name
        (d / "agent").mkdir(parents=True)
        if app:
            (d / "artifacts" / "app").mkdir(parents=True)
        cfg = {"agent": {"name": "nop" if nop else "claude-code", "kwargs": {}},
               "environment": {"extra_docker_compose": ["/x/reference.compose.yaml"] if nop else []}}
        if source is not None:
            cfg["source_trial"] = {"action": "regrade", "path": str(source)}
        (d / "result.json").write_text(json.dumps({
            "task_name": f"codeclimb/codeclimb-{stack}" + (f"-{task}" if task else ""),
            "task_id": {"path": str(self.task) if task else f"tasks/codeclimb-{stack}"},
            "config": cfg, "verifier_result": {"rewards": rewards or {}},
            "started_at": "2026-11-19T10:00:00Z", "finished_at": "2026-11-19T11:00:00Z"}))
        event = {"type": "assistant", "error": "rate_limit"} if usage_limit else {"type": "result", "subtype": "success"}
        (d / "agent" / "claude-code.txt").write_text(json.dumps(event) + "\n")
        return d

    def test_build_trials_not_done_on_both_stacks_once(self):
        a = self.trial(self.jobs, "a", {"reward": 0.5, "done": 0})  # done 0: due
        b = self.trial(self.jobs, "b", None, stack="langchain")  # no reward: due
        self.trial(self.jobs, "c", {"reward": 1, "done": 1})  # done
        self.trial(self.jobs, "d", {"reward": 0, "done": 0}, usage_limit=True)  # infra
        self.trial(self.jobs, "e", {"reward": 0, "done": 0}, app=False)  # /app not collected
        h = self.trial(self.jobs, "h", {"reward": 0, "done": 0})
        self.trial(self.regrades, "h-regrade", {"reward": 1, "done": 1}, source=h)  # already regraded once
        self.assertEqual(due([self.jobs], self.regrades),
                         [(a, "codeclimb-inngest", None), (b, "codeclimb-langchain", None)])
        self.assertEqual(due([self.regrades], self.regrades), [])  # a regrade is never regraded

    def test_maintenance_trials_not_resolved_against_the_base(self):
        base = {"reward": 1, "done": 1, "checks.cli-done": 1, "hidden.backstop-mid-step": 1}
        self.trial(self.refs / "reference-inngest-bcabd72-100000", "b1", base, nop=True)  # the base's grade: never due
        job = self.jobs / "all-r2-inngest"
        self.trial(job, "fixed", base, task="r2")
        unfixed = self.trial(job, "unfixed", {**base, "hidden.backstop-mid-step": 0}, task="r2")  # done 1, not resolved
        regressed = self.trial(job, "regressed", {**base, "checks.cli-done": 0}, task="r2")
        self.assertEqual(due([self.jobs, self.refs], self.regrades),
                         [(regressed, "codeclimb-inngest-r2", FAMILIES), (unfixed, "codeclimb-inngest-r2", FAMILIES)])

    def test_maintenance_trial_without_a_base_grade_is_not_regraded(self):
        self.trial(self.jobs / "all-r2-inngest", "t", {"reward": 1, "done": 1}, task="r2")
        with redirect_stderr(io.StringIO()) as err:
            self.assertEqual(due([self.jobs], self.regrades), [])
        self.assertIn("no base grade", err.getvalue())


if __name__ == "__main__":
    unittest.main()
