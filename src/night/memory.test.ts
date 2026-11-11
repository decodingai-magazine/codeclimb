import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { historyLine, nextGuidance, notePath, noteText, readNote, writeFileAtomic } from "./memory.ts";

test("a failed review keeps the last feedback and hypothesis; a good one replaces them", () => {
	const prev = { feedback: "old feedback", hypothesis: "old hypothesis" };
	assert.deepEqual(nextGuidance(prev, null), prev);
	assert.deepEqual(nextGuidance(prev, { feedback: "f", hypothesis: "h", verdict: "" }), { feedback: "f", hypothesis: "h" });
});

test("a note holds the heading, the coder part and the verdict; it reads back", () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-note-"));
	const text = noteText(2, 0, "keep", "x".repeat(400), "mock note", "mock verdict");
	assert.match(text, /^## r2-e0 · keep: x{300}\n/);
	writeFileAtomic(notePath(dir, 2, 0), text);
	assert.deepEqual(readNote(notePath(dir, 2, 0)), { coder: "mock note", verdict: "mock verdict" });
	assert.doesNotMatch(noteText(1, 0, "error", "not scored", "n", null), /Reviewer/);
});

test("a history line: hypothesis, moves, decision and reason; an error's reason is its last 300 characters", () => {
	const d = { decision: "keep" as const, reason: "weighted score 0.1 > checkpoint 0", metrics: {}, score: 0.1 };
	assert.equal(historyLine(1, "h", "score +0.1000", d), "- r1: h → score +0.1000 (keep: weighted score 0.1 > checkpoint 0)");
	const e = { decision: "error" as const, reason: "not scored", metrics: {} };
	assert.equal(historyLine(2, null, "not scored", e, `${"a".repeat(400)}\nboom`), `- r2: (none) → not scored (error: ${"a".repeat(295)} boom)`);
});
