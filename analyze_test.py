import subprocess
import tempfile
import unittest
from pathlib import Path

from analyze import lever_counts, pile_progress


def trajectory(*calls):
    return {"steps": [{"tool_calls": [{"function_name": n, "arguments": a} for n, a in calls]}]}


class LeverCounts(unittest.TestCase):
    def test_counts_each_lever(self):
        t = trajectory(
            ("Skill", {"skill": "inngest-steps"}),
            ("Skill", {"skill": "implement", "args": ".scratch/codeclimb/issues/01-a.md"}),
            ("Skill", {"skill": "tdd"}),
            ("Skill", {"skill": "tdd"}),
            ("mcp__inngest-dev__get_apps", {}),
            ("mcp__inngest-dev__grep_docs", {"pattern": "step.run"}),
            ("mcp__inngest-dev__read_doc", {}),
            ("mcp__langchain-docs__search_docs", {}),
            ("WebFetch", {"url": "https://www.inngest.com/llms.txt"}),
            ("WebSearch", {"query": "inngest"}),
            ("Bash", {"command": "curl -s https://www.inngest.com/llms-full.txt | head"}),
            ("Bash", {"command": "curl -s http://127.0.0.1:8288"}),
            ("Bash", {"command": "npm ci --ignore-scripts"}),
            ("ToolSearch", {"query": "select:mcp__inngest-dev__get_apps"}),
        )
        self.assertEqual(
            lever_counts(t),
            {"skill": 1, "mcp_platform": 1, "mcp_docs": 3, "web_fetch": 1, "web_search": 1, "bash_fetch": 1,
             "workflow_skills": {"implement": 1, "tdd": 2}},
        )

    def test_empty(self):
        counts = lever_counts({"steps": [{"message": "hi"}]})
        self.assertEqual(counts.pop("workflow_skills"), {})
        self.assertEqual(sum(counts.values()), 0)


class PileProgress(unittest.TestCase):
    def test_tickets_done_and_commits(self):
        with tempfile.TemporaryDirectory() as d:
            app = Path(d)
            issues = app / ".scratch/codeclimb/issues"
            issues.mkdir(parents=True)
            (issues / "README.md").write_text("**Status:** done\n")
            (issues / "01-a.md").write_text("# 01: a\n\n**Status:** done\n")
            (issues / "02-b.md").write_text("# 02: b\n\n**Status:** ready-for-agent\n")
            git = ["git", "-C", d, "-c", "user.name=t", "-c", "user.email=t@t"]
            subprocess.run(git[:3] + ["init", "-q"], check=True)
            for msg in ("given inputs", "01: a"):
                subprocess.run(git + ["commit", "-q", "--allow-empty", "-m", msg], check=True)
            self.assertEqual(pile_progress(app), {"tickets": 2, "tickets_done": 1, "commits": 1})


if __name__ == "__main__":
    unittest.main()
