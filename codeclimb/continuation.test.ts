import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { coderPrompt, readTrajectory } from "./coder";
import { type NightConfig, parseConfig } from "./config";
import { checkSource, keptOf, lastReview, lastRound, latestNight, priorLog, reopenNight, resolveSeed, scoringHashes, seedFrom } from "./continuation";
import { ExperimentRepo } from "./git";
import { proposalDir } from "./lessons";
import { continueNight, freshNight, initNight, renameKept, rescoreRow } from "./orchestrator";
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

function night(cfg: NightConfig, id: string, startedAt: number, opts: { ended?: boolean } = {}): void {
  const p = nightPaths(cfg, id);
  mkdirSync(join(p.nightDir, "reviews"), { recursive: true });
  writeFileSync(p.nightJson, JSON.stringify({ night_id: id, startedAt, config: cfg, metric_script_sha256: scoringHashes(cfg) }));
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
  const cfg = { ...config(), scenario: { ...config().scenario, headline: ["accuracy"] } };
  night(cfg, "n1", 1);
  appendRows(cfg.results_path, [
    row("n1", 1, 0, "keep", 0.2),
    row("n1", 2, 0, "keep", 0.5, { score: 0.5 }),
    row("n1", 3, 0, "error", 0),
    row("n1", 3, 1, "revert", 0.4, { score: 0.3, decision_reason: "weighted score 0.3000 <= checkpoint 0.5000" }),
    row("n1", 4, 0, "revert", 0.5, { unchanged: true }),
    row("n1", 4, 0, "keep", 0.9, { kind: "test", split: "test" }),
  ]);
  writeFileSync(nightPaths(cfg, "n1").reviewJson(2), JSON.stringify({ keep_reason: "better", feedback: "f1", hypothesis: "next1" }));
  writeFileSync(nightPaths(cfg, "n1").reviewJson(3), JSON.stringify({ keep_reason: "worse", feedback: "f2", hypothesis: "next2" }));
  const log = priorLog(cfg, "n1");
  assert.deepEqual(log.map((l) => l.round), [1, 2, 3, 4]);
  assert.ok(Math.abs(log[1].deltaPrimary - 0.3) < 1e-9);
  assert.ok(Math.abs(log[2].deltas!.accuracy + 0.1) < 1e-9);
  assert.equal(log[2].reason, "weighted score 0.3000 <= checkpoint 0.5000");
  assert.ok(Math.abs(log[2].deltaScore! + 0.2) < 1e-9);
  assert.equal(log[1].reason, "better"); // an older night's row: the reviewer's reason
  assert.equal(log[3].deltaScore, undefined);
  assert.equal(log[3].reason, "no code change");
  assert.match(logLine(log[2], null), /^- r3: h3\.1 → /);
  assert.deepEqual(lastReview(cfg, "n1"), { feedback: "f2", hypothesis: "next2" });
  assert.equal(lastRound(cfg, "n1"), 4);
});

test("reopening adds rounds and a run's budget, keeps the end files beside the night, and allows one continue at a time", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5, { coder_usd: 2 }), row("n1", 3, 0, "revert", 0.4, { coder_usd: 1 })]);
  const p = nightPaths(cfg, "n1");
  const first = reopenNight(cfg, "n1", 2);
  assert.deepEqual([first.config.max_rounds, first.config.budget_usd.night, first.rescore], [5, 8, false]);
  assert.ok(!existsSync(p.doneJson) && existsSync(join(p.nightDir, "done-r3.json")));
  assert.throws(() => reopenNight(cfg, "n1", 2), /hasn't ended/);
  const saved = JSON.parse(readFileSync(p.nightJson, "utf8")) as { startedAt: number; config: NightConfig };
  assert.deepEqual([saved.startedAt, saved.config.max_rounds], [1, 5]);
  // A second continuation adds one run's budget again, not the budget so far.
  writeFileSync(p.stopJson, "{}");
  const second = reopenNight(saved.config, "n1", 1);
  assert.deepEqual([second.config.max_rounds, second.config.budget_usd.night], [4, 8]);
  assert.ok(!existsSync(p.stopJson) && existsSync(join(p.nightDir, "stop-r3.json")));
});

