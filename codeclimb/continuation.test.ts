import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { coderPrompt } from "./coder";
import { type NightConfig, parseConfig } from "./config";
import { carryRejected, checkSource, keptOf, lastReview, latestNight, priorLog } from "./continuation";
import { ExperimentRepo } from "./git";
import { baselineRow, continueNight } from "./orchestrator";
import { nightPaths } from "./paths";
import { appendRows, type ResultRow } from "./results";
import { logLine } from "./reviewer";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function config(): NightConfig {
  const dir = mkdtempSync(join(tmpdir(), "cc-continue-"));
  dirs.push(dir);
  return parseConfig(
    `scenario: scenarios/capitals
sandbox: docker
max_rounds: 2
deadline: 90m
timeouts: { experiment_min: 10, eval_min: 3 }
model: p/a
reviewer_model: p/c
primary_metric: accuracy
thresholds: { accuracy: 0.9 }
budget_usd: { experiment: 1, night: 5 }
results_path: ${join(dir, "r.jsonl")}
`,
    ROOT,
  );
}

const row = (night: string, round: number, e: number, decision: ResultRow["decision"], accuracy: number, extra: Partial<ResultRow> = {}): ResultRow => ({
  exp_id: `${night}-r${round}-e${e}`, parent_id: null, round, stack: "inngest", split: "dev", model: "p/a", reviewer_model: "p/c", hypothesis: `h${round}.${e}`,
  commit: "abc", metrics: { accuracy }, coder_usd: 0, program_usd: 0, reviewer_usd: 0, tokens: 0, wall_s: 0, decision, backend: "docker", t_provision: 0,
  t_code: 0, t_eval: 0, t_review: 0, t_teardown: 0, infra_errors: 0, kind: "experiment", eval_id: "", night_id: night, ...extra,
});

function night(cfg: NightConfig, id: string, startedAt: number, opts: { ended?: boolean; continued?: object } = {}): void {
  const p = nightPaths(cfg, id);
  mkdirSync(join(p.nightDir, "reviews"), { recursive: true });
  writeFileSync(p.nightJson, JSON.stringify({ night_id: id, startedAt, config: cfg, ...(opts.continued ? { continued: opts.continued } : {}) }));
  if (opts.ended !== false) writeFileSync(p.doneJson, "{}");
}

test("the default night is the newest that ended; a running night or another scenario can't be continued", () => {
  const cfg = config();
  assert.throws(() => latestNight(cfg), /no finished night/);
  night(cfg, "n1", 1);
  night(cfg, "n2", 3);
  night(cfg, "n3", 9, { ended: false });
  assert.equal(latestNight(cfg), "n2");
  checkSource(cfg, "n2");
  assert.throws(() => checkSource(cfg, "n3"), /hasn't ended/);
  assert.throws(() => checkSource(cfg, "n9"), /no night n9/);
  const other = { ...cfg, scenario: { ...cfg.scenario, name: "other" } };
  assert.throws(() => checkSource(other, "n2"), /ran scenario/);
});

test("the checkpoint is the last keep, or the starter when nothing was kept", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  assert.deepEqual(keptOf(cfg, "n1"), { expId: "n1-r0-starter", score: 0, metrics: null });
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5), row("n1", 2, 0, "revert", 0.9), row("n1", 2, 0, "keep", 0.7, { kind: "test", split: "test" })]);
  assert.deepEqual(keptOf(cfg, "n1"), { expId: "n1-r1-e0", score: 0.5, metrics: { accuracy: 0.5 } });
});

