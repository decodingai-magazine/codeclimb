import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportExperiment, resolveExpId, validateBranch, validateExpId, validateRemote } from "./export";
import { ExperimentRepo } from "./git";
import { buildReportData, nightSpend } from "./report/data";
import { renderReport } from "./report/html";
import type { ResultRow } from "./results";

const row = (over: Partial<ResultRow>): ResultRow => ({
  exp_id: "n-r1-b0", parent_id: "n-r0-starter", round: 1, stack: "inngest", split: "opt", val_fold: 0, model: "p/a",
  reviewer_model: "p/c", hypothesis: "h", commit: "", metrics: { accuracy: 0.5 }, coder_usd: 0.1, program_usd: 0,
  reviewer_usd: 0, tokens: 0, wall_s: 1, decision: "keep", backend: "docker", t_provision: 0, t_code: 1, t_eval: 0,
  t_review: 0, t_teardown: 0, infra_errors: 0, kind: "experiment", eval_id: "e", night_id: "n", ...over,
});

test("export validation refuses option injection, command transports and bad names", async () => {
  for (const bad of ["-u", "--upload-pack=x", "ext::sh -c id", "fd::3", "ftp://host/repo.git", "a b", ""]) {
    assert.throws(() => validateRemote(bad), Error, bad);
  }
  for (const ok of ["https://github.com/a/b.git", "git@github.com:a/b.git", "ssh://git@host/r.git", "/tmp/repo.git"]) {
    assert.doesNotThrow(() => validateRemote(ok), ok);
  }
  await assert.rejects(validateBranch("a..b"));
  await assert.rejects(validateBranch("-x"));
  await validateBranch("codeclimb/n-r6-b2");
  assert.throws(() => validateExpId("../x"));
  assert.doesNotThrow(() => validateExpId("hard2-r6-b2"));
});

test("night spend counts the round's reviewer cost once, not once per row", () => {
  const rows = [
    row({ coder_usd: 0.1, reviewer_usd: 0.05 }),
    row({ exp_id: "n-r1-b1", coder_usd: 0.2, reviewer_usd: 0.05 }),
    row({ exp_id: "n-r2-b0", round: 2, coder_usd: 0.1, reviewer_usd: 0.02 }),
  ];
  assert.equal(nightSpend(rows), 0.47);
});

test("export to a folder, refuse a non-empty one, push lineage to a bare remote", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cc-export-"));
  const src = join(tmp, "src");
  mkdirSync(src);
  writeFileSync(join(src, "main.py"), "print('hi')\n");
  const repo = new ExperimentRepo(join(tmp, "experiments.git"));
  await repo.ensure();
  await repo.importDir(src, "n-r1-b0");

  const out = join(tmp, "out");
  const r = await exportExperiment(repo.gitDir, "n-r1-b0", { kind: "dir", path: out });
  assert.equal(readFileSync(join(out, "main.py"), "utf8"), "print('hi')\n");
  assert.match(r.log, /wrote 1 files/);
  await assert.rejects(exportExperiment(repo.gitDir, "n-r1-b0", { kind: "dir", path: out }), /not empty/);
  await exportExperiment(repo.gitDir, "n-r1-b0", { kind: "dir", path: out, force: true });
  await assert.rejects(exportExperiment(repo.gitDir, "n-r9-b9", { kind: "dir", path: join(tmp, "x") }), /no commit/);

  const hist = join(tmp, "hist");
  const h = await exportExperiment(repo.gitDir, "n-r1-b0", { kind: "dir", path: hist, withHistory: true });
  assert.equal(h.branch, "codeclimb/n-r1-b0");
  assert.ok(existsSync(join(hist, ".git")) && existsSync(join(hist, "main.py")));

  const remote = join(tmp, "remote.git");
  await new ExperimentRepo(remote).ensure();
  const p = await exportExperiment(repo.gitDir, "n-r1-b0", { kind: "remote", url: remote });
  assert.equal(p.branch, "codeclimb/n-r1-b0");
  assert.equal(await new ExperimentRepo(remote)["git"](["rev-parse", "codeclimb/n-r1-b0"]), r.sha);
});

test("report data reads every night, saved reviews and done.json; best resolves to the latest kept", async () => {
  const root = mkdtempSync(join(tmpdir(), "cc-report-"));
  const results = join(root, "results.jsonl");
  const rows = [
    row({ night_id: "a", exp_id: "a-r1-b0", hypothesis: "</script><script>alert(1)</script>" }),
    row({ night_id: "b", exp_id: "b-r1-b0", reviewer_usd: 0.05 }),
    row({ night_id: "b", exp_id: "b-r1-b1", reviewer_usd: 0.05, decision: "revert" }),
  ];
  writeFileSync(results, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  for (const [id, at] of [["a", 1], ["b", 2]] as const) {
    mkdirSync(join(root, "nights", id, "reviews"), { recursive: true });
    writeFileSync(join(root, "nights", id, "night.json"), JSON.stringify({ startedAt: at }));
  }
  writeFileSync(join(root, "nights", "b", "reviews", "r1.json"), JSON.stringify({ round: 1, feedback: "f", hypotheses: ["x"], reviewer_usd: 0.05 }));
  writeFileSync(join(root, "nights", "b", "done.json"), JSON.stringify({
    stop_reason: "thresholds", rounds: 1, validations: 1, kept: { exp_id: "b-r1-b0", commit: "c", opt_score: 0.5 }, spend_usd: 0.25, finished_at: "2026-01-01T00:00:00Z",
  }));

  const data = await buildReportData(results, { diffs: false });
  assert.deepEqual(data.nights.map((n) => n.id), ["a", "b"]);
  assert.equal(data.nights[0].spend_usd, 0.1); // no done.json: summed from rows
  assert.equal(data.nights[1].spend_usd, 0.25); // done.json wins
  assert.deepEqual(data.nights[1].reviews, [{ round: 1, model: undefined, feedback: "f", hypotheses: ["x"] }]);
  assert.equal(resolveExpId(root, "best"), "b-r1-b0");

  // LLM text can't close the data script tag and inject markup.
  const html = renderReport(data);
  const boot = /<script id="cc-boot" type="application\/json">([\s\S]*?)<\/script>/.exec(html)![1];
  assert.ok(!boot.includes("<"));
  assert.equal(JSON.parse(boot).data.nights[0].rows[0].hypothesis, "</script><script>alert(1)</script>");
});