test("reopening sets aside the files of a round that never got its row, so it reruns from scratch", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5), row("n1", 2, 0, "revert", 0.4)]);
  const p = nightPaths(cfg, "n1");
  // Round 3 ran its coder, evaluation and review prompt, then the night failed before its row.
  const kept = [p.expDir("n1-r2-e0"), p.evalDir("n1-r2-e0-eval"), p.evalDir("n1-r1-e0-noise-r2")];
  const left = [p.expDir("n1-r3-e0"), p.evalDir("n1-r3-e0-eval"), p.evalDir("n1-r1-e0-noise-r3")];
  for (const d of [...kept, ...left]) mkdirSync(d, { recursive: true });
  writeFileSync(join(p.expDir("n1-r3-e0"), "code-state.json"), JSON.stringify({ startedAt: 0, stop: "done" }));
  writeFileSync(p.reviewJson(2), "{}");
  writeFileSync(p.reviewPrompt(3), "r3");
  reopenNight(cfg, "n1", 1);
  for (const d of [...kept, p.reviewJson(2)]) assert.ok(existsSync(d), d);
  for (const d of [...left, p.reviewPrompt(3)]) assert.ok(!existsSync(d), d);
  const [aside] = readdirSync(join(p.nightDir, "unfinished"));
  assert.match(aside, /^after-r2-\d+$/);
  assert.ok(existsSync(join(p.nightDir, "unfinished", aside, "exps", "n1-r3-e0", "code-state.json")));
  assert.deepEqual(readdirSync(join(p.nightDir, "unfinished", aside, "evals")).sort(), ["n1-r1-e0-noise-r3", "n1-r3-e0-eval"]);
  assert.deepEqual(readdirSync(join(p.nightDir, "unfinished", aside, "reviews")), ["r3.prompt.md"]);
});

test("changed scorers add a round that scores the kept commit again; with no scores to redo, none", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  night(cfg, "n2", 1);
  const stale = (id: string) => {
    const file = nightPaths(cfg, id).nightJson;
    const n = JSON.parse(readFileSync(file, "utf8")) as { metric_script_sha256: object };
    writeFileSync(file, JSON.stringify({ ...n, metric_script_sha256: { ...n.metric_script_sha256, "gone.jsonl": "x" } }));
  };
  stale("n1");
  stale("n2");
  appendRows(cfg.results_path, [row("n1", 2, 0, "keep", 0.5)]);
  const { config: c, rescore } = reopenNight(cfg, "n1", 2);
  assert.deepEqual([rescore, c.max_rounds], [true, 5]);
  assert.equal(reopenNight(cfg, "n2", 2).rescore, false);
});

test("a continued night picks up its kept commit, learning and rejected diffs, under its own id", async () => {
  const cfg = config();
  night(cfg, "n1", 1);
  const paths = nightPaths(cfg, "n1");
  const repo = new ExperimentRepo(paths.gitDir);
  await repo.ensure();
  const sha = await repo.importDir(join(cfg.scenario_dir, "starter"), "n1-r1-e0");
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5, { commit: sha, coder_usd: 2 }), row("n1", 2, 0, "revert", 0.4)]);
  writeFileSync(paths.reviewJson(2), JSON.stringify({ keep_reason: "worse", feedback: "go on", hypothesis: "try x" }));
  mkdirSync(join(paths.bundleDir, "history"), { recursive: true });
  writeFileSync(join(paths.bundleDir, "history", "r2.diff"), "diff");
  writeFileSync(join(paths.bundleDir, "stale"), "x");
  const { config: reopened } = reopenNight(cfg, "n1", 2);

  writeFileSync(paths.noiseJson, JSON.stringify({ margin: 0.01, expId: "n1-r1-e0", first: 0.5, second: 0.51 }));
  assert.equal((await continueNight(reopened, "n1", { rescore: true })).noise, null); // new scorers, new noise
  const state = await continueNight(reopened, "n1", { direction: "  look at retrieval ", rescore: false });
  assert.equal(state.noise?.margin, 0.01);
  assert.deepEqual([state.kept.expId, state.kept.sha, state.round, state.spend], ["n1-r1-e0", sha, 2, 2]);
  assert.deepEqual([state.kept.score, state.feedback, state.hypothesis, state.direction], [0.5, "go on", "try x", "look at retrieval"]);
  assert.equal(state.history.length, 2);
  assert.match(state.history[1], /^- r2: /);
  assert.ok(existsSync(join(paths.bundleDir, "history", "r2.diff")), "rejected diffs stay");
  assert.ok(!existsSync(join(paths.bundleDir, "stale")), "the bundle is rebuilt");
  assert.ok(existsSync(join(paths.bundleDir, "spec")));

  // The rescored commit stays findable for the next continuation, even if scoring it failed.
  const rescored = await renameKept(reopened, "n1", state.kept, "n1-r3-e0");
  assert.equal(await repo.sha("n1-r3-e0"), sha);
  const failed = rescoreRow({ cfg: reopened, nightId: "n1", round: 3 }, rescored, { ok: false, evalId: "e", error: "boom" });
  assert.deepEqual([failed.decision, failed.exp_id, failed.commit, failed.metrics.accuracy], ["keep", "n1-r3-e0", sha, 0.5]);
});

test("a direction reaches the coder ahead of the trajectory", () => {
  const prompt = coderPrompt("spec", "<round n=\"1\" latest>\n</round>", null, 10, undefined, undefined, undefined, [], [], false, "work on retrieval");
  assert.ok(prompt.indexOf("<direction>") > 0 && prompt.indexOf("<direction>") < prompt.indexOf("<trajectory>"));
  assert.match(prompt, /every round[\s\S]*work on retrieval/);
  assert.doesNotMatch(coderPrompt("spec", "", null, 10), /<direction>/);
});

