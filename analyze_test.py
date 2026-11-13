import itertools
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from analyze import collect, effects, interaction, interaction_p, lever_counts, permutation_p, pile_progress, report


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


SKILLS = ["context/inngest/skills/inngest-steps"]
MCP = [{"name": "inngest-dev", "transport": "streamable-http", "url": "http://127.0.0.1:8288/mcp"}]
ARM_CONFIG = {"bare": ([], []), "skills": (SKILLS, []), "mcp-docs": ([], MCP), "full": (SKILLS, MCP)}


def write_trial(jobs: Path, job: str, name: str, stack: str, arm: str, reward: float | None, cost: float, *,
                leak: int = 0, exception: str | None = None, stream: str = "", start: str = "2026-11-13T10:00:00Z") -> None:
    """A Harbor trial folder with the fields analyze.py reads."""
    skills, mcp = ARM_CONFIG[arm]
    t = jobs / job / name
    (t / "agent").mkdir(parents=True)
    rewards = None if reward is None else {"reward": reward, "done": int(reward == 1), "leak": leak, "checks.install": 1, "checks.cli-done": int(reward > 0.5)}
    (t / "result.json").write_text(json.dumps({
        "task_name": f"codeclimb/codeclimb-{stack}",
        "task_id": {"path": f"tasks/codeclimb-{stack}"},
        "config": {"agent": {"name": "claude-code", "model_name": "anthropic/claude-opus-5-5", "skills": skills, "mcp_servers": mcp,
                             "kwargs": {"reasoning_effort": "medium"}}, "environment": {"extra_docker_compose": []}},
        "agent_info": {"version": "2.1.322", "model_info": {"name": "claude-opus-5-5"}},
        "agent_result": {"cost_usd": cost, "n_input_tokens": 10, "n_output_tokens": 2, "n_cache_tokens": 5},
        "verifier_result": None if rewards is None else {"rewards": rewards},
        "exception_info": None if exception is None else {"exception_type": exception},
        "agent_execution": {"started_at": start, "finished_at": start.replace("10:00", "10:30")},
        "started_at": start, "finished_at": start.replace("10:00", "11:00"),
    }))  # fmt: skip
    (t / "agent" / "claude-code.txt").write_text(stream)


