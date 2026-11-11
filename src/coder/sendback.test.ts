import assert from "node:assert/strict";
import { test } from "node:test";
import { inReserve, type SendBackInput, sendBackMessage, tasksProblem, trainProblem, WRAP_UP } from "./sendback.ts";

const TASKS_OK = JSON.stringify([{ task: "a", check: "b", status: "done" }, { task: "c", check: "d", status: "dropped", note: "no time" }]);
const TRAIN_OK = JSON.stringify({ before: { acc: 0.1 }, after: { acc: 0.2 }, command: "x" });

const base: SendBackInput = {
	tasks: TASKS_OK,
	train: TRAIN_OK,
	hasTrain: true,
	reserve: false,
	sendBacks: 0,
	repair: false,
	capStopped: false,
	minutesLeft: 8,
	minutesTotal: 10,
	usdLeft: 0.9,
	usdTotal: 1,
	nextStep: "test the untested parts of the hypothesis",
};

test("tasks: missing, invalid, or an open task is a problem; done and dropped-with-note are not", () => {
	assert.equal(tasksProblem(TASKS_OK), null);
	assert.match(tasksProblem(null) ?? "", /missing/);
	assert.match(tasksProblem("{") ?? "", /not valid/);
	assert.match(tasksProblem(JSON.stringify({ task: "a" })) ?? "", /not valid/);
	assert.match(tasksProblem(JSON.stringify([{ task: "a", check: "b", status: "todo" }])) ?? "", /1 task/);
	assert.match(tasksProblem(JSON.stringify([{ task: "a", check: "b", status: "dropped" }])) ?? "", /1 task/);
});

test("train: before and after need a numeric value each; a fall needs a why", () => {
	assert.equal(trainProblem(TRAIN_OK), null);
	assert.match(trainProblem(null) ?? "", /missing/);
	assert.match(trainProblem(JSON.stringify({ before: {}, after: { a: 1 } })) ?? "", /not valid/);
	assert.match(trainProblem(JSON.stringify({ before: { a: "x" }, after: { a: 1 } })) ?? "", /not valid/);
	assert.match(trainProblem(JSON.stringify({ before: { a: 0.5 }, after: { a: 0.4 } })) ?? "", /a fell/);
	assert.equal(trainProblem(JSON.stringify({ before: { a: 0.5 }, after: { a: 0.4 }, why: "trade-off" })), null);
});

test("reserve: the last 20% of the time or of the budget, whichever first", () => {
	assert.equal(inReserve({ elapsedMs: 7_000, totalMs: 10_000, usd: 0.1, budgetUsd: 1 }), false);
	assert.equal(inReserve({ elapsedMs: 8_000, totalMs: 10_000, usd: 0.1, budgetUsd: 1 }), true);
	assert.equal(inReserve({ elapsedMs: 1_000, totalMs: 10_000, usd: 0.8, budgetUsd: 1 }), true);
});

test("send-back: not in its reserve yet, with the time and money left and one change asked", () => {
	const m = sendBackMessage(base);
	assert.ok(m);
	assert.match(m, /You stopped with 8 of 10 minutes and \$0\.90 of \$1\.00 left/);
	assert.match(m, /test the untested parts of the hypothesis/);
	assert.match(m, /exactly one change/);
	assert.doesNotMatch(m, /change no more code/);
});

test("send-back: task and train problems come before the time line, also in the reserve", () => {
	const m = sendBackMessage({ ...base, reserve: true, tasks: null, train: null });
	assert.ok(m);
	assert.ok(m.indexOf("/tmp/tasks.json") < m.indexOf("You stopped with"));
	assert.match(m, /train-score/);
	assert.doesNotMatch(m, /exactly one change/);
	// Without train/ in the bundle, a missing train score is no problem.
	assert.equal(sendBackMessage({ ...base, reserve: true, hasTrain: false, train: null }), null);
});

test("send-back: nothing to fix in the reserve sends nothing", () => {
	assert.equal(sendBackMessage({ ...base, reserve: true }), null);
});

test("send-back limits: none for a repair, with less than 3 minutes, after a cap stop, past 8", () => {
	assert.equal(sendBackMessage({ ...base, repair: true }), null);
	assert.equal(sendBackMessage({ ...base, minutesLeft: 2.9 }), null);
	assert.ok(sendBackMessage({ ...base, minutesLeft: 3 }));
	assert.equal(sendBackMessage({ ...base, capStopped: true }), null);
	assert.ok(sendBackMessage({ ...base, sendBacks: 7 }));
	assert.equal(sendBackMessage({ ...base, sendBacks: 8 }), null);
});

test("wrap-up: carries its phrase and never the send-back's", () => {
	assert.match(WRAP_UP, /change no more code/);
	assert.doesNotMatch(WRAP_UP, /You stopped with/);
	assert.match(WRAP_UP, /APPROACH/);
});