test("a seed is an ended night's kept commit: by id, the newest, or the best weighted dev score under the current scorers", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  night(cfg, "n2", 2);
  night(cfg, "n3", 3);
  night(cfg, "n4", 4);
  const file = nightPaths(cfg, "n4").nightJson;
  const n4 = JSON.parse(readFileSync(file, "utf8")) as { metric_script_sha256: object };
  writeFileSync(file, JSON.stringify({ ...n4, metric_script_sha256: { ...n4.metric_script_sha256, "gone.jsonl": "x" } }));
  appendRows(cfg.results_path, [
    row("n1", 1, 0, "keep", 0.7),
    row("n2", 1, 0, "keep", 0.6),
    row("n2", 2, 0, "revert", 0.9),
    row("n4", 1, 0, "keep", 0.95),
    // Test rows never count.
    row("n2", 2, 0, "keep", 0.99, { kind: "test", split: "test" }),
  ]);
  assert.equal(resolveSeed(cfg, "latest"), "n4");
  assert.equal(resolveSeed(cfg, "n2"), "n2");
  assert.equal(resolveSeed(cfg, "best"), "n1", "n2's best is a revert, n3 kept nothing, n4 was scored by other scorers");
  assert.throws(() => seedFrom(cfg, "n3"), /kept nothing/);
  assert.deepEqual(seedFrom(cfg, "n2"), { night: "n2", expId: "n2-r1-e0", round: 2, score: 0.6, metrics: { accuracy: 0.6 }, rescore: false });
  assert.equal(seedFrom(cfg, "n4").rescore, true);
});

test("a seed waits for its night's lessons when that night applies them", () => {
  const cfg = config();
  night(cfg, "n1", 1);
  const paths = nightPaths(cfg, "n1");
  const saved = JSON.parse(readFileSync(paths.nightJson, "utf8")) as Record<string, unknown>;
  writeFileSync(paths.nightJson, JSON.stringify({ ...saved, config: { ...cfg, lessons: "apply", scenario: { ...cfg.scenario, lessons: "spec/agent/lessons.md" } } }));
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.7)]);
  mkdirSync(join(paths.bundleDir, "history", "notes"), { recursive: true });
  writeFileSync(join(paths.bundleDir, "history", "notes", "r1-e0.md"), "## r1-e0 · keep");
  assert.throws(() => seedFrom(cfg, "n1"), /lessons are not in lessons\.md yet \(applied through round 0\)/);
  const dir = proposalDir(cfg, "n1", 1);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proposal.json"), JSON.stringify({ applied: false }));
  assert.throws(() => seedFrom(cfg, "n1"), /not in lessons\.md yet/, "proposed is not applied");
  writeFileSync(join(dir, "proposal.json"), JSON.stringify({ applied: true }));
  assert.equal(seedFrom(cfg, "n1").expId, "n1-r1-e0");
});

test("a seeded night starts at its seed's commit, scores and noise, and its coders are told where it started", async () => {
  const cfg = config();
  night(cfg, "n1", 1);
  const src = nightPaths(cfg, "n1");
  const repo = new ExperimentRepo(src.gitDir);
  await repo.ensure();
  const sha = await repo.importDir(join(cfg.scenario_dir, "evaluators"), "n1-r2-e0");
  appendRows(cfg.results_path, [row("n1", 1, 0, "keep", 0.5), row("n1", 2, 0, "keep", 0.7, { commit: sha })]);
  writeFileSync(src.noiseJson, JSON.stringify({ margin: 0.01, expId: "n1-r1-e0", first: 0.5, second: 0.51 }));

  const init = await initNight({ ...cfg, seed: "n1" }, "n2");
  const state = freshNight(init);
  assert.deepEqual([state.kept.expId, state.kept.sha, state.kept.score, state.kept.metrics], ["n2-r0-seed", sha, 0.7, { accuracy: 0.7 }]);
  assert.deepEqual([state.rescore, state.noise?.margin, state.round], [false, 0.01, 0]);
  assert.deepEqual(keptOf(cfg, "n2"), { expId: "n2-r0-seed", score: 0.7, metrics: { accuracy: 0.7 } }, "a seeded night that keeps nothing still has its seed");
  const paths = nightPaths(cfg, "n2");
  assert.match(readTrajectory(paths, [], 1), /^<start>\nThis night starts from the kept commit of an earlier night \(n1, after its round 2\)[^]*must beat them[^]*<\/start>$/);
  assert.doesNotMatch(readTrajectory(src, [], 1), /<start>/);
  // Its log moves from the seed's scores.
  writeFileSync(paths.doneJson, "{}");
  appendRows(cfg.results_path, [row("n2", 1, 0, "keep", 0.8, { eval_id: "n2-r1-e0-eval" })]);
  assert.ok(Math.abs(priorLog(cfg, "n2")[0].deltaPrimary - 0.1) < 1e-9);

  const fresh = freshNight(await initNight(cfg, "n3"));
  assert.deepEqual([fresh.kept.expId, fresh.kept.score, fresh.kept.metrics, fresh.noise], ["n3-r0-starter", 0, null, null]);
});