class Trials(unittest.TestCase):
    """A synthetic jobs folder with a known effect: skills on scores about 0.95, off about 0.25; MCP + docs does
    nothing; agent $ is equal in every arm."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        jobs = Path(cls.tmp.name)
        for stack in ("inngest", "langchain"):
            for arm in ARM_CONFIG:
                base = [0.9, 0.95, 1.0] if arm in ("skills", "full") else [0.2, 0.25, 0.3]
                for i, r in enumerate(base):
                    write_trial(jobs, f"{stack}-{arm}", f"t{i}", stack, arm, r, 2.0, start=f"2026-11-13T10:00:0{i}Z")
        late = "2026-11-13T10:00:09Z"
        write_trial(jobs, "inngest-bare", "leaked", "inngest", "bare", 1.0, 3.0, leak=1, start=late)
        write_trial(jobs, "inngest-full", "limited", "inngest", "full", 0.0, 1.5, exception="NonZeroAgentExitCodeError", start=late,
                    stream='{"type":"assistant","error":"rate_limit"}\n{"type":"result","num_turns":4,"subtype":"error"}\n')
        write_trial(jobs, "inngest-full", "capped", "inngest", "full", 1.0, 9.0, exception="NonZeroAgentExitCodeError", start=late,
                    stream='{"type":"result","num_turns":40,"subtype":"error_max_budget_usd"}\n')
        # A regrade of inngest-bare/t0 after a verifier fix: its rewards replace the source's.
        regrade = jobs / "regrade-bare" / "r0"
        regrade.mkdir(parents=True)
        regrade.joinpath("result.json").write_text(json.dumps({
            "task_name": "codeclimb/codeclimb-inngest", "finished_at": "2026-11-13T12:00:00Z", "started_at": "2026-11-13T11:30:00Z",
            "config": {"source_trial": {"action": "regrade", "path": str(jobs / "inngest-bare" / "t0")}},
            "verifier_result": {"rewards": {"reward": 0.25, "done": 0, "leak": 0, "checks.install": 1, "checks.cli-done": 0}},
        }))  # fmt: skip
        cls.rows = collect([jobs])
        cls.by_trial = {(r["job"], r["trial"]): r for r in cls.rows}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_row_per_trial(self):
        self.assertEqual(len(self.rows), 2 * 12 + 3 + 1)
        r = self.by_trial[("inngest-full", "t1")]
        self.assertEqual((r["stack"], r["arm"], r["workflow"], r["attempt"], r["effort"]), ("inngest", "full", "one-shot", 2, "medium"))
        self.assertEqual((r["reward"], r["checks"]["cli-done"], r["agent_s"], r["harness_version"]), (0.95, 1, 1800.0, "2.1.322"))

    def test_leak_and_usage_limit_kept_out_and_the_cap_counted(self):
        self.assertEqual(self.by_trial[("inngest-bare", "leaked")]["status"], "leak")
        limited = self.by_trial[("inngest-full", "limited")]
        self.assertEqual((limited["status"], limited["usage_limit"]), ("infra", True))
        capped = self.by_trial[("inngest-full", "capped")]
        self.assertEqual((capped["status"], capped["result_subtype"], capped["reward_valid"]), ("counted", "error_max_budget_usd", False))

    def test_the_known_effect_is_called_and_no_effect_is_not(self):
        rows = [r for r in self.rows if r["stack"] == "langchain"]
        got = {(e["effect"], e["metric"]): e for e in effects(rows, "reward") + effects(rows, "cost_usd")}
        self.assertAlmostEqual(got[("skills", "reward")]["value"], 0.7)
        self.assertAlmostEqual(got[("skills", "reward")]["p"], 1 / 924)
        self.assertTrue(got[("skills", "reward")]["call"].startswith("+ effect"))
        self.assertEqual(got[("mcp-docs", "reward")]["call"], "not detectable at n = 3")
        self.assertEqual(got[("interaction", "reward")]["call"], "not detectable at n = 3")
        self.assertEqual(got[("skills", "cost_usd")]["p"], 1.0)

    def test_a_regrade_replaces_its_source(self):
        regrade = self.by_trial[("regrade-bare", "r0")]
        self.assertEqual((regrade["status"], regrade["arm"], regrade["reward"], regrade["cost_usd"]), ("counted", "bare", 0.25, 2.0))
        self.assertEqual(regrade["regrade_of"], "inngest-bare/t0")
        self.assertEqual(self.by_trial[("inngest-bare", "t0")]["status"], "regraded")

    def test_permutation_p_is_exact(self):
        self.assertAlmostEqual(permutation_p([3, 4, 5], [0, 1, 2])[0], 1 / 20)
        # A 1 in full or in bare gives the interaction +1: 2 of the 4 places.
        self.assertAlmostEqual(interaction_p({"bare": [0], "skills": [0], "mcp-docs": [0], "full": [1]})[0], 0.5)
        # Unequal cells take the full enumeration: 5! / (2! 1! 1! 1!) = 60 assignments, checked by brute force.
        cells = {"bare": [0, 1], "skills": [2], "mcp-docs": [0], "full": [3]}
        values = [0, 1, 2, 0, 3]
        perms = set(itertools.permutations(range(5)))
        stats = [interaction({"bare": [values[p[0]], values[p[1]]], "skills": [values[p[2]]], "mcp-docs": [values[p[3]]], "full": [values[p[4]]]}) for p in perms]
        want = sum(s >= interaction(cells) - 1e-12 for s in stats) / len(stats)
        self.assertAlmostEqual(interaction_p(cells)[0], want)

    def test_report_lists_cells_effects_and_both_stacks(self):
        text = report(self.rows)
        self.assertIn("inngest   one-shot full      n=4", text)  # the capped trial counts, the usage-limit one does not
        self.assertIn("shared checks: 2", text)
        self.assertIn("leak: 1, $3.00", text)
        self.assertIn("infra: 1, $1.50", text)


if __name__ == "__main__":
    unittest.main()
