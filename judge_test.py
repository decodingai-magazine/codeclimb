"""judge.py without a model call: the prompt, the schema, the build copy and the agreement rule."""

import json
import tempfile
import unittest
from pathlib import Path

from judge import CHECKLIST, agree, copy_build, prompt, schema


class Judge(unittest.TestCase):
    def test_prompt_and_schema_cover_every_item(self):
        keys = [k for k, _, _ in CHECKLIST]
        self.assertEqual(schema()["required"], keys)
        for k in keys:
            self.assertIn(f"`{k}`", prompt("inngest"))

    def test_every_item_names_its_deterministic_check(self):
        self.assertTrue(all(check for _, _, check in CHECKLIST))

    def test_copy_leaves_out_secrets_and_generated_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            app, dest = Path(tmp) / "app", Path(tmp) / "copy"
            for f in ("src/a.ts", ".env", "node_modules/x/i.js", ".git/HEAD", "runs-inngest/n.json", "SPEC.md"):
                (app / f).parent.mkdir(parents=True, exist_ok=True)
                (app / f).write_text("x")
            copy_build(app, dest)
            self.assertEqual(sorted(p.relative_to(dest).as_posix() for p in dest.rglob("*") if p.is_file()),
                             ["SPEC.md", "src/a.ts"])

    def test_on_after_five_builds_that_agree_on_every_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            trials = []
            for i in range(6):
                t = Path(tmp) / f"t{i}"
                t.mkdir()
                answers = {k: {"answer": True, "evidence": [], "why": ""} for k, _, _ in CHECKLIST}
                (t / "judge.json").write_text(json.dumps({"answers": answers}))
                operator = {k: True for k, _, _ in CHECKLIST}
                if i == 5:
                    operator[CHECKLIST[0][0]] = False
                (t / "judge-operator.json").write_text(json.dumps(operator))
                trials.append(t)
            self.assertTrue(agree(trials[:5])["on"])
            got = agree(trials)
            self.assertFalse(got["on"])  # one build disagrees
            self.assertEqual(got["per_item"][CHECKLIST[0][0]], {"agree": 5, "disagree": 1})


if __name__ == "__main__":
    unittest.main()
