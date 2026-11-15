"""Tests for the pure logic of hidden tiers 1 and 2 on synthetic files. Run: cd verifier && python3 -m unittest hidden_tests_test"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import hidden_tests as H
from nights import Night


def write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data))


DATENORM_TEXT = """scenario: scenarios/datenorm
max_rounds: 2
thresholds:
  accuracy: 1.01   # out of reach
gates:
  schema_violations: 0
results_path: datenorm-smoke/results.jsonl
"""


class Pure(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)

    def night(self, nid: str = "t1", config: str = "configs/d.yaml") -> Night:
        return Night(2, config, nid, "d", self.root / "runs" / "mock" / "d", 0, "done\n")

    def test_yaml_map_block_and_flow(self):
        self.assertEqual(H.yaml_map(DATENORM_TEXT, "thresholds"), {"accuracy": 1.01})
        self.assertEqual(H.yaml_map(DATENORM_TEXT, "gates"), {"schema_violations": 0.0})
        self.assertEqual(H.yaml_map("thresholds: {accuracy: 0.1, f1: 2}\n", "thresholds"), {"accuracy": 0.1, "f1": 2.0})
        self.assertEqual(H.yaml_map(DATENORM_TEXT, "weights"), {})

    def test_weighted_score_caps_and_floors_each_share(self):
        t, w = {"a": 0.5, "b": 2.0}, {"a": 1.0, "b": 3.0}
        # a: 0.8/0.5 capped at 1; b: 1/2 = 0.5 -> (1 + 1.5) / 4
        self.assertAlmostEqual(H.weighted_score({"a": 0.8, "b": 1}, t, w), 0.625)
        self.assertAlmostEqual(H.weighted_score({"a": -1, "b": 1}, t, w), 0.375)
        self.assertAlmostEqual(H.weighted_score({"b": 1}, t, w), 0.375)  # missing -> 0
        # datenorm-smoke: accuracy 0.125 against 1.01
        self.assertAlmostEqual(H.weighted_score({"accuracy": 0.125}, {"accuracy": 1.01}, {"accuracy": 1.0}), 0.12376237623762376)

    def test_score_mismatches_skips_error_rows(self):
        rows = [
            {"kind": "experiment", "exp_id": "x-r1-e0", "decision": "keep", "score": 0.12376237623762376, "metrics": {"accuracy": 0.125}},
            {"kind": "experiment", "exp_id": "x-r2-e0", "decision": "revert", "score": 0.125, "metrics": {"accuracy": 0.125}},
            {"kind": "experiment", "exp_id": "x-r3-e0", "decision": "error", "metrics": {"accuracy": 0}},
            {"kind": "noise", "score": 9, "metrics": {}},
        ]
        n, bad = H.score_mismatches(rows, {"accuracy": 1.01}, {"accuracy": 1.0})
        self.assertEqual(n, 2)
        self.assertEqual(len(bad), 1)
        self.assertIn("x-r2-e0", bad[0])

    def test_scoring_config_prefers_night_json_and_fills_weights(self):
        write(self.root / "configs/d.yaml", DATENORM_TEXT)
        nt = self.night()
        t, w, src = H.scoring_config(nt, self.root)
        self.assertEqual((t, w, src), ({"accuracy": 1.01}, {"accuracy": 1.0}, "configs/d.yaml"))
        write(nt.night_dir / "night.json", {"config": {"thresholds": {"accuracy": 0.5}, "weights": {"accuracy": 2}, "noise_margin": {"min": 0.01}}})
        t, w, src = H.scoring_config(nt, self.root)
        self.assertEqual((t, w, src), ({"accuracy": 0.5}, {"accuracy": 2.0}, "night.json config"))
        # A night.json config without thresholds falls back to the file.
        write(nt.night_dir / "night.json", {"config": {"results_path": "x"}})
        self.assertEqual(H.scoring_config(nt, self.root)[2], "configs/d.yaml")

    def rows(self, nid: str = "t1") -> list[dict]:
        base = {"night_id": nid, "stack": "inngest", "backend": "docker"}
        return [
            {**base, "kind": "experiment", "exp_id": f"{nid}-r1-e0", "parent_id": f"{nid}-r0-starter", "eval_id": f"{nid}-r1-e0-eval", "round": 1},
            {**base, "kind": "noise", "exp_id": f"{nid}-r1-e0", "parent_id": None, "eval_id": f"{nid}-r1-e0-noise-r2", "round": 2},
            {**base, "kind": "experiment", "exp_id": f"{nid}-r2-e0", "parent_id": f"{nid}-r1-e0", "eval_id": f"{nid}-r2-e0-eval", "round": 2},
            {**base, "kind": "experiment", "exp_id": f"{nid}-r2-e1", "parent_id": None, "eval_id": f"{nid}-r2-e1-eval", "round": 2},
            {**base, "kind": "test", "exp_id": f"{nid}-r1-e0", "parent_id": None, "eval_id": f"{nid}-test-r2", "round": 2},
        ]

    def test_id_problems_accepts_both_specs_ids(self):
        self.assertEqual(H.id_problems(self.rows(), "t1", "inngest", 2), [])

    def test_id_problems_finds_each_break(self):
        def broken(i: int, **change) -> list[str]:
            rows = self.rows()
            rows[i] = {**rows[i], **change}
            return H.id_problems(rows, "t1", "inngest", 2)

        self.assertTrue(broken(0, stack="langchain"))
        self.assertTrue(broken(0, backend="e2b"))
        self.assertTrue(broken(0, round=2))
        self.assertTrue(broken(0, eval_id="t1-r1-e0-dev"))
        self.assertTrue(broken(0, exp_id="t1-1"))
        self.assertTrue(broken(0, parent_id="starter"))
        self.assertTrue(broken(1, eval_id="t1-r1-e0-aa"))
        self.assertTrue(broken(4, eval_id="t1-test-r1"))  # not the last round
        self.assertTrue(broken(4, night_id="t2"))
        self.assertTrue(broken(4, kind="final"))

    def test_folder_problems(self):
        nt = self.night()
        for d in ("exps/t1-r1-e0", "exps/t1-r2-e1", "evals/t1-r1-e0-eval", "evals/t1-r1-e0-noise-r2", "evals/t1-test-r2"):
            (nt.night_dir / d).mkdir(parents=True)
        self.assertEqual(H.folder_problems(nt), [])
        (nt.night_dir / "exps/scratch").mkdir()
        (nt.night_dir / "evals/t1-r1-e0-dev").mkdir()
        self.assertEqual(H.folder_problems(nt), ["exps/scratch", "evals/t1-r1-e0-dev"])

    def test_rounds_without_keep(self):
        rows = [
            {"kind": "experiment", "round": 1, "decision": "keep"},
            {"kind": "experiment", "round": 2, "decision": "error"},
            {"kind": "experiment", "round": 2, "decision": "revert"},
            {"kind": "experiment", "round": 3, "decision": "error"},
            {"kind": "experiment", "round": 3, "decision": "keep"},
            {"kind": "test", "round": 3, "decision": "keep"},
        ]
        self.assertEqual(H.rounds_without_keep(rows), [2])

    def test_done_problems(self):
        nt = self.night()
        tm = {"accuracy": 0.125}
        done = {"night_id": "t1", "stop_reason": "max_rounds", "rounds": 2, "kept": {"exp_id": "t1-r1-e0", "commit": "c1", "dev_score": 0.1},
                "test_metrics": tm, "spend_usd": 0, "finished_at": "now"}
        rows = [{"kind": "experiment", "decision": "keep"}, {"kind": "test", "metrics": tm, "commit": "c1"}]
        self.assertEqual(H.done_problems(nt, done, rows, "c1", "s0"), [])
        self.assertTrue(H.done_problems(nt, done, rows, "c2", "s0"))  # kept.commit is not its ref
        self.assertTrue(H.done_problems(nt, {**done, "test_metrics": {"accuracy": 0}}, rows, "c1", "s0"))
        self.assertTrue(H.done_problems(nt, {k: v for k, v in done.items() if k != "finished_at"}, rows, "c1", "s0"))
        self.assertTrue(H.done_problems(nt, done, rows + [rows[1]], "c1", "s0"))  # two test rows
        # Nothing kept: the test row scores the starter.
        nothing = [{"kind": "experiment", "decision": "revert"}, {"kind": "test", "metrics": tm, "commit": "s0"}]
        starter_done = {**done, "kept": {"exp_id": "t1-r0-starter", "commit": "s0", "dev_score": 0}}
        self.assertEqual(H.done_problems(nt, starter_done, nothing, "s0", "s0"), [])
        self.assertTrue(H.done_problems(nt, starter_done, nothing, "s0", "other"))

    def test_exp_refs_and_parents(self):
        # The starter is a root commit: checkpoint-lineage reads only the -r<N>-e<n> refs.
        import subprocess

        repo = self.root / "experiments.git"
        sh = lambda *a, **k: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True, **k).stdout.strip()
        subprocess.run(["git", "init", "-q", "--bare", str(repo)], check=True)
        tree = sh("mktree", input="")
        env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        s = sh("commit-tree", tree, "-m", "starter", env=env)
        e = sh("commit-tree", tree, "-p", s, "-m", "exp", env=env)
        for ref, sha in (("n1-r0-starter", s), ("n1-r1-e0", e), ("n11-r1-e0", e)):
            sh("update-ref", f"refs/exp/{ref}", sha)
        self.assertEqual(H.exp_refs(repo, "n1"), {"refs/exp/n1-r1-e0": e})
        self.assertEqual(H.parents(repo, "refs/exp/n1-r1-e0"), [s])
        self.assertEqual(H.parents(repo, "refs/exp/n1-r0-starter"), [])
        self.assertIsNone(H.parents(repo, "refs/exp/n1-r9-e0"))

    def test_size_ok(self):
        self.assertTrue(H.size_ok({"HostConfig": {"NanoCpus": 2_000_000_000, "Memory": 2 * 1024**3}})[0])
        self.assertTrue(H.size_ok({"HostConfig": {"CpuQuota": 200000, "CpuPeriod": 100000, "Memory": 2 * 1024**3}})[0])
        self.assertFalse(H.size_ok({"HostConfig": {"NanoCpus": 1_000_000_000, "Memory": 2 * 1024**3}})[0])
        self.assertFalse(H.size_ok({"HostConfig": {"NanoCpus": 2_000_000_000, "Memory": 0}})[0])
        self.assertFalse(H.size_ok({})[0])

    def test_test_names_and_tiers(self):
        names = [t.name for t in H.TESTS]
        self.assertEqual(len(names), 19)
        self.assertEqual(len(set(names)), 19)
        self.assertEqual([t.tier for t in H.TESTS], ["hidden-1"] * 10 + ["hidden-2"] * 9)


if __name__ == "__main__":
    unittest.main()
