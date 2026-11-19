"""regrade.py's choice of trials on a fixture jobs folder. No regrade is run."""

import json
import tempfile
import unittest
from pathlib import Path

from regrade import due


def trial(job: Path, name: str, task: str = "tasks/codeclimb-inngest", done: float | None = 0, app: bool = True,
          usage_limit: bool = False, source: Path | None = None, finished: bool = True) -> Path:
    d = job / name
    (d / "agent").mkdir(parents=True)
    if app:
        (d / "artifacts" / "app").mkdir(parents=True)
    cfg = {"task": {"path": task}}
    if source is not None:
        cfg["source_trial"] = {"action": "regrade", "path": str(source)}
    (d / "config.json").write_text(json.dumps(cfg))
    rewards = {} if done is None else {"reward": done, "done": done}
    (d / "result.json").write_text(json.dumps({"finished_at": "x" if finished else None,
                                               "verifier_result": {"rewards": rewards}}))
    event = {"type": "assistant", "error": "rate_limit"} if usage_limit else {"type": "result", "subtype": "success"}
    (d / "agent" / "claude-code.txt").write_text(json.dumps(event) + "\n")
    return d


class Due(unittest.TestCase):
    def test_not_done_build_trials_on_both_stacks_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            jobs, regrades = Path(tmp) / "jobs", Path(tmp) / "regrades"
            a = trial(jobs, "a")  # done 0: due
            b = trial(jobs, "b", task="tasks/codeclimb-langchain", done=None)  # no reward: due
            trial(jobs, "c", done=1)  # done
            trial(jobs, "d", usage_limit=True)  # infra
            trial(jobs, "e", app=False)  # /app not collected
            trial(jobs, "f", task="tasks/codeclimb-inngest-r2")  # a maintenance task
            trial(jobs, "g", finished=False)  # still running
            g = trial(jobs, "h")
            trial(regrades, "h-regrade", source=g)  # already regraded once
            self.assertEqual(due([jobs], regrades), [(a, "inngest"), (b, "langchain")])
            self.assertEqual(due([regrades], regrades), [])  # a regrade is never regraded


if __name__ == "__main__":
    unittest.main()
