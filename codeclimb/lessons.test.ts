import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type NightConfig, parseConfig } from "./config";
import {
  applyOps,
  applyProposal,
  checkOps,
  checkPrune,
  citedHeadings,
  distillPrompt,
  gatherNight,
  LESSON_CAP,
  LINE_CAP,
  type LessonsDoc,
  lineCount,
  overlap,
  parseLessons,
  parseOps,
  proposeLessons,
  serializeLessons,
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
results_path: capitals/results.jsonl
`;

const LESSONS = `# What earlier attempts learned

Lessons from earlier nights.

## Worked

- Extracting by section raised recall.
- Name keys merged entities with no model.

## Failed, more than once

- Relation filters cost recall.
- A second few-shot document hurt.

## The lever for relations

- Missing ends, not labels, cost relations.
`;

/** [1] section recall, [2] name keys, [3] relation filters, [4] few-shot, [5] missing ends. */
const doc = (): LessonsDoc => parseLessons(LESSONS);
const noScan = async () => [];

/** A scenario dir with lessons.md, and a config whose night results go under the same temp dir. */
function scenarioCfg(): NightConfig {
  const dir = mkdtempSync(join(tmpdir(), "cc-lessons-"));
  mkdirSync(join(dir, "spec", "agent"), { recursive: true });
  writeFileSync(join(dir, "spec", "agent", "lessons.md"), LESSONS);
  const base = parseConfig(YAML, ROOT);
  return {
    ...base, scenario_dir: dir, scenario: { ...base.scenario, lessons: "spec/agent/lessons.md" },
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
  writeFileSync(join(p.bundleDir, "spec", "task.md"), "# Task\nSee (`lessons.md`, The lever for relations).\n");
  writeFileSync(join(p.bundleDir, "spec", "lessons.md"), "# Lessons the night had\n");
  for (const r of rounds) {
    writeFileSync(join(notes, `r${r}-e0.md`), `## r${r}-e0 · revert\nround ${r} note`);
    writeFileSync(join(p.nightDir, "reviews", `r${r}.json`), JSON.stringify({ feedback: `feedback ${r}`, hypothesis: `hypothesis ${r}`, verdict: "v" }));
    writeFileSync(join(p.nightDir, "reviews", `r${r}.prompt.md`), "per-item errors 0.987654");
  }
  writeFileSync(p.doneJson, JSON.stringify({ test_metrics: { "extraction.mentions.f1": 0.123456 } }));
  writeFileSync(join(p.nightDir, "evals", `${nightId}-test-r2`, "metrics.json"), JSON.stringify({ f1: 0.123456 }));
}

test("lessons: parse and serialize round-trip, wrapping at 100 columns and leaving an empty section out", () => {
  assert.equal(serializeLessons(doc()), LESSONS);
  const d = doc();
  d.sections[0].bullets[0] = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  d.sections[1].bullets = [];
  const lines = serializeLessons(d).split("\n");
  assert.ok(lines.every((x) => x.length <= 100));
  assert.ok(lines[lines.findIndex((x) => x.startsWith("- word0")) + 1].startsWith("  word"));
  assert.ok(!lines.includes("## Failed, more than once"));
  assert.throws(() => parseLessons("# T\n\n## S\n\nloose text\n"), /only "- " bullets/);
});

test("lessons: the shipped graphrag lessons.md is in layout and keeps the headings task.md cites", () => {
  const dir = join(ROOT, "scenarios", "graphrag", "spec", "agent");
  const md = readFileSync(join(dir, "lessons.md"), "utf8");
  assert.equal(serializeLessons(parseLessons(md)), md, "lessons.md is out of layout: run `npm run lessons -- format`");
  const cited = citedHeadings(readFileSync(join(dir, "task.md"), "utf8"), parseLessons(md));
  assert.deepEqual(cited, ["Failed, more than once", "The lever for relations"]);
});

test("lessons: parseOps reads the ops and leaves malformed ones out", () => {
  const ops = parseOps(`Here: {"ops": [
    {"op": "add", "section": "Worked", "text": "t", "reason": "r1"},
    {"op": "edit", "id": 2, "section": "Failed, more than once", "reason": "r2"},
    {"op": "edit", "id": 2, "reason": "no change"},
    {"op": "drop", "id": "3", "reason": "string id"},
    {"op": "drop", "id": 4},
    {"op": "explode", "id": 1, "reason": "x"}
  ]}`);
  assert.deepEqual(ops, [
    { op: "add", section: "Worked", text: "t", reason: "r1" },
    { op: "edit", id: 2, section: "Failed, more than once", reason: "r2" },
  ]);
  assert.equal(parseOps("no json"), null);
  assert.equal(parseOps('{"feedback": "x"}'), null);
});

