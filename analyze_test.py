import itertools
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from analyze import collect, effects, family_table, full_vs_bare, interaction, interaction_p, lever_counts, permutation_p, pile_progress, report, stream_facts


def trajectory(*calls):
    return {"steps": [{"tool_calls": [{"function_name": n, "arguments": a} for n, a in calls]}]}


class LeverCounts(unittest.TestCase):
    def test_counts_each_lever(self):
        t = trajectory(
            ("Skill", {"skill": "inngest-steps"}),
            ("Skill", {"skill": "dataviz"}),
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
            lever_counts(t, frozenset({"inngest-steps"})),
            {"skill": 1, "other_skill": 1, "mcp_platform": 1, "mcp_docs": 3, "web_fetch": 1, "web_search": 1, "bash_fetch": 1,
             "workflow_skills": {"implement": 1, "tdd": 2}},
        )

    def test_empty(self):
        counts = lever_counts({"steps": [{"message": "hi"}]})
        self.assertEqual(counts.pop("workflow_skills"), {})
        self.assertEqual(sum(counts.values()), 0)


class StreamFacts(unittest.TestCase):
    # #53: a background task re-woke the session after its first result; Harbor took that result's cost.
    def test_a_rewoken_session_sums_turns_and_keeps_the_last_cost(self):
        events = [
            {"type": "result", "num_turns": 135, "total_cost_usd": 16.0, "duration_api_ms": 2155485, "subtype": "success"},
            {"type": "result", "num_turns": 23, "total_cost_usd": 16.0, "duration_api_ms": 2155485, "subtype": "success"},
            {"type": "result", "num_turns": 3, "total_cost_usd": 16.26, "duration_api_ms": 2168624, "subtype": "success",
             "terminal_reason": "completed"},
        ]
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "claude-code.txt"
            p.write_text("".join(json.dumps(e) + "\n" for e in events))
            facts = stream_facts(p)
        self.assertEqual((facts["num_turns"], facts["cost_usd"], facts["results"]), (161, 16.26, 3))
        self.assertEqual(facts["terminal_reason"], "completed")


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
                leak: int = 0, exception: str | None = None, stream: str = "", start: str = "2026-11-13T10:00:00Z",
                app_status: str = "ok") -> None:
    """A Harbor trial folder with the fields analyze.py reads."""
    skills, mcp = ARM_CONFIG[arm]
    t = jobs / job / name
    (t / "agent").mkdir(parents=True)
    (t / "artifacts").mkdir()
    (t / "artifacts" / "manifest.json").write_text(json.dumps([{"source": "/app", "status": app_status}]))
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
        # #52: /app failed to collect (an absolute symlink in a .venv), so the verifier graded a partial copy.
        write_trial(jobs, "inngest-bare", "partial", "inngest", "bare", 0.06, 15.8, start=late, app_status="failed")
        # A regrade of inngest-bare/t0 after a verifier fix: its rewards replace the source's.
        regrade = jobs / "regrade-bare" / "r0"
        regrade.mkdir(parents=True)
        regrade.joinpath("result.json").write_text(json.dumps({
            "task_name": "codeclimb/codeclimb-inngest", "finished_at": "2026-11-13T12:00:00Z", "started_at": "2026-11-13T11:30:00Z",
            "config": {"source_trial": {"action": "regrade", "path": str(jobs / "inngest-bare" / "t0")}},
            "verifier_result": {"rewards": {"reward": 0.25, "done": 0, "leak": 0, "checks.install": 1, "checks.cli-done": 0,
                                             "hidden.continue": 0, "real.budget": 1}},
        }))  # fmt: skip
        cls.rows = collect([jobs])
        cls.by_trial = {(r["job"], r["trial"]): r for r in cls.rows}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_one_row_per_trial(self):
        self.assertEqual(len(self.rows), 2 * 12 + 4 + 1)
        r = self.by_trial[("inngest-full", "t1")]
        self.assertEqual((r["stack"], r["arm"], r["workflow"], r["attempt"], r["effort"]), ("inngest", "full", "one-shot", 2, "medium"))
        self.assertEqual((r["reward"], r["checks"]["cli-done"], r["agent_s"], r["harness_version"]), (0.95, 1, 1800.0, "2.1.322"))

    def test_leak_and_usage_limit_kept_out_and_the_cap_counted(self):
        self.assertEqual(self.by_trial[("inngest-bare", "leaked")]["status"], "leak")
        limited = self.by_trial[("inngest-full", "limited")]
        self.assertEqual((limited["status"], limited["usage_limit"]), ("infra", True))
        partial = self.by_trial[("inngest-bare", "partial")]
        self.assertEqual((partial["status"], partial["artifacts_failed"]), ("infra", ["/app"]))
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

    def test_full_against_bare_works_without_the_middle_cells(self):  # #53: phase C runs only bare and full
        rows = [r for r in self.rows if r["stack"] == "langchain" and r["arm"] in ("bare", "full")]
        reward, cost = full_vs_bare(rows, "reward"), full_vs_bare(rows, "cost_usd")
        self.assertAlmostEqual(reward["value"], 0.7)
        self.assertAlmostEqual(reward["p"], 1 / 20)
        self.assertTrue(reward["call"].startswith("+ effect"))
        self.assertEqual((cost["p"], cost["call"]), (1.0, "not detectable at n = 3"))
        self.assertIn("langchain reward   full - bare +0.700", report(rows))

    def test_a_regrade_replaces_its_source(self):
        regrade = self.by_trial[("regrade-bare", "r0")]
        self.assertEqual((regrade["status"], regrade["arm"], regrade["reward"], regrade["cost_usd"]), ("counted", "bare", 0.25, 2.0))
        self.assertEqual(regrade["regrade_of"], "inngest-bare/t0")
        self.assertEqual(self.by_trial[("inngest-bare", "t0")]["status"], "regraded")
        # The hidden and real keys come with the regrade, beside the reward.
        self.assertEqual(regrade["families"], {"hidden.continue": 0, "real.budget": 1})
        self.assertEqual(self.by_trial[("inngest-bare", "t1")]["families"], {})

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
        self.assertIn("infra: 2, $17.30", text)


