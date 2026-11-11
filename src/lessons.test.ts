import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadNightConfig, type NightConfig } from "./config.ts";
import {
	applyOps,
	applyProposal,
	checkOps,
	checkPrune,
	citedHeadings,
	distilledThrough,
	distillWith,
	distillPrompt,
	gatherNight,
	LESSON_CAP,
	LINE_CAP,
	type LessonOp,
	type LessonsDoc,
	lineCount,
	overlap,
	parseLessons,
	parseOps,
	pendingRounds,
	proposeLessons,
	serializeLessons,
	writeProposal,
} from "./lessons.ts";
import { nightPaths } from "./night/files.ts";

const ROOT = process.cwd();

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

/** A temporary checkout: a scenario with lessons.md, and a mock night config whose results go under it. */
function scenarioCfg(): { root: string; cfg: NightConfig; file: string } {
	const root = mkdtempSync(join(tmpdir(), "cc-lessons-"));
	mkdirSync(join(root, "scen", "spec", "agent"), { recursive: true });
	const file = join(root, "scen", "spec", "agent", "lessons.md");
	writeFileSync(file, LESSONS);
	const base = loadNightConfig("configs/datenorm-smoke.yaml", { cwd: ROOT, root: ROOT, mock: true });
	const cfg: NightConfig = { ...base, scenario: "scen", scenario_spec: { ...base.scenario_spec, lessons: "spec/agent/lessons.md" }, results_path: "runs/mock/t/results.jsonl", lessons: "propose" };
	return { root, cfg, file };
}

/** A night's notes and reviews, plus what must never reach a lesson: test metrics, a review prompt. */
function writeNight(root: string, cfg: NightConfig, nightId: string, rounds: number[]): void {
	const p = nightPaths(root, cfg.results_path, nightId);
	const notes = join(p.bundle, "history", "notes");
	mkdirSync(notes, { recursive: true });
	mkdirSync(join(p.bundle, "spec"), { recursive: true });
	mkdirSync(join(p.nightDir, "reviews"), { recursive: true });
	mkdirSync(join(p.nightDir, "evals", `${nightId}-test-r2`), { recursive: true });
	writeFileSync(join(p.bundle, "spec", "task.md"), "# Task\nSee (`lessons.md`, The lever for relations).\n");
	writeFileSync(join(p.bundle, "spec", "lessons.md"), "# Lessons the night had\n");
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
	const { root, cfg, file } = scenarioCfg();
	const long = LESSONS.replace("Lessons from earlier nights.", Array.from({ length: LINE_CAP * 16 }, (_, i) => `w${i}`).join(" "));
	writeFileSync(file, serializeLessons(parseLessons(long)));
	assert.ok(lineCount(readFileSync(file, "utf8")) > LINE_CAP);
	writeNight(root, cfg, "n8", [1]);
	const proposal = await proposeLessons(root, cfg, "n8", noScan);
	assert.ok(proposal);
	assert.ok(proposal.lines > LINE_CAP, "the mock model prunes nothing");
	assert.deepEqual(proposal.prune, []);
	const real = { ...cfg, results_path: "runs/t/results.jsonl" };
	const { dir, applied } = writeProposal(root, real, { ...proposal }, true);
	assert.equal(applied, false);
	assert.match(readFileSync(join(dir, "changes.md"), "utf8"), /## Over the cap/);
	assert.throws(() => applyProposal(root, real, dir), /over 200/);
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
	const { root, cfg } = scenarioCfg();
	writeNight(root, cfg, "n5", [1, 2]);
	const rounds = gatherNight(nightPaths(root, cfg.results_path, "n5").nightDir);
	assert.deepEqual(rounds.map((r) => r.round), [1, 2]);
	const prompt = distillPrompt({ nightId: "n5", spec: "spec", doc: doc(), rounds });
	assert.match(prompt, /round 2 note/);
	assert.match(prompt, /hypothesis 1/);
	assert.match(prompt, /\[3\] Relation filters cost recall\./, "bullets are numbered across sections");
	assert.doesNotMatch(prompt, /0\.123456/, "a test metric reached the distiller");
	assert.doesNotMatch(prompt, /0\.987654/, "a review prompt reached the distiller");
});

