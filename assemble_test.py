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


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", *args],
                          check=True, capture_output=True, text=True).stdout


def fixture_reference(root: Path) -> tuple[Path, str, str]:
    """A reference branch in miniature: (repo, base, task commit). The task commit cuts a hook the base has."""
    repo = root / "ref"
    files = {
        "AGENTS.md": "how to work here\n",
        ".mcp.json": "{}\n",
        ".claude/settings.json": "{}\n",
        "notes/ideas.md": "ideas\n",
        "GLOSSARY.md": "words\n",
        "CONTEXT.md": "words\n",
        "docs/adr/0001-a.md": "a decision\n",
        "docs/agents/domain.md": "domain docs\n",
        "docs/codeclimb-spec-x.md": "a copy of the build spec\n",
        "docs/contract.md": "a contract\n",
        "README.md": "codeclimb\n",
        "package.json": json.dumps({"scripts": {"run-night": "tsx src/cli/run-night.ts"}}) + "\n",
        "src/cli/run-night.ts": "import { loop } from '../night/loop.ts';\nloop();\n",
        "src/night/loop.ts": "import { hook } from './hook.ts';\nexport function loop() { hook(); }\n",
        "src/night/hook.ts": "export function hook() { return process.env.X_HOOK; }\n",
    }
    for rel, text in files.items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_text(text)
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "base: the hook")
    base = git(repo, "rev-parse", "HEAD").strip()
    (repo / "src/night/hook.ts").write_text("export function hook() { return undefined; }\n")
    git(repo, "commit", "-qam", "cut the hook")
    return repo, base, git(repo, "rev-parse", "HEAD").strip()


