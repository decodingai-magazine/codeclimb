"""Tests for the leak scan on fixture trajectories (#45). Run: cd verifier && python3 -m unittest leak_test"""

import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

import blocked_hosts
import run
from leak import given_record, scan

ROOT = Path(__file__).resolve().parent.parent


def tool_use(tid: str, name: str, inp: dict) -> dict:
    return {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}}


def tool_result(tid: str, content: object) -> dict:
    return {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": content}]}}


SPEC = "Build it. The scaffold came from https://github.com/example/scaffold, see codeclimb.\n"


class LeakScan(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.app = self.root / "app"
        self.logs = self.root / "logs"
        (self.app / "src").mkdir(parents=True)
        (self.app / "SPEC.md").write_text(SPEC)
        (self.app / "package.json").write_text('{"name": "codeclimb"}\n')
        self.given = given_record(self.app)

    def session(self, events: list[dict], name: str = "s.jsonl") -> None:
        f = self.logs / "sessions" / "projects" / "-app" / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text("\n".join(json.dumps(e) for e in events) + "\n")

    def leak(self) -> int:
        return int(scan(self.app, self.logs, self.given)["leak"])

    # The given inputs name github.com and codeclimb: reading them is not a leak.
    def test_clean_and_reading_the_given_inputs(self):
        self.session([
            tool_use("1", "Read", {"file_path": "/app/SPEC.md"}),
            tool_result("1", SPEC),
            tool_use("2", "Bash", {"command": "cat /app/package.json && npm ci"}),
            tool_result("2", '{"name": "codeclimb"} ... https://github.com/npm/cli'),
            tool_use("3", "Write", {"file_path": "/app/src/index.ts", "content": "export const x = 1;\n"}),
        ])
        (self.app / "src/index.ts").write_text("export const x = 1;\n")
        self.assertEqual(self.leak(), 0)
        self.assertEqual(scan(self.app, self.logs, self.given)["sessions"], 1)

    def test_a_web_fetch_of_a_blocked_host(self):
        self.session([tool_use("1", "WebFetch", {"url": "https://raw.githubusercontent.com/x/y/main/a.ts", "prompt": "p"}),
                      tool_result("1", "WebFetch denied access to domain:raw.githubusercontent.com.")])
        self.assertEqual(self.leak(), 1)

    def test_a_shell_command_naming_one(self):
        self.session([tool_use("1", "Bash", {"command": "git clone https://github.com/x/y /tmp/y"})])
        self.assertEqual(self.leak(), 1)

    def test_a_docker_run_naming_one(self):
        self.session([tool_use("1", "Bash", {"command": "docker run --rm curlimages/curl -s https://api.github.com/repos/x/y"})])
        self.assertEqual(self.leak(), 1)

    def test_a_file_the_harness_wrote(self):
        (self.app / "src/fetch.ts").write_text("const url = 'https://deepwiki.com/x/y';\n")
        self.assertEqual(self.leak(), 1)

    def test_a_given_file_edited_to_name_one_more(self):
        (self.app / "SPEC.md").write_text(SPEC + "Mirror: https://github.com/x/y\n")
        self.assertEqual(self.leak(), 1)

    def test_a_given_file_edited_without_a_new_name(self):
        (self.app / "SPEC.md").write_text(SPEC + "A note of my own.\n")
        self.assertEqual(self.leak(), 0)

    def test_a_web_search_result_that_quotes_one(self):
        self.session([tool_use("1", "WebSearch", {"query": "codeclimb optimization loop"}),
                      tool_result("1", [{"type": "text", "text": "Links: [{\"title\": \"x\", \"url\": \"https://github.com/x/codeclimb\"}]"}])])
        self.assertEqual(self.leak(), 1)

    def test_a_web_fetch_result_linking_github_is_not_a_leak(self):
        # Docs pages link GitHub all the time: only the fetch's URL counts.
        self.session([tool_use("1", "WebFetch", {"url": "https://docs.langchain.com/llms.txt", "prompt": "p"}),
                      tool_result("1", "See https://github.com/langchain-ai/langgraphjs")])
        self.assertEqual(self.leak(), 0)

    def test_the_repo_owner(self):
        self.session([tool_use("1", "WebSearch", {"query": "Decoding AI Magazine codeclimb"})])
        self.assertEqual(self.leak(), 1)

    def test_a_subagent_session(self):
        self.session([tool_use("1", "Bash", {"command": "curl -s https://gitee.com/x"})], name="subagents/agent-a.jsonl")
        self.assertEqual(self.leak(), 1)

    def test_no_given_record_skips_the_app(self):
        (self.app / "src/fetch.ts").write_text("https://github.com/x/y\n")
        out = scan(self.app, self.logs, None)
        self.assertEqual((out["leak"], out["app_scanned"], out["sessions"]), (0, False, 0))

    def test_host_names_need_a_boundary(self):
        self.assertEqual(blocked_hosts.names_in("notgithub.com mygitee.community api.github.com"), ["api.github.com"])


class Reward(unittest.TestCase):
    def test_a_leaked_trial_keeps_its_reward_and_checks(self):
        checks = [run.Check("install", True), run.Check("typecheck", False)]
        out = run.reward_of(checks, {}, {"leak": 1, "sessions": 2})
        self.assertEqual(
            (out["leak"], out["leak_sessions"], out["reward"], out["checks.install"], out["checks.typecheck"]),
            (1, 2, 0.5, 1, 0),
        )


class OneList(unittest.TestCase):
    # The DNS block in the sidecar compose file must be the list in blocked_hosts.py.
    def test_dns_block_matches(self):
        compose = (ROOT / "tasks/shared/dind.compose.yaml").read_text()
        hosts = tuple(re.findall(r'^\s*- "([^:"]+):0\.0\.0\.0"', compose, re.MULTILINE))
        self.assertEqual(hosts, blocked_hosts.DNS_NAMES)

    def test_deny_rules_cover_every_domain(self):
        rules = set(blocked_hosts.managed_settings()["permissions"]["deny"])
        for d in blocked_hosts.DOMAINS:
            self.assertIn(f"WebFetch(domain:{d})", rules)
            self.assertIn(f"WebFetch(domain:*.{d})", rules)


if __name__ == "__main__":
    unittest.main()