class SessionFile:
    """A Claude Code session file (agent/sessions/projects/-app/<id>.jsonl): per tool call, an assistant line with the
    tool_use (100 output tokens, so each call is an equal share of the trial's $) and a user line with its result."""

    T0 = datetime(2026, 11, 15, 10, 0, 0, tzinfo=timezone.utc)

    def __init__(self):
        self.lines: list[dict] = []

    def at(self, s: float) -> str:
        return (self.T0 + timedelta(seconds=s)).isoformat().replace("+00:00", "Z")

    def call(self, at: float, took: float, name: str, inp: dict, out: str = "", result: dict | None = None) -> "SessionFile":
        i = len(self.lines)
        self.lines.append({"type": "assistant", "timestamp": self.at(at), "message": {
            "id": f"msg_{i}", "usage": {"input_tokens": 0, "output_tokens": 100},
            "content": [{"type": "tool_use", "id": f"toolu_{i}", "name": name, "input": inp}]}})
        self.lines.append({"type": "user", "timestamp": self.at(at + took), "toolUseResult": result or {"stdout": out},
                           "message": {"content": [{"type": "tool_result", "tool_use_id": f"toolu_{i}", "content": out}]}})
        return self

    def bash(self, at: float, took: float, command: str, out: str = "", diff: dict | None = None) -> "SessionFile":
        return self.call(at, took, "Bash", {"command": command}, out, {"stdout": out, **({"bashEditDiff": diff} if diff else {})})

    def write(self, trial: Path) -> None:
        d = trial / "agent" / "sessions" / "projects" / "-app"
        d.mkdir(parents=True, exist_ok=True)
        (d / "s1.jsonl").write_text("".join(json.dumps(e) + "\n" for e in self.lines))


TSC = "src/a.ts(1,1): error TS2339: Property 'sendd' does not exist on type 'Inngest<{ id: string }>'.\nsrc/a.ts(2,1): error TS2304: Cannot find name 'x'."


