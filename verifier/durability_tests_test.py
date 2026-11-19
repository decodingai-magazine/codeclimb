"""Tests for the durability tests' pure logic on synthetic files. Run: cd verifier && python3 -m unittest durability_tests_test"""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import durability_tests as D
from nights import Night


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class Names(unittest.TestCase):
    def test_coder_sandbox(self):
        self.assertTrue(D.coder_sandbox("v1-a1", "cc-v1-a1-r1-e0"))
        self.assertTrue(D.coder_sandbox("v1-a1", "cc-v1-a1-r2-e1", 2))
        self.assertFalse(D.coder_sandbox("v1-a1", "cc-v1-a1-r2-e1", 1))
        self.assertFalse(D.coder_sandbox("v1-a1", "cc-v1-a1-r1-eval"))
        self.assertFalse(D.coder_sandbox("v1-a1", "cc-v1-a1-r1-e0-eval"))

    def test_round_eval_sandbox_on_both_stacks(self):
        nid = "v1-a1"
        self.assertTrue(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r1-e0-eval"))  # Inngest: cc-<eval id>
        self.assertTrue(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r1-eval"))  # LangChain: cc-<night>-r<N>-<kind>
        self.assertFalse(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r1-e0"))  # the coder
        self.assertFalse(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r1-e1"))  # the repair's coder
        self.assertFalse(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r1-e0-noise-r2"))  # Inngest's round 2 noise run
        self.assertFalse(D.round_eval_sandbox(nid, 1, "cc-v1-a1-r2-eval"))
        self.assertFalse(D.round_eval_sandbox(nid, 1, "cc-v1-a11-r1-eval"))  # another night

    def test_test_sandbox(self):
        self.assertTrue(D.test_sandbox("v1-a1", "cc-v1-a1-test-r2"))
        self.assertFalse(D.test_sandbox("v1-a1", "cc-v1-a1-r2-eval"))


class Rows(unittest.TestCase):
    def test_eval_ids_once(self):
        ids, twice = D.eval_ids([{"eval_id": "a"}, {"eval_id": "b"}, {"eval_id": "a"}, {}])
        self.assertEqual(ids, ["a", "b", "a"])
        self.assertEqual(twice, ["a"])

    def test_experiment_rows_skip_noise_and_test(self):
        rows = [
            {"kind": "experiment", "exp_id": "n-r1-e0"},
            {"kind": "noise", "exp_id": "n-r1-e0"},
            {"kind": "test", "exp_id": "n-r1-e0"},
        ]
        self.assertEqual(len(D.experiment_rows(rows, "n-r1-e0")), 1)


class Files(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)

    def test_complete_lines_drop_a_torn_tail(self):
        self.assertEqual(D.complete_lines('{"a":1}\n{"b":'), ['{"a":1}'])
        self.assertEqual(D.complete_lines('{"a":1}\n'), ['{"a":1}'])
        self.assertEqual(D.complete_lines(""), [])

    def test_session_prefix(self):
        exp = self.root / "exp"
        write(exp / "session/s.jsonl", '{"type":"message","n":1}\n{"type":"message","n":2}\n{"type":"mess')
        before = D.session_lines(exp)
        self.assertEqual(D.session_messages_n(exp), 2)
        write(exp / "session/s.jsonl", '{"type":"message","n":1}\n{"type":"message","n":2}\n{"type":"message","n":3}\n')
        self.assertTrue(D.is_prefix(before, D.session_lines(exp))[0])
        # A session started over in a new file loses the old lines.
        (exp / "session/s.jsonl").unlink()
        write(exp / "session/t.jsonl", '{"type":"message","n":1}\n')
        self.assertFalse(D.is_prefix(before, D.session_lines(exp))[0])
        # A rewritten first line is not a prefix.
        write(exp / "session/s.jsonl", '{"type":"message","n":9}\n{"type":"message","n":2}\n{"type":"message","n":3}\n')
        self.assertFalse(D.is_prefix(before, D.session_lines(exp))[0])
        # Nothing before the kill proves nothing.
        self.assertFalse(D.is_prefix({}, D.session_lines(exp))[0])

    def test_coder_finished(self):
        exp = self.root / "exp"
        self.assertFalse(D.coder_finished(exp))
        write(exp / "code-state.json", json.dumps({"stop": None}))
        self.assertFalse(D.coder_finished(exp))
        write(exp / "code-state.json", '{"sto')
        self.assertFalse(D.coder_finished(exp))
        write(exp / "code-state.json", json.dumps({"stop": "done"}))
        self.assertTrue(D.coder_finished(exp))

    def test_night5_conditions(self):
        nt = Night(5, "configs/datenorm-smoke.yaml", "v1-n", "datenorm-smoke", self.root / "datenorm-smoke", 0, "")
        state = D.r1_state(nt)
        write(state, json.dumps({"stop": "done"}))
        snap = {"r1_state": D.stamp(state)}
        write(nt.dir / "results.jsonl", "\n".join(json.dumps({"night_id": "v1-n", "eval_id": e}) for e in ("a", "b")) + "\n")
        log = self.root / "events.log"
        write(log, "100 cc-v1-n-r1-e0\n300 cc-v1-n-r1-eval\n400 cc-v1-n-r2-e0\n")
        f = D.Faulted(nt, log, 200, ["worker"], [], True, snap)
        self.assertFalse(D.night5(f, D.any_r1("v1-n"))[0])  # the evaluation's sandbox of round 1 after the kill
        self.assertTrue(D.night5(f, lambda n: D.coder_sandbox("v1-n", n, 1))[0])
        write(log, "100 cc-v1-n-r1-e0\n300 cc-v1-n-r1-e0\n")
        self.assertFalse(D.night5(f, lambda n: D.coder_sandbox("v1-n", n, 1))[0])
        # A rewritten code-state.json fails, even with the same content.
        write(log, "100 cc-v1-n-r1-e0\n")
        self.assertTrue(D.night5(f, D.any_r1("v1-n"))[0])
        state.write_text(json.dumps({"stop": "done"}) + " ")
        self.assertFalse(D.night5(f, D.any_r1("v1-n"))[0])

    def test_root_parent(self):
        repo = self.root / "repo"
        repo.mkdir()
        git = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True).stdout.strip()
        git("init", "-q")
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "starter")
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "r1")
        r1 = git("rev-parse", "HEAD")
        self.assertTrue(D.root_parent(repo, r1)[0])
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "r2")
        self.assertFalse(D.root_parent(repo, git("rev-parse", "HEAD"))[0])
        self.assertFalse(D.root_parent(repo, git("rev-list", "--max-parents=0", "HEAD"))[0])



class Keep(unittest.TestCase):
    """CODECLIMB_VERIFIER_KEEP: a faulted night's folder, its rows and the services' logs (R10's incident)."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.nt = Night(5, "configs/datenorm-smoke.yaml", "v1-cte1", "datenorm-smoke", self.root / "runs/mock/datenorm-smoke", 0, "")
        write(self.nt.night_dir / "done.json", "{}")
        write(self.nt.dir / "results.jsonl", json.dumps({"night_id": "v1-cte1", "eval_id": "a"}) + "\n"
              + json.dumps({"night_id": "other", "eval_id": "b"}) + "\n")

        class Adapter:
            def log_files(self, services):
                return {"worker.log": "w\n", "langgraph-api.log": "s\n"}

        self.ctx = type("Ctx", (), {"adapter": Adapter(), "services": None})()

    def test_off_without_the_variable(self):
        D.os.environ.pop("CODECLIMB_VERIFIER_KEEP", None)
        D.keep(self.ctx, self.nt)
        self.assertEqual(list(self.root.iterdir()), [self.root / "runs"])

    def test_night_rows_and_logs(self):
        out = self.root / "keep"
        D.os.environ["CODECLIMB_VERIFIER_KEEP"] = str(out)
        self.addCleanup(D.os.environ.pop, "CODECLIMB_VERIFIER_KEEP", None)
        D.keep(self.ctx, self.nt)
        k = out / "v1-cte1"
        self.assertTrue((k / "night" / "done.json").exists())
        self.assertEqual([json.loads(x)["eval_id"] for x in (k / "results.jsonl").read_text().splitlines()], ["a"])
        self.assertEqual(sorted(p.name for p in (k / "logs").iterdir()), ["langgraph-api.log", "worker.log"])

if __name__ == "__main__":
    unittest.main()