test("the log comes back from the rows: deltas against the checkpoint of the time, a repair stands for its round", () => {
  const cfg = { ...config(), scenario: { ...config().scenario, headline: { accuracy: 0.02 } } };
  night(cfg, "n1", 1, { continued: { from: "n0", direction: "", prior: [{ round: 1, label: "n0-r1", hypothesis: "old", deltaPrimary: 0.1, decision: "keep" }] } });
  appendRows(cfg.results_path, [
    row("n1", 0, 0, "keep", 0.2),
    row("n1", 1, 0, "keep", 0.5),
    row("n1", 2, 0, "error", 0),
    row("n1", 2, 1, "revert", 0.4),
    row("n1", 3, 0, "revert", 0.5, { unchanged: true }),
  ]);
  writeFileSync(nightPaths(cfg, "n1").reviewJson(1), JSON.stringify({ keep_reason: "better", feedback: "f1", hypothesis: "next1" }));
  writeFileSync(nightPaths(cfg, "n1").reviewJson(2), JSON.stringify({ keep_reason: "worse", feedback: "f2", hypothesis: "next2" }));
  const log = priorLog(cfg, "n1");
  assert.deepEqual(log.map((l) => l.label), ["n0-r1", "n1-r1", "n1-r2", "n1-r3"]);
  assert.ok(Math.abs(log[1].deltaPrimary - 0.3) < 1e-9);
  assert.ok(Math.abs(log[2].deltas!.accuracy + 0.1) < 1e-9);
  assert.equal(log[2].reason, "worse");
  assert.equal(log[3].reason, "no code change");
  assert.match(logLine(log[2], null), /^- n1-r2: h2\.1 → /);
  assert.deepEqual(lastReview(cfg, "n1"), { feedback: "f2", hypothesis: "next2" });
});

test("a continued night starts from the earlier night's kept commit, with its learning and rejected diffs", async () => {
  const cfg = config();
  night(cfg, "n1", 1);
  const repo = new ExperimentRepo(nightPaths(cfg, "n1").gitDir);
  await repo.ensure();
  const sha = await repo.importDir(join(cfg.scenario_dir, "starter"), "n1-r1-e0");
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5, { commit: sha }), row("n1", 2, 0, "revert", 0.4)]);
  writeFileSync(nightPaths(cfg, "n1").reviewJson(2), JSON.stringify({ keep_reason: "worse", feedback: "go on", hypothesis: "try x" }));
  const history = join(nightPaths(cfg, "n1").bundleDir, "history");
  mkdirSync(history, { recursive: true });
  writeFileSync(join(history, "r2.diff"), "diff");
  writeFileSync(join(history, "n0-r1.diff"), "older diff");
  night(cfg, "n2", 2, { ended: false });

  const carried = await continueNight(cfg, "n2", { from: "n1", direction: "  look at retrieval " });
  assert.equal(carried.kept.expId, "n2-r0-from");
  assert.equal(carried.kept.sha, sha);
  assert.equal(await repo.sha("n2-r0-from"), sha);
  assert.deepEqual([carried.kept.score, carried.feedback, carried.hypothesis, carried.direction], [0.5, "go on", "try x", "look at retrieval"]);
  assert.equal(carried.history.length, 2);
  assert.match(carried.history[1], /^- n1-r2: /);
  const bundle = join(nightPaths(cfg, "n2").bundleDir, "history");
  assert.ok(existsSync(join(bundle, "n1-r2.diff")) && existsSync(join(bundle, "n0-r1.diff")));
  const saved = JSON.parse(readFileSync(nightPaths(cfg, "n2").nightJson, "utf8")) as { continued: { from: string; prior: unknown[] } };
  assert.equal(saved.continued.from, "n1");
  assert.equal(saved.continued.prior.length, 2);
  // The new checkpoint stays findable for the next continuation, even if scoring it failed.
  const failed = baselineRow({ cfg, nightId: "n2", round: 0 }, carried.kept, "n1", { ok: false, evalId: "e", error: "boom" });
  assert.deepEqual([failed.decision, failed.exp_id, failed.commit, failed.metrics.accuracy], ["keep", "n2-r0-from", sha, 0.5]);
});

test("nothing to carry: no rejected diffs is no history directory", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  carryRejected(cfg, "n1", "n2");
  assert.ok(!existsSync(join(nightPaths(cfg, "n2").bundleDir, "history")));
});

test("a direction reaches the coder ahead of the feedback", () => {
  const prompt = coderPrompt("spec", "feedback", null, 10, undefined, undefined, undefined, [], [], [], false, "work on retrieval");
  assert.ok(prompt.indexOf("<direction>") > 0 && prompt.indexOf("<direction>") < prompt.indexOf("<feedback>"));
  assert.match(prompt, /every round[\s\S]*work on retrieval/);
  assert.doesNotMatch(coderPrompt("spec", "", null, 10), /<direction>/);
});