class ProcessMetrics(unittest.TestCase):
    """One Inngest trial on the current specs with a session file of known edits, Bash writes, errors, milestones
    and SDK reads; $10 in all over 12 tool calls of equal tokens."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        jobs = Path(cls.tmp.name)
        write_trial(jobs, "e1-inngest-bare", "t0", "inngest", "bare", 1.0, 10.0, start="2026-11-15T10:00:00Z")
        trial = jobs / "e1-inngest-bare" / "t0"
        s = SessionFile()
        s.call(0, 1, "Read", {"file_path": "/app/node_modules/inngest/components/Inngest.d.ts"})
        s.bash(10, 1, "cat /docs/pi/README.md | head")
        s.call(20, 1, "Write", {"file_path": "/app/src/a.ts"}, result={"type": "create", "filePath": "/app/src/a.ts", "content": "x\n" * 10, "structuredPatch": []})
        s.bash(30, 5, "npx tsc --noEmit 2>&1 | head", TSC)
        s.bash(40, 5, "npx tsc --noEmit 2>&1 | head", TSC)  # the same errors, no file change between: thrash
        s.call(50, 1, "Edit", {"file_path": "/app/src/a.ts"}, result={"filePath": "/app/src/a.ts", "structuredPatch": [
            {"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 2, "lines": ["-x", "+y", "+z"]}]})
        s.bash(60, 5, "npx tsc --noEmit 2>&1 | head", TSC)  # after an edit: not thrash
        # A heredoc body is file content: its error line, echoed back by the command, is not a failure.
        s.bash(70, 1, "cat > /app/test/a.test.ts <<'EOF'\n// error TS9999: fake\nEOF\nnpm test 2>&1 | tail -3",
               "// error TS9999: fake\n# pass 4\n# fail 2",
               diff={"files": [{"filePath": "/app/test/a.test.ts", "created": True, "hunks": [
                   {"oldStart": 1, "oldLines": 0, "newStart": 1, "newLines": 3, "lines": ["+a", "+b", "+c"]}]}], "moreFiles": 1})
        s.bash(80, 1, "curl -s localhost:7421/api/nights", '{"nights":[]}')  # the worker API answers: services up
        s.bash(90, 20, "npm run run-night -- --config configs/capitals-smoke.yaml --mock --night-id n1 2>&1 | tail -2",
               "started night n1\ndone stop_reason=max_rounds rounds=1 night=n1")
        s.bash(120, 2, "npm run run-night -- --config configs/datenorm-smoke.yaml --mock --no-wait --night-id n5; sleep 1; pkill -f src/worker.ts",
               "started night n5")
        s.bash(130, 1, "ls runs-inngest/mock/datenorm-smoke/nights/n5", "done.json\nexps")
        s.write(trial)
        app = trial / "artifacts" / "app"
        (app / "src").mkdir(parents=True)
        (app / "test").mkdir()
        (app / "src" / "a.ts").write_text("y\nz\n" + "x\n" * 9)
        (app / "test" / "a.test.ts").write_text("a\nb\nc\n")
        cls.row = collect([jobs])[0]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_time_inside_and_outside_tool_calls_and_feedback_latency(self):
        r = self.row
        self.assertEqual((r["tool_s"], r["outside_tool_s"]), (44.0, 87.0))
        self.assertEqual(r["feedback_s"], 11.0)  # median of the two run-night calls, 20 s and 2 s

    def test_dollars_and_minutes_to_each_milestone(self):
        r = self.row
        # services up at 81 s, after 9 of the 12 calls' messages; night 1 done at 110 s (10); night 5 passes at 131 s (12).
        self.assertEqual((r["services_up_min"], r["services_up_usd"]), (1.35, 7.5))
        self.assertEqual((r["night1_done_min"], r["night1_done_usd"]), (1.83, 8.33))
        self.assertEqual((r["night5_pass_min"], r["night5_pass_usd"]), (2.18, 10.0))

    def test_rework_counts_writes_through_bash(self):
        # Write 10 lines, Edit +2, a heredoc through Bash +3: 15 lines written; the final files hold 11 + 3.
        self.assertEqual((self.row["lines_written"], self.row["final_lines"], self.row["rework_ratio"]), (15, 14, 1.071))
        # bashEditDiff names only some files a command changed; the rest are counted, so the ratio reads as a floor.
        self.assertEqual(self.row["unseen_bash_writes"], 1)

    def test_thrash_is_an_error_recurring_with_no_file_change_between(self):
        self.assertEqual(self.row["thrash"], 1)

    def test_failures_parsed_from_output_with_heredoc_bodies_cut(self):
        r = self.row
        self.assertEqual((r["ts_errors"], r["ts_failed_runs"]), (6, 3))  # TS9999, echoed from a heredoc body, is not one
        self.assertEqual((r["test_failures"], r["test_failed_runs"]), (2, 1))
        self.assertEqual(r["sdk_type_errors"], 3)  # TS2339 on `Inngest<...>`, once per run; TS2304 names no SDK symbol

    def test_reads_of_the_stack_sdk_and_the_pi_docs(self):
        self.assertEqual((self.row["sdk_reads"], self.row["pi_doc_reads"]), (1, 1))

    def test_never_in_the_reward(self):
        self.assertEqual(self.row["reward"], 1.0)
        self.assertEqual(self.row["checks"], {"install": 1, "cli-done": 1})


class OldSpecs(unittest.TestCase):
    """Phase B to D2 trials ran on the old build specs: labelled, and never pooled with current-spec trials."""

    def test_labelled_and_kept_apart_in_the_report(self):
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d)
            write_trial(jobs, "c-inngest-bare", "old", "inngest", "bare", 1.0, 4.0, start="2026-11-13T21:51:00Z")
            write_trial(jobs, "e1-inngest-bare", "new", "inngest", "bare", 1.0, 8.0, start="2026-11-14T17:50:00Z")
            for name, took in (("old", 30), ("new", 10)):
                SessionFile().bash(0, took, "npm run run-night -- --config configs/capitals-smoke.yaml --mock --night-id n1",
                                   "done stop_reason=max_rounds").write(jobs / f"{'c' if name == 'old' else 'e1'}-inngest-bare" / name)
            rows = collect([jobs])
            text = report(rows)
        self.assertEqual({r["trial"]: r["specs"] for r in rows}, {"old": "old specs", "new": "current"})
        self.assertIn("inngest   current   n=1 in tools 10 s outside 0 s feedback 10.0 s", text)
        self.assertIn("inngest   old specs n=1 in tools 30 s outside 0 s feedback 30.0 s", text)
        self.assertIn("c-inngest-bare/old inngest bare one-shot old specs", text)
        self.assertIn("build trials: 2 (old specs 1)", text)


class SpecReporter(unittest.TestCase):
    def test_test_failures_from_the_node_spec_reporter(self):  # the trials' `npm test` prints `ℹ fail N`, not TAP
        with tempfile.TemporaryDirectory() as d:
            jobs = Path(d)
            write_trial(jobs, "e1-langchain-bare", "t0", "langchain", "bare", 1.0, 8.0, start="2026-11-15T10:00:00Z")
            SessionFile().bash(0, 3, "npm test 2>&1 | tail -4", "ℹ tests 5\nℹ pass 4\nℹ fail 1").write(jobs / "e1-langchain-bare" / "t0")
            r = collect([jobs])[0]
        self.assertEqual((r["test_failures"], r["test_failed_runs"]), (1, 1))


class Families(unittest.TestCase):
    def row(self, arm: str, fams: dict, status: str = "counted") -> dict:
        return {"status": status, "stack": "inngest", "workflow": "one-shot", "arm": arm, "families": fams}

    def test_share_per_family_and_failing_tests_per_cell(self):
        rows = [
            self.row("bare", {"hidden.a": 1, "hidden.b": 0, "real.x": 1, "real.y": 1}),
            self.row("bare", {"hidden.a": 1, "hidden.b": 1, "real.x": 0}),  # real.y did not run: no key
            self.row("bare", {"hidden.a": 0}, status="leak"),
            self.row("full", {}),
        ]
        text = "\n".join(family_table(rows))
        self.assertIn("inngest   one-shot bare      n=2 passed [0.75, 0.667] mean 0.708; hidden 0.750 (2-2 tests); real 0.500 (1-2 tests)", text)
        self.assertIn("failed at least once: hidden.b 1/2, real.x 1/2", text)
        self.assertIn("without hidden or real keys (graded before them; regrade to add): 1", text)
        self.assertNotIn("full", text.split("without")[0])

    def test_no_keys_anywhere(self):
        self.assertEqual(family_table([self.row("bare", {})]),
                         ["counted trials without hidden or real keys (graded before them; regrade to add): 1"])


if __name__ == "__main__":
    unittest.main()
