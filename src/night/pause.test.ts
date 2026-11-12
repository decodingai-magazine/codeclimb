import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nightPaths, readJson, writeJson } from "./files.ts";
import { beginPause, endPause, isCreditMessage, type NightJsonWithPauses } from "./pause.ts";

function night() {
	const root = mkdtempSync(join(tmpdir(), "cc-pause-"));
	const paths = nightPaths(root, "runs-langchain/x/results.jsonl", "n1");
	writeJson(paths.nightJson, { night_id: "n1", deadlineMs: 1_000_000 });
	return paths;
}
const stop = { where: "the experiment n1-r1-e0 of round 1", who: "coder" as const, model: "m", message: "402" };

test("ending a pause logs it once, moves the deadline once and deletes pause.json, however often it is retried", () => {
	const paths = night();
	beginPause(paths, { pause: 1, round: 1, stops: [stop] }, new Date(10_000));
	const end = new Date(70_000);
	assert.deepEqual(endPause(paths, 1, end), { stopped: false, deadlineMs: 1_060_000 });
	assert.deepEqual(endPause(paths, 1, new Date(99_000)), { stopped: false, deadlineMs: 1_060_000 });
	assert.equal(existsSync(paths.pauseJson), false);
	const log = readFileSync(join(paths.nightDir, "pauses.jsonl"), "utf8").trim().split("\n");
	assert.equal(log.length, 1);
	assert.equal(JSON.parse(log[0] as string).resumed_at, end.toISOString());
	assert.equal(readJson<NightJsonWithPauses>(paths.nightJson)?.deadlineMs, 1_060_000);
});

test("a retried begin keeps the first time; a second pause adds its own time", () => {
	const paths = night();
	beginPause(paths, { pause: 1, round: 1, stops: [stop] }, new Date(0));
	endPause(paths, 1, new Date(5_000));
	beginPause(paths, { pause: 2, round: 2, stops: [stop] }, new Date(10_000));
	beginPause(paths, { pause: 2, round: 2, stops: [stop] }, new Date(20_000));
	assert.deepEqual(endPause(paths, 2, new Date(30_000)), { stopped: false, deadlineMs: 1_025_000 });
});

test("a night stopped while paused stays stopped", () => {
	const paths = night();
	beginPause(paths, { pause: 1, round: 1, stops: [stop] });
	writeFileSync(paths.stopJson, "{}");
	assert.deepEqual(endPause(paths, 1), { stopped: true });
	assert.equal(existsSync(paths.pauseJson), true);
});

test("credit messages: 402 and quota texts; a 429 rate limit is not one", () => {
	for (const m of ["402 Payment Required", "Insufficient credits", "You exceeded your quota exceeded", "key limit exceeded", "billing hard limit"]) assert.ok(isCreditMessage(m), m);
	for (const m of ["429 Too Many Requests", "rate limit reached", "fetch failed"]) assert.equal(isCreditMessage(m), false, m);
});
