import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type NightConfig, parseConfig } from "./config";
import {
  applyOps,
  applyProposal,
  checkOps,
  distillPrompt,
  gatherNight,
  type Ledger,
  LESSON_CAP,
  ledgerText,
  parseLedger,
  parseOps,
  proposeLessons,
  readLedger,
  renderLessons,
  sha256,
  writeProposal,
} from "./lessons";
import { nightPaths } from "./paths";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const YAML = `
scenario: scenarios/capitals
sandbox: docker
max_rounds: 2
deadline: 90m
timeouts: { experiment_min: 10, eval_min: 3 }
model: p/a
reviewer_model: p/c
primary_metric: accuracy
thresholds: { accuracy: 0.9 }
budget_usd: { experiment: 1, night: 5 }
results_path: runs/capitals/results.jsonl
`;

const ledger = (): Ledger => ({
  title: "What earlier attempts learned",
  preamble: "Lessons from earlier nights.",
  sections: [
    { id: "worked", heading: "Worked" },
    { id: "failed", heading: "Failed, more than once", once: "Failed once, not yet confirmed" },
  ],
  lessons: [
    { id: "L001", section: "worked", text: "Extracting by section raised recall.", status: "active", support: [{ night: "n1", note: "r2" }], contradict: [] },
    { id: "L002", section: "failed", text: "Relation filters cost recall.", status: "active", support: [{ night: "n1", note: "r3" }, { night: "n2", note: "r1" }], contradict: [] },
    { id: "L003", section: "failed", text: "A second few-shot document hurt.", status: "active", support: [{ night: "n2", note: "r4" }], contradict: [] },
    { id: "L004", section: "worked", text: "An old lesson.", status: "retired", support: [{ night: "n1", note: "r1" }], contradict: [] },
  ],
  nights: {},
});

const noScan = async () => [];

/** A scenario dir with a ledger, and a config whose night results go under the same temp dir. */
function scenarioCfg(): NightConfig {
  const dir = mkdtempSync(join(tmpdir(), "cc-lessons-"));
  mkdirSync(join(dir, "memory"));
  mkdirSync(join(dir, "spec", "agent"), { recursive: true });
  writeFileSync(join(dir, "memory", "lessons.json"), ledgerText(ledger()));
  const base = parseConfig(YAML, ROOT);
  return {
    ...base, scenario_dir: dir, scenario: { ...base.scenario, lessons: { file: "spec/agent/lessons.md", ledger: "memory/lessons.json" } },
    results_path: join(dir, "runs", "results.jsonl"), lessons: "propose", mock: true,
  };
}

/** A night's notes and reviews, plus what must never reach a lesson: test metrics, a review prompt. */
function writeNight(cfg: NightConfig, nightId: string, rounds: number[]): void {
  const p = nightPaths(cfg, nightId);
  const notes = join(p.bundleDir, "history", "notes");
  mkdirSync(notes, { recursive: true });
  mkdirSync(join(p.bundleDir, "spec"), { recursive: true });
  mkdirSync(join(p.nightDir, "reviews"), { recursive: true });
  mkdirSync(join(p.nightDir, "evals", `${nightId}-test-r2`), { recursive: true });
  writeFileSync(join(p.bundleDir, "spec", "task.md"), "# Task\n");
  writeFileSync(join(p.bundleDir, "spec", "lessons.md"), "# Lessons the night had\n");
  for (const r of rounds) {
    writeFileSync(join(notes, `r${r}-e0.md`), `## r${r}-e0 · revert\nround ${r} note`);
    writeFileSync(join(p.nightDir, "reviews", `r${r}.json`), JSON.stringify({ feedback: `feedback ${r}`, hypothesis: `hypothesis ${r}`, verdict: "v" }));
    writeFileSync(join(p.nightDir, "reviews", `r${r}.prompt.md`), "per-item errors 0.987654");
  }
  writeFileSync(p.doneJson, JSON.stringify({ test_metrics: { "extraction.mentions.f1": 0.123456 } }));
  writeFileSync(join(p.nightDir, "evals", `${nightId}-test-r2`, "metrics.json"), JSON.stringify({ f1: 0.123456 }));
}

