import assert from "node:assert/strict";
import { test } from "node:test";
import { entrypoint, MemorySaver } from "@langchain/langgraph";
import { isOwnFailure, step, StepTimeoutError } from "./step.ts";

test("a backstop timer that fires aborts the step's signal and fails it once, not retried", async () => {
	let attempts = 0;
	let sawAbort = false;
	const g = entrypoint({ name: "t", checkpointer: new MemorySaver() }, async () => {
		try {
			await step(
				"slow",
				async (ctx) => {
					attempts++;
					await new Promise<void>((resolve) => ctx.signal.addEventListener("abort", () => resolve(), { once: true }));
					sawAbort = ctx.signal.aborted;
					return "late";
				},
				{ backstopMin: 0.002 },
			)();
			return "no error";
		} catch (e) {
			return e instanceof StepTimeoutError && isOwnFailure(e) ? "timeout" : `other: ${String(e)}`;
		}
	});
	const out = await g.invoke({}, { configurable: { thread_id: "t1" } });
	assert.equal(out, "timeout");
	assert.equal(attempts, 1);
	assert.equal(sawAbort, true);
});

test("an ordinary failure is retried up to 3 attempts", async () => {
	let attempts = 0;
	const g = entrypoint({ name: "r", checkpointer: new MemorySaver() }, async () => {
		try {
			await step("flaky", async () => {
				attempts++;
				throw new Error("boom");
			})();
		} catch (e) {
			return isOwnFailure(e) ? "failed" : "other";
		}
		return "ok";
	});
	assert.equal(await g.invoke({}, { configurable: { thread_id: "t2" } }), "failed");
	assert.equal(attempts, 3);
});

test("a step that failed out is caught in the entrypoint, and the steps after it still run", async () => {
	const g = entrypoint({ name: "c", checkpointer: new MemorySaver() }, async () => {
		let caught = "";
		try {
			await step("bad", async () => {
				throw new StepTimeoutError("late");
			})();
		} catch (e) {
			caught = (e as Error).message;
		}
		const next = await step("next", async () => "ran")();
		return { caught, next };
	});
	assert.deepEqual(await g.invoke({}, { configurable: { thread_id: "t3" } }), { caught: "late", next: "ran" });
});
