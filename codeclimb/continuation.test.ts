import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { coderPrompt, readTrajectory } from "./coder";
import { type NightConfig, parseConfig } from "./config";
import { checkSource, keptOf, latestNight, resolveSeed, scoringHashes, seedFrom } from "./continuation";
import { ExperimentRepo } from "./git";
import { proposalDir } from "./lessons";
import { freshNight, initNight, renameKept, rescoreRow } from "./orchestrator";
import { nightPaths } from "./paths";
import { appendRows, type ResultRow } from "./results";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function config(): NightConfig {
  const dir = mkdtempSync(join(tmpdir(), "cc-seed-"));
  dirs.push(dir);
  const cfg = parseConfig(
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
results_path: seed/r.jsonl
`,
    ROOT,
  );
  return { ...cfg, results_path: join(dir, "r.jsonl") };
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

test("the latest night is the newest that ended; a running night or another scenario can't be a seed", () => {
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

test("a rescored kept commit stays findable under its new id, even if scoring it failed", async () => {
  const cfg = config();
  night(cfg, "n1", 1);
  const repo = new ExperimentRepo(nightPaths(cfg, "n1").gitDir);
  await repo.ensure();
  const sha = await repo.importDir(join(cfg.scenario_dir, "starter"), "n1-r1-e0");
  const rescored = await renameKept(cfg, "n1", { expId: "n1-r1-e0", sha, score: 0.5, metrics: { accuracy: 0.5 } }, "n1-r3-e0");
  assert.equal(await repo.sha("n1-r3-e0"), sha);
  const failed = rescoreRow({ cfg, nightId: "n1", round: 3 }, rescored, { ok: false, evalId: "e", error: "boom" });
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

  const fresh = freshNight(await initNight(cfg, "n3"));
  assert.deepEqual([fresh.kept.expId, fresh.kept.score, fresh.kept.metrics, fresh.noise], ["n3-r0-starter", 0, null, null]);
});