test("lessons: the gates reject metric values, held-out names, unknown ids, a second op per id and unknown headings", async () => {
  const scan = async (text: string) => (text.includes("Zephyr") ? ["Zephyr"] : []);
  const { ok, rejected } = await checkOps(
    doc(),
    [
      { op: "add", section: "Worked", text: "Mention F1 rose to 0.71.", reason: "r1" },
      { op: "add", section: "Worked", text: "Recall rose by 12%.", reason: "r1" },
      { op: "add", section: "Worked", text: "The Zephyr article loops.", reason: "r1" },
      { op: "add", section: "Nowhere", text: "Batching calls saved time.", reason: "r1" },
      { op: "drop", id: 9, reason: "unknown" },
      { op: "edit", id: 1, text: "x".repeat(501), reason: "too long" },
      { op: "edit", id: 2, text: "Name keys and acronyms merged entities with no model.", reason: "Zephyr in r2 at 0.71" },
      { op: "drop", id: 2, reason: "second op" },
      { op: "add", section: "Failed once, not yet confirmed", text: "Calling jev-1.14 per pair kept precision.", reason: "r3", new_section: true },
    ],
    scan,
  );
  assert.deepEqual(rejected.map((r) => r.problem.split(":")[0].split(" ").slice(0, 4).join(" ")), [
    "no lesson [9]", "the lesson is over", "[2] already has an", "the lesson holds a", "the lesson holds a", "the lesson names evaluation", 'no section "Nowhere"; sections',
  ], "adds are checked after the other ops");
  assert.equal(ok.length, 2);
  assert.equal(ok[0].reason, "[hidden] in r2 at 0.71", "a reason is masked, not rejected");
});

test("lessons: an add close to a lesson is a near-duplicate unless marked distinct or the lesson is dropped", async () => {
  assert.ok(overlap("Relation filters of every kind cost recall.", "Relation filters cost recall.") >= 0.5);
  assert.ok(overlap("Batching the calls saved wall time.", "Relation filters cost recall.") < 0.5);
  const dup = { op: "add" as const, section: "Worked", text: "Filtering relations cost recall every time.", reason: "r2" };
  const plain = await checkOps(doc(), [dup], noScan);
  assert.match(plain.rejected[0].problem, /close to \[3\]/);
  assert.equal((await checkOps(doc(), [{ ...dup, distinct: true }], noScan)).ok.length, 1);
  assert.equal((await checkOps(doc(), [dup, { op: "drop", id: 3, reason: "merged" }], noScan)).ok.length, 2, "a drop later in the reply counts");
  const kept = await checkOps(doc(), [{ op: "drop", id: 3, reason: "x" }, { op: "drop", id: 3, reason: "again" }], noScan);
  assert.equal(kept.rejected.length, 1);
  const cited = await checkOps(parseLessons("# T\n\n## Cited\n\n- Relation filters cost recall.\n"), [{ op: "drop", id: 1, reason: "x" }, { ...dup, section: "Cited" }], noScan, ["Cited"]);
  assert.match(cited.rejected.map((r) => r.problem).join(" "), /close to \[1\]/, "a rejected drop leaves its lesson to match");
});

test("lessons: a cited heading keeps a lesson, and a full file takes an add only after a drop", async () => {
  const cited = ["The lever for relations"];
  const last = await checkOps(doc(), [{ op: "drop", id: 5, reason: "wrong" }], noScan, cited);
  assert.match(last.rejected[0].problem, /which the spec cites/);
  assert.equal((await checkOps(doc(), [{ op: "edit", id: 5, text: "Missing ends cost relations most.", reason: "r1" }], noScan, cited)).ok.length, 1);
  const full = doc();
  full.sections[0].bullets = Array.from({ length: LESSON_CAP - 3 }, (_, i) => `Change number ${"abcdefghijklmnopqrstuvwxyz0"[i]} did something.`);
  const add = { op: "add" as const, section: "Worked", text: "Batching the model calls saved wall time.", reason: "r1" };
  assert.match((await checkOps(full, [add], noScan)).rejected[0].problem, /merge two/);
  assert.equal((await checkOps(full, [{ op: "drop", id: 1, reason: "merged" }, add], noScan)).ok.length, 2);
});

test("lessons: a prune round takes drops and shortening edits only", async () => {
  assert.equal(lineCount(LESSONS), 17);
  const { ok, rejected } = await checkPrune(
    doc(),
    [
      { op: "add", section: "Worked", text: "Batching calls saved time.", reason: "r1" },
      { op: "edit", id: 1, text: "Extracting by section raised recall, and more words than before.", reason: "longer" },
      { op: "edit", id: 2, text: "Name keys merged entities.", reason: "shorter" },
      { op: "drop", id: 4, reason: "least value" },
    ],
    noScan,
  );
  assert.deepEqual(rejected.map((r) => r.problem), ["a prune adds nothing: drop or shorten", "the edit of [1] is not shorter"]);
  assert.deepEqual(ok.map((o) => o.reason), ["shorter", "least value"]);
});