class AssembleMaintenanceApp(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo, self.base, self.commit = fixture_reference(self.tmp)
        self.out = self.tmp / "task/environment/app"
        assemble.assemble_maintenance_app("inngest", self.commit, self.out, repo=self.repo)

    def test_one_fresh_commit_with_nothing_of_the_task_commit(self):
        log = git(self.out, "log", "--format=%H %an %s").splitlines()
        self.assertEqual(len(log), 1)
        self.assertNotIn(self.commit, log[0])
        self.assertIn("codeclimb", log[0])
        self.assertEqual(git(self.out, "status", "--porcelain"), "")
        self.assertEqual(git(self.out, "diff", "HEAD"), "")
        self.assertEqual((self.out / "src/night/hook.ts").read_text(), "export function hook() { return undefined; }\n")

    def test_pocock_keeps_the_glossary_adrs_and_agent_docs_but_no_spec_copy(self):
        out = self.tmp / "pocock-app"
        assemble.assemble_maintenance_app("inngest", self.commit, out, repo=self.repo, workflow="pocock")
        files = {f for f in tree(out) if not f.startswith(".git/")}
        self.assertEqual(files, {"README.md", "package.json", "src/cli/run-night.ts", "src/night/loop.ts",
                                 "src/night/hook.ts", "SPEC.md", "AGENTS.md", "GLOSSARY.md", "CONTEXT.md",
                                 "docs/adr/0001-a.md", "docs/agents/domain.md"})

    def test_guidance_files_out_spec_and_stub_in(self):
        files = {f for f in tree(self.out) if not f.startswith(".git/")}
        self.assertEqual(files, {"README.md", "package.json", "src/cli/run-night.ts", "src/night/loop.ts",
                                 "src/night/hook.ts", "SPEC.md", "AGENTS.md"})
        self.assertEqual((self.out / "AGENTS.md").read_text(), assemble.AGENTS_STUB)
        self.assertNotIn("[[", (self.out / "SPEC.md").read_text())
        self.assertIn("SPEC.md", git(self.out, "ls-files"))

    def test_fails_on_a_reference_sha(self):
        (self.repo / "README.md").write_text("built at bcabd72\n")
        git(self.repo, "commit", "-qam", "name a pin")
        with self.assertRaises(assemble.ForbiddenString) as e:
            assemble.assemble_maintenance_app("inngest", "HEAD", self.tmp / "other", repo=self.repo)
        self.assertIn("README.md: bcabd72", str(e.exception))


class AssembleMaintenanceTask(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo, self.base, self.commit = fixture_reference(self.tmp)
        self.task = assemble.Maintenance(
            kind="change", request="Add the X hook.", targets=("pause-timeout", "pause-resume"),
            commits={"inngest": self.commit, "langchain": self.commit}, bases={"inngest": self.base, "langchain": self.base},
        )
        self.dirs = {s: assemble.assemble_maintenance_task("t9", s, task=self.task, repo=self.repo, tasks_dir=self.tmp / "tasks")
                     for s in assemble.STACKS}

    def test_task_folder(self):
        d = self.dirs["inngest"]
        self.assertEqual(d.name, "codeclimb-inngest-t9")
        self.assertTrue((d / "environment/app/.git").is_dir())
        self.assertTrue((d / "tests/test.sh").exists() and (d / "tests/verifier/run.py").exists())
        self.assertIn('name = "codeclimb/codeclimb-inngest-t9"', (d / "task.toml").read_text())
        # The image keeps the /app it is given: its one commit is the assemble's.
        self.assertNotIn("git commit", (d / "environment/Dockerfile").read_text())
        record = json.loads((d / "assembled.json").read_text())
        self.assertEqual({k: record[k] for k in ("kind", "task", "stack", "base", "commit", "targets")},
                         {"kind": "change", "task": "t9", "stack": "inngest", "base": self.base, "commit": self.commit,
                          "targets": ["pause-timeout", "pause-resume"]})

    def test_leak_baseline_is_the_maintenance_app(self):
        import leak  # on the path through assemble
        d = self.dirs["langchain"]
        given = json.loads((d / "tests/verifier/given.json").read_text())
        app = d / "environment/app"
        self.assertEqual(set(given), {f for f in tree(app) if not f.startswith(".git/")})
        logs = self.tmp / "logs"
        (logs / "sessions/projects").mkdir(parents=True)
        self.assertEqual(leak.scan(app, logs, given)["leak"], 0)
        (app / "src/night/hook.ts").write_text("// decodingai-magazine\n")
        self.assertEqual(leak.scan(app, logs, given)["leak"], 1)

    def test_prompt_is_stack_neutral_and_names_no_test(self):
        prompts = {s: (d / "instruction.md").read_text() for s, d in self.dirs.items()}
        for stack, text in prompts.items():
            self.assertTrue(text.startswith(assemble.AGENTS_STUB))
            self.assertIn("Add the X hook.", text)
            for name in self.task.targets:
                self.assertNotIn(name, text)
            self.assertIn(assemble.RUNS[stack], text)
        neutral = {s: t.replace(assemble.MAINTENANCE_SERVICES[s], "{services}").replace(assemble.RUNS[s], "{runs}")
                   for s, t in prompts.items()}
        self.assertEqual(neutral["inngest"], neutral["langchain"])

    def test_a_failed_assemble_leaves_no_task_folder(self):
        (self.repo / "README.md").write_text("see codeclimb-eval-spec\n")
        git(self.repo, "commit", "-qam", "name the benchmark spec")
        task = assemble.Maintenance(kind="change", request="r", targets=(), commits={"inngest": "HEAD"})
        with self.assertRaises(assemble.ForbiddenString):
            assemble.assemble_maintenance_task("t8", "inngest", task=task, repo=self.repo, tasks_dir=self.tmp / "tasks")
        self.assertFalse((self.tmp / "tasks/codeclimb-inngest-t8").exists())

    def test_c1_prompt_names_no_target(self):
        c1 = assemble.MAINTENANCE["c1"]
        for name in c1.targets:
            self.assertNotIn(name, assemble.maintenance_prompt("inngest", c1))

    def test_c7_and_c6_start_from_the_pins_and_name_no_target(self):
        for tid in ("c7", "c6"):
            t = assemble.MAINTENANCE[tid]
            # A change on the pin: the /app is the pin, the reference's own patch is the build the targets pass on.
            self.assertEqual((t.kind, t.commits), ("change", assemble.PINS))
            self.assertEqual(set(t.bases), set(assemble.PINS))
            self.assertTrue(all(t.bases[s] != t.commits[s] for s in assemble.PINS))
            for stack in assemble.PINS:
                prompt = assemble.maintenance_prompt(stack, t)
                for name in t.targets:
                    self.assertNotIn(name, prompt)
        self.assertEqual(assemble.MAINTENANCE["c7"].targets, ("hard-deadline-mid-step",))
        self.assertEqual(assemble.MAINTENANCE["c6"].targets, ("config-rejects",))


if __name__ == "__main__":
    unittest.main()