test("lessons: render puts a failed lesson one night supports apart, and leaves retired ones out", () => {
  const md = renderLessons(ledger());
  assert.match(md, /^# What earlier attempts learned\n/);
  assert.match(md, /## Worked\n\n- Extracting by section raised recall\.\n/);
  assert.match(md, /## Failed, more than once\n\n- Relation filters cost recall\.\n/);
  assert.match(md, /## Failed once, not yet confirmed\n\n- A second few-shot document hurt\.\n/);
  assert.doesNotMatch(md, /An old lesson/);
});

test("lessons: render wraps bullets at 100 columns with a two-space continuation", () => {
  const l = ledger();
  l.lessons[0].text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const lines = renderLessons(l).split("\n");
  assert.ok(lines.every((x) => x.length <= 100));
  const at = lines.findIndex((x) => x.startsWith("- word0"));
  assert.ok(lines[at + 1].startsWith("  word"));
});

test("lessons: the graphrag-lite ledger renders the shipped lessons.md, with the headings task.md cites", () => {
  const dir = join(ROOT, "scenarios", "graphrag-lite");
  const md = renderLessons(parseLedger(readFileSync(join(dir, "memory", "lessons.json"), "utf8")));
  assert.equal(md, readFileSync(join(dir, "spec", "agent", "lessons.md"), "utf8"), "lessons.md was edited by hand: edit the ledger and run `npm run lessons -- render`");
  for (const heading of ["Failed, more than once", "The lever for relations"]) assert.match(md, new RegExp(`^## ${heading}$`, "m"));
});

test("lessons: parseOps reads the ops and leaves malformed ones out", () => {
  const ops = parseOps(`Here: {"ops": [
    {"op": "add", "section": "worked", "text": "t", "evidence": "r1", "round": 1},
    {"op": "support", "id": "L001", "evidence": "r2"},
    {"op": "support", "id": "L001"},
    {"op": "explode", "id": "L001", "evidence": "x"}
  ]}`);
  assert.deepEqual(ops, [
    { op: "add", section: "worked", text: "t", evidence: "r1", round: 1 },
    { op: "support", id: "L001", evidence: "r2" },
  ]);
  assert.equal(parseOps("no json"), null);
  assert.equal(parseOps('{"feedback": "x"}'), null);
});

test("lessons: the gates reject metric values, held-out names, unknown ids and a full ledger", async () => {
  const l = ledger();
  const scan = async (text: string) => (text.includes("Zephyr") ? ["Zephyr"] : []);
  const { ok, rejected } = await checkOps(
    l,
    [
      { op: "add", section: "worked", text: "Mention F1 rose to 0.71.", evidence: "r1" },
      { op: "add", section: "worked", text: "Recall rose by 12%.", evidence: "r1" },
      { op: "add", section: "worked", text: "The Zephyr article loops.", evidence: "r1" },
      { op: "add", section: "nowhere", text: "x", evidence: "r1" },
      { op: "support", id: "L004", evidence: "retired" },
      { op: "support", id: "L999", evidence: "unknown" },
      { op: "reword", id: "L001", text: "x".repeat(401), evidence: "too long" },
      { op: "add", section: "worked", text: "Calling jev-1.14 per pair with a high threshold kept precision.", evidence: "Zephyr in r2 at 0.71" },
      { op: "support", id: "L002", evidence: "r3" },
    ],
    scan,
  );
  assert.deepEqual(rejected.map((r) => r.why.split(":")[0].split(" ").slice(0, 3).join(" ")), [
    "holds a decimal", "holds a decimal", "names evaluation items", "no section nowhere;", "no active lesson", "no active lesson", "over 400 characters",
  ]);
  assert.equal(ok.length, 2);
  assert.equal((ok[0] as { evidence: string }).evidence, "[hidden] in r2 at 0.71", "evidence is masked, not rejected");
  const full: Ledger = { ...l, lessons: Array.from({ length: LESSON_CAP }, (_, i) => ({ ...l.lessons[0], id: `L${i + 1}` })) };
  const capped = await checkOps(full, [{ op: "retire", id: "L1", evidence: "merged" }, { op: "add", section: "worked", text: "new", evidence: "r1" }, { op: "add", section: "worked", text: "more", evidence: "r1" }], noScan);
  assert.equal(capped.ok.length, 2, "a retirement makes room for one add");
  assert.match(capped.rejected[0].why, /merge/);
});

test("lessons: applyOps adds, supports once per night, rewords with history, retires", () => {
  const out = applyOps(
    ledger(),
    [
      { op: "add", section: "failed", text: "Raising max_tokens kept the loop.", evidence: "r2", round: 2 },
      { op: "support", id: "L003", evidence: "r1" },
      { op: "support", id: "L003", evidence: "r4 again" },
      { op: "contradict", id: "L002", evidence: "r3" },
      { op: "reword", id: "L001", text: "Extracting by section raised mention recall.", evidence: "r5" },
      { op: "retire", id: "L001", evidence: "r6" },
    ],
    "n3",
    6,
  );
  const by = new Map(out.lessons.map((x) => [x.id, x]));
  assert.deepEqual(by.get("L005"), { id: "L005", section: "failed", text: "Raising max_tokens kept the loop.", status: "active", support: [{ night: "n3", round: 2, note: "r2" }], contradict: [] });
  assert.deepEqual(by.get("L003")!.support.map((e) => e.night), ["n2", "n3"]);
  assert.equal(by.get("L002")!.contradict[0].night, "n3");
  assert.deepEqual(by.get("L001")!.history, [{ night: "n3", text: "Extracting by section raised recall." }]);
  assert.equal(by.get("L001")!.status, "retired");
  assert.deepEqual(out.nights, { n3: 6 });
  assert.equal(ledger().lessons[2].support.length, 1, "the input ledger is unchanged");
  assert.match(renderLessons(out), /## Failed, more than once\n\n- Relation filters cost recall\.\n- A second few-shot document hurt\./, "a second night confirms it");
});

test("lessons: a night is read from its notes and reviews only, never from test or the review prompts", () => {
  const cfg = scenarioCfg();
  writeNight(cfg, "n5", [1, 2]);
  const rounds = gatherNight(nightPaths(cfg, "n5").nightDir);
  assert.deepEqual(rounds.map((r) => r.round), [1, 2]);
  const prompt = distillPrompt({ model: "m", thinkingLevel: "low", nightId: "n5", spec: "spec", ledger: ledger(), rounds });
  assert.match(prompt, /round 2 note/);
  assert.match(prompt, /hypothesis 1/);
  assert.doesNotMatch(prompt, /0\.123456/, "a test metric reached the distiller");
  assert.doesNotMatch(prompt, /0\.987654/, "a review prompt reached the distiller");
  assert.doesNotMatch(prompt, /An old lesson/, "retired lessons stay out");
});

test("lessons: a continued night is distilled from the round after the last one the ledger holds", () => {
  const cfg = scenarioCfg();
  writeNight(cfg, "n6", [1, 2, 3, 4]);
  assert.deepEqual(gatherNight(nightPaths(cfg, "n6").nightDir, 2).map((r) => r.round), [3, 4]);
});

test("lessons: propose, skip a repeat, apply, and refuse a stale proposal", async () => {
  const cfg = scenarioCfg();
  writeNight(cfg, "n7", [1, 2]);
  const proposal = await proposeLessons(cfg, "n7", noScan);
  assert.ok(proposal);
  assert.equal(proposal.lastRound, 2);
  assert.deepEqual(proposal.ops, [], "the mock model teaches nothing");
  const { dir, applied } = writeProposal(cfg, proposal, true);
  assert.equal(applied, false, "a mock night never writes the scenario's ledger");
  assert.equal(await proposeLessons(cfg, "n7", noScan), null, "the same rounds are proposed once");
  applyProposal(cfg, dir);
  assert.deepEqual(readLedger(cfg).nights, { n7: 2 });
  assert.equal(readFileSync(join(cfg.scenario_dir, "spec", "agent", "lessons.md"), "utf8"), renderLessons(readLedger(cfg)));
  assert.throws(() => applyProposal(cfg, dir), /changed since/);
  writeNight(cfg, "n7", [1, 2, 3]);
  const next = await proposeLessons(cfg, "n7", noScan);
  assert.equal(next?.fromRound, 2);
  assert.equal(next?.base_sha256, sha256(readFileSync(join(cfg.scenario_dir, "memory", "lessons.json"), "utf8")));
});

test("lessons: config defaults to propose when the scenario declares lessons, and checks the mode", () => {
  assert.equal(parseConfig(YAML, ROOT).lessons, "off");
  assert.throws(() => parseConfig(`${YAML}lessons: apply\n`, ROOT), /declares no lessons/);
  assert.throws(() => parseConfig(`${YAML}lessons: always\n`, ROOT), /lessons must be/);
  const lite = parseConfig(YAML.replace("scenarios/capitals", "scenarios/graphrag-lite"), ROOT);
  assert.equal(lite.lessons, "propose");
  assert.deepEqual(lite.scenario.lessons, { file: "spec/agent/lessons.md", ledger: "memory/lessons.json" });
});
