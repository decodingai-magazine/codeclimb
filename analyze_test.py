import unittest

from analyze import lever_counts


def trajectory(*calls):
    return {"steps": [{"tool_calls": [{"function_name": n, "arguments": a} for n, a in calls]}]}


class LeverCounts(unittest.TestCase):
    def test_counts_each_lever(self):
        t = trajectory(
            ("Skill", {"skill": "inngest-steps"}),
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
            {"skill": 1, "mcp_platform": 1, "mcp_docs": 3, "web_fetch": 1, "web_search": 1, "bash_fetch": 1},
        )

    def test_empty(self):
        self.assertEqual(sum(lever_counts({"steps": [{"message": "hi"}]}).values()), 0)


if __name__ == "__main__":
    unittest.main()
