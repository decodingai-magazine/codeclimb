"""Tests for the real family's checks on synthetic nights. Run: cd verifier && python3 -m unittest real_tests_test"""

import json
import shutil
import tempfile
import unittest
from pathlib import Path

import real_tests as R
from families import Skip
from nights import Night


def write(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data))


def rows(path: Path, items: list[dict]) -> None:
    write(path, "".join(json.dumps(r) + "\n" for r in items))


def session(path: Path, users: list[str], assistants: int = 1) -> None:
    lines = [{"type": "session"}]
    for u in users:
        lines.append({"type": "message", "message": {"role": "user", "content": [{"type": "text", "text": u}]}})
        for _ in range(assistants):
            lines.append({"type": "message", "message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}})
    write(path, "".join(json.dumps(x) + "\n" for x in lines))


CFG = {"thresholds": {"accuracy": 1.0}, "gates": {"schema_violations": 0}, "noise_margin": {"min": 0.002, "max": 0.005}}


class RealChecks(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)

    def night(self, nid: str = "t1", items: list[dict] | None = None) -> Night:
        nt = Night(0, "configs/x.yaml", nid, "x", self.root / "x", 0, "")
        base = {"night_id": nid}
        rows(nt.dir / "results.jsonl", [{**base, **r} for r in items or []])
        return nt

    def exp(self, nid: str, rnd: int, e: int = 0, **kw) -> dict:
        return {"kind": "experiment", "exp_id": f"{nid}-r{rnd}-e{e}", "round": rnd, "eval_id": f"{nid}-r{rnd}-e{e}-eval", **kw}

    # --- config and score

    def test_parse_config_reads_nested_and_flow_values(self):
        cfg = R.parse_config("a: 1\nthresholds:\n  accuracy: 0.97   # c\nweights: {accuracy: 2}\nallowed_models: [x/y]\ndeadline: 3m\n")
        self.assertEqual(cfg["thresholds"], {"accuracy": 0.97})
        self.assertEqual(cfg["weights"], {"accuracy": 2})
        self.assertEqual(cfg["allowed_models"], ["x/y"])
        self.assertEqual(cfg["deadline"], "3m")

    def test_night_config_prefers_night_json(self):
        nt = self.night()
        write(nt.night_dir / "night.json", {"config": {"thresholds": {"a": 1}, "reviewer_model": "p/r"}})
        self.assertEqual(R.night_config(nt, self.root)["reviewer_model"], "p/r")

    def test_weighted_score_caps_and_weights(self):
        self.assertAlmostEqual(R.weighted({"a": 2, "b": 0.5}, {"a": 1, "b": 1}, {"a": 1, "b": 3}), (1 + 3 * 0.5) / 4)
        self.assertEqual(R.weighted({"a": -1}, {"a": 1}, None), 0)
        self.assertEqual(R.failed_gates({"g": 1}, {"g": 0, "h": 5}), ["g", "h"])

    # --- 43 keep-consistency

    def test_keep_consistency_follows_the_checkpoint(self):
        nt = self.night(items=[
            self.exp("t1", 1, decision="keep", metrics={"accuracy": 0.5, "schema_violations": 0}),
            {"kind": "noise", "round": 2, "eval_id": "n"},
            self.exp("t1", 2, decision="revert", metrics={"accuracy": 0.501, "schema_violations": 0}),
            self.exp("t1", 3, decision="error", metrics={"accuracy": 0}),
            self.exp("t1", 3, 1, decision="keep", metrics={"accuracy": 0.6, "schema_violations": 0}),
            self.exp("t1", 4, decision="revert", metrics={"accuracy": 0.9, "schema_violations": 3}),
            self.exp("t1", 5, decision="revert", unchanged=True, metrics={"accuracy": 0.6, "schema_violations": 0}),
        ])
        write(nt.night_dir / "noise.json", {"margin": 0.002})
        ok, detail = R.check_keep_consistency(nt, CFG)
        self.assertTrue(ok, detail)

    def test_keep_below_the_checkpoint_is_inconsistent(self):
        nt = self.night(items=[
            self.exp("t1", 1, decision="keep", metrics={"accuracy": 0.5, "schema_violations": 0}),
            self.exp("t1", 2, decision="keep", metrics={"accuracy": 0.4, "schema_violations": 0}),
        ])
        self.assertFalse(R.check_keep_consistency(nt, CFG)[0])

    def test_revert_of_a_clear_gain_is_inconsistent(self):
        nt = self.night(items=[self.exp("t1", 1, decision="revert", decision_reason="score 0.5 vs 0", metrics={"accuracy": 0.5, "schema_violations": 0})])
        self.assertFalse(R.check_keep_consistency(nt, CFG)[0])

    def test_keep_with_a_failed_gate_is_inconsistent(self):
        nt = self.night(items=[self.exp("t1", 1, decision="keep", metrics={"accuracy": 0.5})])
        self.assertFalse(R.check_keep_consistency(nt, CFG)[0])

    # --- R1

    def test_overfit_test_equals_dev(self):
        nt = self.night(items=[self.exp("t1", 1, decision="keep", metrics={"accuracy": 0.97}),
                               {"kind": "test", "eval_id": "t", "metrics": {"accuracy": 0.97}}])
        write(nt.night_dir / "done.json", {"kept": {"exp_id": "t1-r1-e0"}, "stop_reason": "thresholds", "rounds": 1})
        self.assertTrue(R.check_test_equals_dev(nt)[0])
        self.assertTrue(R.check_thresholds(nt)[0])
        rows(nt.dir / "results.jsonl", [{"night_id": "t1", **self.exp("t1", 1, decision="keep", metrics={"accuracy": 0.97})},
                                        {"night_id": "t1", "kind": "test", "eval_id": "t", "metrics": {"accuracy": 0.9}}])
        self.assertFalse(R.check_test_equals_dev(nt)[0])

    def test_lineage_accepts_a_kept_repair(self):
        nt = self.night(items=[
            self.exp("t1", 1, decision="keep", commit="c1", score=0.5),
            self.exp("t1", 2, decision="error", commit="c2", score=0),
            self.exp("t1", 2, 1, decision="keep", commit="c3", score=0.8),
        ])
        parents = {"c1": ["s"], "c2": ["c1"], "c3": ["c2"]}
        ok, detail = R.check_lineage(nt, lambda sha: parents.get(sha, []))
        self.assertTrue(ok, detail)
        parents["c3"] = ["s"]
        self.assertFalse(R.check_lineage(nt, lambda sha: parents.get(sha, []))[0])

    def test_lineage_needs_rising_scores(self):
        nt = self.night(items=[self.exp("t1", 1, decision="keep", commit="c1", score=0.5),
                               self.exp("t1", 2, decision="keep", commit="c2", score=0.5)])
        self.assertFalse(R.check_lineage(nt, lambda sha: {"c1": ["s"], "c2": ["c1"]}.get(sha, []))[0])

    # --- R4 to R7

    def test_budget_stops_between_rounds_whatever_the_spend(self):
        nt = self.night(items=[self.exp("t1", 1), {"kind": "test", "eval_id": "t"}])
        write(nt.night_dir / "done.json", {"stop_reason": "budget", "rounds": 1, "spend_usd": 0.055})
        write(nt.night_dir / "reviews/r1.json", {"feedback": "f"})
        self.assertTrue(R.check_between_rounds(nt, "budget")[0])  # spend over the cap is not graded
        self.assertFalse(R.check_between_rounds(nt, "deadline")[0])

    def test_budget_fails_when_a_later_round_started(self):
        nt = self.night(items=[self.exp("t1", 1), self.exp("t1", 2), {"kind": "test", "eval_id": "t"}])
        write(nt.night_dir / "done.json", {"stop_reason": "budget", "rounds": 1})
        write(nt.night_dir / "reviews/r1.json", {"feedback": "f"})
        self.assertFalse(R.check_between_rounds(nt, "budget")[0])

    def test_deadline_needs_the_last_round_row_review_and_one_test(self):
        nt = self.night(items=[self.exp("t1", 1), self.exp("t1", 2), {"kind": "test", "eval_id": "t"}])
        write(nt.night_dir / "done.json", {"stop_reason": "deadline", "rounds": 2})
        write(nt.night_dir / "reviews/r2.json", {"feedback": "f"})
        self.assertTrue(R.check_between_rounds(nt, "deadline")[0])
        write(nt.night_dir / "stop.json", {"reason": "x"})
        self.assertFalse(R.check_between_rounds(nt, "deadline")[0])
        (nt.night_dir / "stop.json").unlink()
        (nt.night_dir / "reviews/r2.json").unlink()
        self.assertFalse(R.check_between_rounds(nt, "deadline")[0])

    def r7(self, **kw) -> dict:
        d = {"stop_code": 0, "before": {"session_bytes": 100, "meter_lines": 0, "assistant": 3},
             "at_stop": {"session_bytes": 120, "meter_lines": 0}, "peak": {"session_bytes": 120, "meter_lines": 0},
             "left_after_60s": []}
        d.update(kw)
        return d

    def test_stop_halts_spend(self):
        nt = self.night(items=[self.exp("t1", 1)])
        write(nt.night_dir / "stop.json", {"reason": "manual"})
        self.assertTrue(R.check_stop_halts(nt, self.r7())[0])
        self.assertFalse(R.check_stop_halts(nt, self.r7(peak={"session_bytes": 130, "meter_lines": 0}))[0])
        self.assertFalse(R.check_stop_halts(nt, self.r7(left_after_60s=["cc-t1-r1-e0"]))[0])
        # The negative needs its positive: a coder that never worked proves nothing.
        self.assertFalse(R.check_stop_halts(nt, self.r7(before={"session_bytes": 0, "meter_lines": 0, "assistant": 0}))[0])

    # --- R2

    def r2(self) -> Night:
        nt = self.night(items=[self.exp("t1", 1, decision="keep"), self.exp("t1", 2, hypothesis="Try  regexes", commit="c2")])
        write(nt.night_dir / "reviews/r1.json", {"model": "p/rev", "feedback": "Handle German months.", "hypothesis": "Try regexes", "verdict": "Good start."})
        session(nt.night_dir / "exps/t1-r2-e0/session/s.jsonl", ["Spec... Feedback: Handle German\nmonths. Hypothesis: Try regexes", "You stopped with"])
        return nt

    def test_hypothesis_handoff_and_feedback(self):
        nt = self.r2()
        ok, detail = R.check_hypothesis_handoff(nt, lambda sha: "t1-r2-e0: Try regexes\n" if sha == "c2" else "")
        self.assertTrue(ok, detail)
        self.assertFalse(R.check_hypothesis_handoff(nt, lambda sha: "t1-r2-e0: other")[0])
        self.assertTrue(R.check_feedback(nt)[0])
        write(nt.night_dir / "reviews/r1.json", {"feedback": "Something else", "hypothesis": "Try regexes"})
        self.assertFalse(R.check_feedback(nt)[0])

    def test_history_needs_coder_part_and_verdict_before_round_2(self):
        nt = self.r2()
        before = {"note": "## r1-e0 · keep\n### Coder\nmock note\n### Reviewer\nGood start.", "diff": False, "r1_decision": "keep"}
        self.assertTrue(R.check_history(nt, before, None)[0])
        self.assertTrue(R.check_history(nt, before, {"files": {"notes/r1-e0.md": before["note"]}})[0])
        self.assertFalse(R.check_history(nt, before, {"files": {}})[0])
        self.assertFalse(R.check_history(nt, {**before, "note": "## r1-e0\n### Coder\nmock note"}, None)[0])
        self.assertFalse(R.check_history(nt, {**before, "r1_decision": "revert"}, None)[0])
        self.assertTrue(R.check_history(nt, {**before, "r1_decision": "revert", "diff": True}, None)[0])
        self.assertFalse(R.check_history(nt, None, None)[0])

    def test_reviewer_model(self):
        nt = self.r2()
        self.assertTrue(R.check_reviewer_model(nt, "p/rev")[0])
        write(nt.night_dir / "reviews/r2.json", {"model": "rev"})
        self.assertFalse(R.check_reviewer_model(nt, "p/rev")[0])

    # --- R3

    def test_meter_costs(self):
        nt = self.night(items=[self.exp("t1", 1, decision="revert", metrics={"model_calls": 4}),
                               {"kind": "test", "decision": "keep", "eval_id": "t", "metrics": {"model_calls": 4}}])
        line = {"kind": "chat", "ok": True, "cost_usd": 0.001, "input_tokens": 10, "output_tokens": 2}
        rows(nt.night_dir / "evals/t1-r1-e0-eval/meter.jsonl", [line, {**line, "cost_usd": 0, "replayed_usd": 0.001}])
        self.assertTrue(R.check_meter_costs(nt)[0])
        rows(nt.night_dir / "evals/t1-test-r1/meter.jsonl", [{**line, "cost_usd": 0}])
        self.assertFalse(R.check_meter_costs(nt)[0])

    def test_meter_costs_needs_model_calls_on_scored_rows(self):
        nt = self.night(items=[self.exp("t1", 1, decision="revert", metrics={"model_calls": 0})])
        rows(nt.night_dir / "evals/e/meter.jsonl", [{"cost_usd": 0.1, "input_tokens": 1}])
        self.assertFalse(R.check_meter_costs(nt)[0])

    def test_meter_costs_skips_a_night_whose_program_called_no_model(self):
        nt = self.night(items=[self.exp("t1", 1, decision="keep", metrics={"model_calls": 0}),
                               {"kind": "test", "decision": "keep", "eval_id": "t", "metrics": {"model_calls": 0}}])
        with self.assertRaises(Skip):
            R.check_meter_costs(nt)
        # With no scored row there is nothing to say a program ran: the test fails.
        self.assertFalse(R.check_meter_costs(self.night(nid="t2"))[0])

    def test_spend_counts_the_reviewer_once_per_round(self):
        nt = self.night(items=[self.exp("t1", 1, coder_usd=0.05, dev_usd=0.01, program_usd=0.01, reviewer_usd=0.02),
                               {"kind": "test", "round": 1, "eval_id": "t", "program_usd": 0.01, "reviewer_usd": 0.02}])
        write(nt.night_dir / "done.json", {"spend_usd": 0.10})
        self.assertTrue(R.check_spend(nt)[0])
        write(nt.night_dir / "done.json", {"spend_usd": 0.13})
        self.assertFalse(R.check_spend(nt)[0])

    # --- held-out items

    def test_held_out_strings_leave_out_short_train_and_given_text(self):
        sc = self.root / "scen"
        items = [{"id": "a", "text": "train example 2020", "gold": "x"}, {"id": "b", "text": "02. Dez. 2021 ok", "gold": "2021-12-02"},
                 {"id": "c", "text": "example 2020", "gold": "y"}, {"id": "d", "text": "in the spec text", "gold": "z"},
                 {"id": "e", "text": "next Saturday please", "gold": "2021-12-02"}]
        rows(sc / "gold/items.jsonl", items)
        write(sc / "gold/splits.json", {"train": ["a"], "dev": ["b", "c", "d", "e"], "test": []})
        write(sc / "spec/agent/SPEC.md", "Example: in the spec text.")
        self.assertEqual(R.held_out_strings(sc, ("dev",)), ["02. Dez. 2021 ok"])
        self.assertEqual(R.find_strings(["02. Dez. 2021 ok"], {"s": "saw 02. Dez. 2021 ok here", "t": "none"}), ["'02. Dez. 2021 ok' in s"])

    def test_session_text_decodes_json_strings(self):
        nt = self.night()
        session(nt.night_dir / "exps/t1-r1-e0/session/s.jsonl", ['quote "02. Dez. 2021"'])
        self.assertIn('"02. Dez. 2021"', R.session_text(nt.night_dir))

    # --- probes

    def test_gold_hashes_skip_empty_and_given_files(self):
        sc = self.root / "scen"
        write(sc / "gold/items.jsonl", "secret")
        write(sc / "evaluators/__init__.py", "")
        write(sc / "evaluators/run.py", "shared")
        write(sc / "starter/run.py", "shared")
        self.assertEqual(sorted(R.gold_hashes(sc).values()), ["gold/items.jsonl"])

    def test_flagged_names_and_hashes(self):
        self.assertEqual(R.flagged_names({"OPENAI_API_KEY", "GPG_KEY", "GITHUB_TOKEN", "PATH", "my_secret"}, {"GPG_KEY"}),
                         ["GITHUB_TOKEN", "my_secret"])
        h = "a" * 64
        self.assertEqual(R.parse_hashes(f"{h}  /repo/x y.py\nnoise\n"), [(h, "/repo/x y.py")])

    def probes(self, coder_probe: dict, evals: dict) -> R.Real:
        p = R.Probes("t1", self.root / "nd", {})
        p.coders["cc-t1-r1-e0"] = {"id": "c1", "first": 0, "probes": [coder_probe]}
        p.evals.update(evals)
        r = R.Real("R2", night=self.night(), probes=p, created=["cc-t1-r1-e0", "cc-t1-r1-e0-eval"])
        write(r.night.night_dir / "evals/t1-r1-e0-eval/meter.jsonl", "")
        return r

    def test_coder_clean(self):
        good = {"session": True, "files": {"/repo": 3, "/spec": 2, "/tmp": 1, "/eval": 0}, "hits": [], "env_names": 9, "env_read": True, "flagged": []}
        self.assertTrue(R.check_coder_clean([self.probes(good, {})])[0])
        self.assertFalse(R.check_coder_clean([self.probes({**good, "hits": ["/tmp/g = gold/items.jsonl"]}, {})])[0])
        self.assertFalse(R.check_coder_clean([self.probes({**good, "flagged": ["ANTHROPIC_API_KEY"]}, {})])[0])
        self.assertFalse(R.check_coder_clean([self.probes({**good, "session": False}, {})])[0])

    def test_eval_separate(self):
        good = {"session": True, "files": {"/repo": 3, "/spec": 2, "/tmp": 1, "/eval": 0}, "hits": [], "env_names": 9, "env_read": True, "flagged": []}
        ev = {"cc-t1-r1-e0-eval": {"id": "e1", "found": [], "tries": 1}}
        self.assertTrue(R.check_eval_separate([self.probes(good, ev)])[0])
        self.assertFalse(R.check_eval_separate([self.probes(good, {"x": {"id": "e1", "found": ["/tmp/notes.md"], "tries": 1}})])[0])
        self.assertFalse(R.check_eval_separate([self.probes(good, {"x": {"id": "c1", "found": [], "tries": 1}})])[0])
        self.assertFalse(R.check_eval_separate([self.probes(good, {})])[0])


if __name__ == "__main__":
    unittest.main()
