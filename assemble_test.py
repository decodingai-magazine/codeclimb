"""Tests for assemble.py. Run: python3 -m unittest assemble_test"""

import filecmp
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import assemble

ROOT = Path(__file__).resolve().parent


def tree(path: Path) -> set[str]:
    return {p.relative_to(path).as_posix() for p in path.rglob("*") if p.is_file()}


class FlattenWikilinks(unittest.TestCase):
    def test_section_link(self):
        self.assertEqual(assemble.flatten_wikilinks("see [[#Mock mode]]."), "see Mock mode.")

    def test_aliased_link(self):
        self.assertEqual(assemble.flatten_wikilinks("[[#Night config|the config]]"), "the config")
        self.assertEqual(assemble.flatten_wikilinks("[[other note|alias]]"), "alias")
        # Inside a table the pipe is escaped.
        self.assertEqual(assemble.flatten_wikilinks(r"| [[#Stops\|stop]] |"), "| stop |")

    def test_note_link(self):
        self.assertEqual(assemble.flatten_wikilinks("[[other note]]"), "other note")
        self.assertEqual(assemble.flatten_wikilinks("[[other note#Part]]"), "Part")

    def test_plain_brackets_untouched(self):
        self.assertEqual(assemble.flatten_wikilinks("a[0] [x](y) [--mock [--n N]]"), "a[0] [x](y) [--mock [--n N]]")


class Scan(unittest.TestCase):
    def test_finds_each_kind(self):
        for text, term in [
            ("pinned at e384bb5 here", "e384bb5"),
            ("/Users/x/01-Projects/y", "01-Projects"),
            ("see codeclimb-eval-spec.md", "codeclimb-eval-spec"),
            ("The Benchmark run", "benchmark"),
            ("use langchain-skills", "langchain-skills"),
            ("the inngest-dev MCP", "inngest-dev"),
        ]:
            self.assertIn(term, assemble.forbidden_terms(text, authored=True), text)

    def test_shared_inputs_skip_authored_only_terms(self):
        # The given scenarios mention benchmarks and skill packs in their own corpus.
        self.assertEqual(assemble.forbidden_terms("a benchmark by mattpocock", authored=False), [])
        self.assertEqual(assemble.forbidden_terms("commit bce6a16", authored=False), ["bce6a16"])


class TreeHash(unittest.TestCase):
    def test_sorts_lines_as_strings(self):
        # pathlib orders a/b before a-c; the spec's line sort puts a-c first ('-' < '/').
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp)
        (tmp / "a").mkdir()
        (tmp / "a/b").write_text("1")
        (tmp / "a-c").write_text("2")
        lines = sorted(f"{r} {assemble.sha256_bytes((tmp / r).read_bytes())}\n" for r in ["a/b", "a-c"])
        self.assertEqual(assemble.tree_sha256(tmp), assemble.sha256_bytes("".join(lines).encode()))


