import assert from "node:assert/strict";
import { test } from "node:test";
import { askForReview, capItems, capRunLog, capText, parseReply, trajectory } from "./evidence.ts";

test("reply: the JSON object from the first { to the last }, inside text or a code fence, fields trimmed", () => {
	assert.deepEqual(parseReply('Here:\n```json\n{"feedback": " f ", "hypothesis": "h", "verdict": "v"}\n```'), { feedback: "f", hypothesis: "h", verdict: "v" });
	assert.deepEqual(parseReply('{"feedback": "f", "hypothesis": "h"}'), { feedback: "f", hypothesis: "h", verdict: "" });
	assert.equal(parseReply('{"feedback": "f", "hypothesis": "  "}'), null);
	assert.equal(parseReply('{"hypothesis": "h"}'), null);
	assert.equal(parseReply("no json"), null);
	assert.equal(parseReply("{broken"), null);
});

test("reply: one retry asking for JSON only, then the review fails", async () => {
	const asked: string[] = [];
	const ok = await askForReview(async (p) => (asked.push(p), asked.length === 1 ? "sorry" : '{"feedback":"f","hypothesis":"h"}'), "prompt");
	assert.equal(ok?.hypothesis, "h");
	assert.equal(asked.length, 2);
	assert.match(asked[1] ?? "", /JSON only/);
	let calls = 0;
	assert.equal(await askForReview(async () => (calls++, "nope"), "prompt"), null);
	assert.equal(calls, 2);
});

test("per-item errors: short items stay whole, the long ones split what is left", () => {
	const items = ["a".repeat(10), "b".repeat(100), "c".repeat(100)];
	assert.deepEqual(capItems(items, 1000), items);
	const out = capItems(items, 90); // share 30: "a" stays, the two long ones get (90 - 10) / 2 = 40 each
	assert.equal(out[0], items[0]);
	assert.equal(out[1]?.length, 40);
	assert.equal(out[2]?.length, 40);
});

test("run log: HTTP Request lines and blank lines dropped; flagged lines first, counted, then the tail", () => {
	assert.equal(capRunLog("a\n\nHTTP Request: x\nb", 100), "a\nb");
	const log = ["ERROR boom", ...Array.from({ length: 50 }, (_, i) => `line ${i}`), "ERROR boom", "Traceback here", "last"].join("\n");
	const out = capRunLog(log, 120);
	assert.ok(out.length <= 120, `${out.length}`);
	assert.match(out, /^ERROR boom \(2×\)\nTraceback here \(1×\)/);
	assert.match(out, /last$/);
	assert.doesNotMatch(out, /errors?boom/);
	// "warned" is not the whole word "warn"
	assert.doesNotMatch(capRunLog(`warned\n${"x\n".repeat(80)}`, 50), /warned \(/);
});

test("diff and source: cut with a note of the full length", () => {
	assert.equal(capText("abc", 10, "diff"), "abc");
	assert.equal(capText("abcdef", 3, "diff"), "abc\n[cut: the diff is 6 characters in full]");
});

test("trajectory: past the budget the oldest rounds lose feedback, then coder parts, then all but the line; the latest stays whole", () => {
	const round = (n: number) => ({ round: n, line: `- r${n}: h → s (keep: ok)`, coder: "C".repeat(100), verdict: "V".repeat(100), feedback: "F".repeat(100) });
	const rounds = [round(1), round(2), round(3)];
	const full = trajectory(rounds, 100_000);
	assert.match(full, /### r3 \(latest\)/);
	assert.equal((full.match(/F{100}/g) ?? []).length, 3);
	const noFeedback = trajectory(rounds, full.length - 100);
	assert.equal((noFeedback.match(/F{100}/g) ?? []).length, 2);
	assert.equal((noFeedback.match(/C{100}/g) ?? []).length, 3);
	const tight = trajectory(rounds, 500);
	assert.equal((tight.match(/F{100}/g) ?? []).length, 1);
	assert.equal((tight.match(/C{100}/g) ?? []).length, 1);
	assert.equal((tight.match(/V{100}/g) ?? []).length, 1);
	assert.match(tight, /- r1: h/);
	assert.ok(tight.includes(`F`.repeat(100)) && tight.indexOf("F".repeat(100)) > tight.indexOf("### r3"));
	assert.equal(trajectory([], 100), "");
});