test("lessons: a proposal over the line cap after its prune rounds is never applied", async () => {
  const cfg = scenarioCfg();
  const file = join(cfg.scenario_dir, "spec", "agent", "lessons.md");
  const long = LESSONS.replace("Lessons from earlier nights.", Array.from({ length: LINE_CAP * 16 }, (_, i) => `w${i}`).join(" "));
  writeFileSync(file, serializeLessons(parseLessons(long)));
  assert.ok(lineCount(readFileSync(file, "utf8")) > LINE_CAP);
  writeNight(cfg, "n8", [1]);
  const proposal = await proposeLessons(cfg, "n8", noScan);
  assert.ok(proposal);
  assert.ok(proposal.lines > LINE_CAP, "the mock model prunes nothing");
  assert.deepEqual(proposal.prune, []);
  const { dir } = writeProposal(cfg, { ...proposal }, true);
  assert.match(readFileSync(join(dir, "changes.md"), "utf8"), /## Over the cap/);
  assert.throws(() => applyProposal(cfg, dir), /over 200/);
});

test("lessons: applyOps resolves ids before any op, edits in place, moves beside the old section and adds", () => {
  const out = applyOps(doc(), [
    { op: "drop", id: 1, reason: "wrong" },
    { op: "edit", id: 2, text: "Name keys and acronyms merged entities with no model.", reason: "r2" },
    { op: "edit", id: 4, section: "Failed once, not yet confirmed", reason: "one night" },
    { op: "add", section: "Worked", text: "Batching calls saved time.", reason: "r3" },
  ]);
  assert.deepEqual(out.sections.map((s) => [s.heading, s.bullets]), [
    ["Worked", ["Name keys and acronyms merged entities with no model.", "Batching calls saved time."]],
    ["Failed, more than once", ["Relation filters cost recall."]],
    ["Failed once, not yet confirmed", ["A second few-shot document hurt."]],
    ["The lever for relations", ["Missing ends, not labels, cost relations."]],
  ]);
  assert.equal(serializeLessons(doc()), LESSONS, "the input is unchanged");
});

test("lessons: a night is read from its notes and reviews only, never from test or the review prompts", () => {
  const cfg = scenarioCfg();
  writeNight(cfg, "n5", [1, 2]);
  const rounds = gatherNight(nightPaths(cfg, "n5").nightDir);
  assert.deepEqual(rounds.map((r) => r.round), [1, 2]);
  const prompt = distillPrompt({ model: "m", thinkingLevel: "low", nightId: "n5", spec: "spec", doc: doc(), rounds });
  assert.match(prompt, /round 2 note/);
  assert.match(prompt, /hypothesis 1/);
  assert.match(prompt, /\[3\] Relation filters cost recall\./, "bullets are numbered across sections");
  assert.doesNotMatch(prompt, /0\.123456/, "a test metric reached the distiller");
  assert.doesNotMatch(prompt, /0\.987654/, "a review prompt reached the distiller");
});

test("lessons: propose, skip a repeat, apply, refuse a stale proposal, and distill a continued night from the applied round", async () => {
  const cfg = scenarioCfg();
  const file = join(cfg.scenario_dir, "spec", "agent", "lessons.md");
  writeNight(cfg, "n7", [1, 2]);
  const proposal = await proposeLessons(cfg, "n7", noScan);
  assert.ok(proposal);
  assert.equal(proposal.lastRound, 2);
  assert.deepEqual(proposal.ops, [], "the mock model teaches nothing");
  assert.equal(proposal.lessons, LESSONS);
  const { dir, applied } = writeProposal(cfg, proposal, true);
  assert.equal(applied, false, "a mock night never writes the scenario's lessons.md");
  assert.ok(existsSync(join(dir, "changes.md")));
  assert.equal(await proposeLessons(cfg, "n7", noScan), null, "the same rounds are proposed once");
  writeNight(cfg, "n7", [1, 2, 3]);
  assert.equal((await proposeLessons(cfg, "n7", noScan))?.fromRound, 0, "an unapplied proposal's rounds are distilled again");
  applyProposal(cfg, dir);
  assert.equal(readFileSync(file, "utf8"), LESSONS);
  writeFileSync(file, `${LESSONS}\n- A hand edit.\n`);
  assert.throws(() => applyProposal(cfg, dir), /changed since/);
  const next = await proposeLessons(cfg, "n7", noScan);
  assert.equal(next?.fromRound, 2);
  assert.equal(next?.base_sha256, sha256(readFileSync(file, "utf8")));
});

test("lessons: config defaults to apply when the scenario declares lessons, and checks the mode", () => {
  assert.equal(parseConfig(YAML, ROOT).lessons, "off");
  assert.throws(() => parseConfig(`${YAML}lessons: apply\n`, ROOT), /declares no lessons/);
  assert.throws(() => parseConfig(`${YAML}lessons: always\n`, ROOT), /lessons must be/);
  const graphrag = parseConfig(YAML.replace("scenarios/capitals", "scenarios/graphrag"), ROOT);
  assert.equal(graphrag.lessons, "apply");
  assert.equal(graphrag.scenario.lessons, "spec/agent/lessons.md");
});