class AssemblePocock(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_rewrites_only_the_spec_path(self):
        out = self.tmp / "pocock"
        record = assemble.assemble_pocock("inngest", out)
        pile = ROOT / "specs/inngest/tickets"
        issues = out / ".scratch/codeclimb/issues"
        self.assertEqual(tree(issues), tree(pile))
        for name in tree(pile):
            self.assertEqual((issues / name).read_text(),
                             (pile / name).read_text().replace("specs/inngest/spec.md", "SPEC.md"))
        self.assertNotIn("specs/inngest/spec.md", "".join((issues / n).read_text() for n in tree(issues)))
        self.assertEqual(record["pile_sha256"], assemble.tree_sha256(pile))

    def test_scaffold_and_agents_block(self):
        out = self.tmp / "pocock"
        assemble.assemble_pocock("langchain", out)
        self.assertEqual(tree(out / "docs"), {"agents/issue-tracker.md", "agents/domain.md"})
        agents = (out / "AGENTS.md").read_text()
        self.assertTrue(agents.startswith(assemble.AGENTS_STUB))
        self.assertIn("## Agent skills", agents)

    def test_fails_on_a_forbidden_string(self):
        pile = self.tmp / "pile"
        pile.mkdir()
        (pile / "01-a.md").write_text("built for the benchmark\n")
        subprocess.run(["git", "init", "-q"], cwd=pile, check=True)
        with self.assertRaises(assemble.ForbiddenString) as e:
            assemble.assemble_pocock("inngest", self.tmp / "pocock", pile)
        self.assertIn("01-a.md: benchmark", str(e.exception))
        self.assertFalse((self.tmp / "pocock").exists())


class Assemble(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)

    def test_inngest_app(self):
        out = self.tmp / "task/environment/app"
        record = assemble.assemble("inngest", out)
        files = tree(out)

        for shared in assemble.SHARED:
            src = ROOT / shared
            # Branch files only: a checkout shared with the stack branches holds ignored leftovers (.venv/).
            for rel in assemble.branch_files(src):
                self.assertTrue(filecmp.cmp(src / rel, out / shared / rel, shallow=False), rel)
        given = ROOT / "specs/inngest/given"
        for rel in tree(given) - {p for p in tree(given) if p.startswith("node_modules/")}:
            self.assertTrue(filecmp.cmp(given / rel, out / rel, shallow=False), rel)

        expected = (
            {f"{s}/{rel}" for s in assemble.SHARED for rel in assemble.branch_files(ROOT / s)}
            | {rel for rel in tree(given) if not rel.startswith("node_modules/")}
            | {"SPEC.md", "E2E.md", "AGENTS.md"}
        )
        self.assertEqual(files, expected)

        spec = (out / "SPEC.md").read_text()
        self.assertNotIn("[[", spec)
        self.assertEqual((out / "E2E.md").read_bytes(), (ROOT / "specs/inngest/e2e.md").read_bytes())
        agents = (out / "AGENTS.md").read_text().splitlines()
        self.assertEqual(len(agents), 1)
        self.assertIn("harbor-canary", agents[0])

        self.assertEqual(set(record), {"stack", "spec_sha256", "given_inputs_sha256", "pile_sha256"})
        self.assertEqual(record["spec_sha256"], assemble.sha256_bytes((out / "SPEC.md").read_bytes()))
        self.assertEqual(record["pile_sha256"], assemble.tree_sha256(ROOT / "specs/inngest/tickets"))

    def test_langchain_app(self):
        out = self.tmp / "task/environment/app"
        assemble.assemble("langchain", out)
        given = ROOT / "specs/langchain/given"
        self.assertEqual(
            tree(out) - {f"{s}/{rel}" for s in assemble.SHARED for rel in tree(ROOT / s)},
            {rel for rel in tree(given) if not rel.startswith("node_modules/")} | {"SPEC.md", "E2E.md", "AGENTS.md"},
        )
        self.assertIn("langgraph.json", tree(out))
        # The build spec has the harness write these.
        self.assertFalse((out / ".dockerignore").exists())
        self.assertNotIn("[[", (out / "SPEC.md").read_text())

    def test_night_configs_identical_on_both_stacks(self):
        apps = {}
        for stack in assemble.STACKS:
            apps[stack] = self.tmp / stack / "environment/app"
            assemble.assemble(stack, apps[stack])
        configs = tree(apps["inngest"] / "configs")
        self.assertEqual(configs, tree(apps["langchain"] / "configs"))
        for rel in configs:
            a, b = apps["inngest"] / "configs" / rel, apps["langchain"] / "configs" / rel
            self.assertTrue(filecmp.cmp(a, b, shallow=False), rel)

    def test_rebuild_is_identical_and_replaces_stale_files(self):
        out = self.tmp / "task/environment/app"
        first = assemble.assemble("inngest", out)
        (out / "stale.txt").write_text("left over")
        second = assemble.assemble("inngest", out)
        self.assertEqual(first, second)
        self.assertFalse((out / "stale.txt").exists())

    def test_fails_and_names_the_string(self):
        out = self.tmp / "task/environment/app"
        spec = self.tmp / "spec.md"
        spec.write_text("Built at bce6a16 for the benchmark.\n")
        with self.assertRaises(assemble.ForbiddenString) as err:
            assemble.assemble("inngest", out, spec_path=spec)
        self.assertIn("bce6a16", str(err.exception))
        self.assertIn("benchmark", str(err.exception))
        self.assertIn("SPEC.md", str(err.exception))
        self.assertFalse(out.exists())

    def test_ignored_files_stay_out(self):
        # A .env or node_modules/ left in given/ is gitignored and never reaches /app.
        given = ROOT / "specs/inngest/given"
        stray = [given / ".env", given / "node_modules/x/index.js"]
        for p in stray:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("secret")
        self.addCleanup(shutil.rmtree, given / "node_modules", True)
        self.addCleanup((given / ".env").unlink)
        out = self.tmp / "task/environment/app"
        assemble.assemble("inngest", out)
        self.assertFalse((out / ".env").exists())
        self.assertFalse((out / "node_modules").exists())

    def test_writes_the_record_next_to_the_task(self):
        out = self.tmp / "task/environment/app"
        record = assemble.assemble("inngest", out)
        saved = json.loads((self.tmp / "task/assembled.json").read_text())
        self.assertEqual(saved, record)


if __name__ == "__main__":
    unittest.main()
