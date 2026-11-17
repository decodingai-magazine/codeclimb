"""The code and practice analysis step on a small fixture build with known counts (analysis/fixture/).

Runs the analysis container once (Docker must be running; the first run builds the image and installs the fixture's
packages). Every expected value below is counted by hand from the fixture's files.
"""

import json
import tempfile
import unittest
from pathlib import Path

from code_metrics import measure

FIXTURE = Path(__file__).resolve().parent / "analysis" / "fixture"


class FixtureBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "trial" / "code-metrics.json"
        cls.m = measure(FIXTURE, "inngest", cls.out)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_writes_the_metrics_file(self):
        self.assertEqual(json.loads(self.out.read_text()), self.m)
        self.assertEqual(self.m["stack"], "inngest")

    def test_ratios_to_the_reference_build(self):
        ref = Path(self.tmp.name) / "reference.json"
        ref.write_text(json.dumps({"size": {"code_lines": 98, "comment_lines": 0, "files": 10, "modules": 2},
                                   "glue": {"glue_lines": 10, "domain_lines": 70},
                                   "type_escapes": {"per_kloc": 40.8}, "ruleset": {"per_kloc": None}}))
        m = measure(FIXTURE, "inngest", Path(self.tmp.name) / "with-ref.json", reference=ref)
        self.assertEqual(
            m["ratios"],
            {"size.code_lines": 0.5, "size.comment_lines": None, "size.files": 0.5, "size.modules": 0.5,
             "glue.glue_lines": 0.5, "glue.domain_lines": 0.5, "type_escapes.per_kloc": 2.0, "ruleset.per_kloc": None},
        )

    def test_size_leaves_out_given_inputs_and_the_next_app(self):
        # glue.ts 5 + domain.ts 19 + dup-a.ts 8 + dup-b.ts 8 + test 9; src/hello.ts, src/app/, next.config.mjs,
        # scenarios/ and configs/ are left out.
        self.assertEqual(
            self.m["size"],
            {"code_lines": 49, "comment_lines": 3, "test_code_lines": 9, "files": 5, "modules": 1},
        )
        self.assertIn("src/app/page.tsx", self.m["excluded"]["next_app"])
        self.assertIn("next.config.mjs", self.m["excluded"]["next_app"])
        self.assertIn("src/hello.ts", self.m["excluded"]["given"])

    def test_type_escapes_per_1000_lines(self):
        # src/domain.ts: one `any`, one `!`, one `as unknown as`, one `@ts-expect-error`; 4 in 49 lines.
        self.assertEqual(
            self.m["type_escapes"],
            {"any": 1, "non_null": 1, "as_unknown_as": 1, "ts_ignore": 0, "ts_expect_error": 1, "ts_nocheck": 0,
             "total": 4, "per_kloc": 81.6, "error": None},
        )

    def test_benchmark_ruleset_is_type_checked(self):
        # src/domain.ts: `any`, a bare `@ts-expect-error`, a floating `save()`, and a `!` on a value that is already a
        # number (require-await skips the empty async body). 4 in 49 lines. The tests resolve `node:test`
        # through the build's @types/node, so they raise nothing.
        self.assertTrue(self.m["install"]["ok"], self.m["install"])
        self.assertEqual(
            self.m["ruleset"],
            {"violations": 4, "per_kloc": 81.6, "error": None,
             "by_rule": {"@typescript-eslint/ban-ts-comment": 1, "@typescript-eslint/no-explicit-any": 1,
                         "@typescript-eslint/no-floating-promises": 1,
                         "@typescript-eslint/no-unnecessary-type-assertion": 1}},
        )

    def test_own_tests_three_times(self):
        self.assertEqual(self.m["flakiness"]["runs"], [{"exit": 0, "pass": 2, "fail": 0}] * 3)
        self.assertEqual(self.m["flakiness"]["passed_runs"], 3)

    def test_unit_testable_share(self):
        # The test imports domain.ts and runs two of its seven functions; glue.ts is never loaded.
        c = self.m["coverage"]
        self.assertIsNone(c["error"])
        self.assertEqual(c["glue_line_pct"], 0.0)
        self.assertGreater(c["domain_line_pct"], 0.0)
        self.assertLess(c["domain_line_pct"], 100.0)
        self.assertNotIn("test/domain.test.ts", c["files"])
        self.assertEqual(sorted(c["files"]), ["src/domain.ts", "src/dup-a.ts", "src/dup-b.ts", "src/glue.ts"])

    def test_duplication(self):
        # src/dup-a.ts and src/dup-b.ts are one 8-line function twice.
        d = self.m["duplication"]
        self.assertEqual((d["clones"], d["duplicated_lines"], d["error"]), (1, 8, None))

    def test_dead_code(self):
        # Reached from the test (the `node --test` script): domain.ts. Never imported: glue.ts and both dup files.
        # Exported from domain.ts and imported nowhere: first, cast, unused, save, kick.
        self.assertEqual(
            self.m["dead_code"],
            {"unused_files": ["src/dup-a.ts", "src/dup-b.ts", "src/glue.ts"],
             "unused_exports": ["src/domain.ts:cast", "src/domain.ts:first", "src/domain.ts:kick", "src/domain.ts:save",
                                "src/domain.ts:unused"],
             "n_unused_files": 3, "n_unused_exports": 5, "error": None},
        )

    def test_dependencies_beyond_the_build_spec_table(self):
        # Inngest's table lists neither left-pad nor @types/node, and pins yaml at 2.9.1.
        self.assertEqual(
            self.m["dependencies"],
            {"beyond_table": ["@types/node", "left-pad"], "other_version": {"yaml": {"build": "2.8.0", "table": "2.9.1"}}},
        )

    def test_weakened_tsconfig(self):
        self.assertEqual(
            self.m["tsconfig"],
            {"sha256_matches_given": False, "weakened": ["strict"],
             "changed_options": {"strict": [True, False], "types": [None, ["node"]]}},
        )

    def test_practice_flags(self):
        # .husky/pre-commit and .prettierrc, no CI or linter, no lint or format script to run; AGENTS.md is the stub.
        self.assertEqual(
            self.m["practices"],
            {"ci": False, "pre_commit": True, "linter": False, "formatter": True, "lint_passes": None,
             "format_passes": None, "readme": True, "agents_md": False},
        )

    def test_complexity_per_function(self):
        # 11 functions: grade has two ifs (3), each tally a loop and a `??` (3), the other 8 are straight (1).
        self.assertEqual(self.m["complexity"], {"functions": 11, "mean": 1.55, "max": 3, "over_10": 0, "error": None})

    def test_glue_is_a_file_importing_the_stack_sdk(self):
        # src/glue.ts imports `inngest`; the other 35 non-test lines are domain.
        self.assertEqual(
            self.m["glue"],
            {"glue_files": ["src/glue.ts"], "glue_lines": 5, "domain_lines": 35,
             "sdk_symbols": ["inngest:Inngest", "inngest:NonRetriableError"], "n_sdk_symbols": 2},
        )


if __name__ == "__main__":
    unittest.main()