test("lessons: propose, skip a repeat, never apply a mock night; apply a real proposal, refuse a stale one, distill on from the applied round", async () => {
	const { root, cfg, file } = scenarioCfg();
	writeNight(root, cfg, "n7", [1, 2]);
	const proposal = await proposeLessons(root, cfg, "n7", noScan);
	assert.ok(proposal);
	assert.equal(proposal.lastRound, 2);
	assert.deepEqual(proposal.ops, [], "the mock model teaches nothing");
	assert.equal(proposal.lessons, LESSONS);
	const { dir, applied } = writeProposal(root, cfg, proposal, true);
	assert.equal(applied, false, "a mock night never writes the scenario's lessons.md");
	assert.equal(JSON.parse(readFileSync(join(dir, "proposal.json"), "utf8")).applied, false);
	assert.ok(existsSync(join(dir, "changes.md")) && existsSync(join(dir, "lessons.md")));
	assert.throws(() => applyProposal(root, cfg, dir), /mock night/);
	assert.equal(await proposeLessons(root, cfg, "n7", noScan), null, "a second run for the same rounds is skipped");
	writeNight(root, cfg, "n7", [1, 2, 3]);
	assert.equal((await proposeLessons(root, cfg, "n7", noScan))?.fromRound, 0, "an unapplied proposal's rounds are distilled again");

	// The same proposal on a real night's results: applied, then refused once the file moved.
	const real = { ...cfg, results_path: "runs/t/results.jsonl" };
	const edited = { ...proposal, lessons: LESSONS.replace("raised recall.", "raised mention recall.") };
	const out = writeProposal(root, real, edited, true);
	assert.equal(out.applied, true);
	assert.match(readFileSync(file, "utf8"), /raised mention recall/);
	assert.equal(JSON.parse(readFileSync(join(out.dir, "proposal.json"), "utf8")).applied, true);
	assert.throws(() => applyProposal(root, real, out.dir), /changed since/);
	// A continued night distills from past the applied round (no model call here: a real night calls a real model).
	writeNight(root, real, "n7", [1, 2, 3]);
	assert.equal(distilledThrough(root, real, "n7"), 2);
	assert.equal(pendingRounds(root, real, "n7"), 1);
});

/** A scripted model: each turn answers with the next reply and records the prompt it got. */
function scripted(replies: (LessonOp[] | null)[]) {
	const prompts: string[] = [];
	const ask = async (text: string) => {
		prompts.push(text);
		const reply = replies[prompts.length - 1];
		return reply === undefined ? [] : reply;
	};
	return { ask, prompts };
}
const night = { nightId: "n", spec: "spec", rounds: [{ round: 1, notes: ["note"] }] };

test("lessons: rejected ops get one rewrite that replaces the first list; ops rejected twice are left out", async () => {
	const bad = { op: "add" as const, section: "Worked", text: "Recall rose to 0.71.", reason: "r1" };
	const good = { op: "edit" as const, id: 1, text: "Extracting by section raised mention recall.", reason: "r1" };
	// The rewrite fixes nothing and drops the good op: the rewrite's list stands.
	const twice = scripted([[bad, good], [bad]]);
	const out = await distillWith(twice.ask, { ...night, doc: doc() }, noScan);
	assert.equal(twice.prompts.length, 2);
	assert.match(twice.prompts[1] as string, /These ops were rejected/);
	assert.deepEqual(out.ops, []);
	assert.equal(out.rejected.length, 1);
	// An unparsable rewrite keeps the first list's accepted ops.
	const lost = scripted([[bad, good], null]);
	assert.deepEqual((await distillWith(lost.ask, { ...night, doc: doc() }, noScan)).ops, [good]);
	// Nothing parsable twice fails the distillation; once is retried.
	await assert.rejects(distillWith(scripted([null, null]).ask, { ...night, doc: doc() }, noScan), /no parsable JSON twice/);
	assert.equal((await distillWith(scripted([null, [good]]).ask, { ...night, doc: doc() }, noScan)).ops.length, 1);
	// A heading over 80 characters is rejected.
	const long = { op: "add" as const, section: "H".repeat(81), text: "Batching calls saved time.", reason: "r", new_section: true };
	assert.match((await checkOps(doc(), [long], noScan)).rejected[0]?.problem ?? "", /over 80/);
});

test("lessons: over 200 lines, up to two prune rounds, each numbered after the ops before it", async () => {
	const big = doc();
	big.sections[0].bullets = Array.from({ length: 25 }, (_, i) => `${"Lesson ".repeat(130)}number ${"abcdefghijklmnopqrstuvwxy"[i]}.`);
	assert.ok(lineCount(serializeLessons(big)) > LINE_CAP);
	const prune = scripted([[], [{ op: "drop", id: 1, reason: "least" }], [{ op: "drop", id: 1, reason: "least again" }], [{ op: "drop", id: 1, reason: "never asked" }]]);
	const out = await distillWith(prune.ask, { ...night, doc: big }, noScan);
	assert.equal(prune.prompts.length, 3, "the night's ops, then two prune rounds, no third");
	assert.match(prune.prompts[1] as string, /Cut it to fit/);
	assert.equal(out.prune.length, 2);
	assert.ok(out.lines > LINE_CAP, "still over: never applied");
	// Each prune round's id 1 is the first bullet as numbered after the round before.
	const after = applyOps(applyOps(big, out.prune[0] as LessonOp[]), out.prune[1] as LessonOp[]);
	assert.equal(after.sections[0]?.bullets.length, 23);
	assert.match(after.sections[0]?.bullets[0] ?? "", /number c\.$/);
});
