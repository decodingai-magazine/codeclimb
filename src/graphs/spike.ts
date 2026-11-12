// Spike only (#27): a throwaway graph that measures two platform facts on the `langgraph up` server.
// mode "fail": does a task that fails out of its retries still fail the run when the entrypoint catches it?
// mode "kill": is a task's result stored before the next task starts? Task b kills the server container once.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { entrypoint, task } from "@langchain/langgraph";
import { serverRoot } from "../night/types.ts";

interface SpikeInput {
	mode: "fail" | "kill";
	tag: string;
	/** Kill mode: how long task b waits before the kill, so the database can be read while a's result should be stored. */
	waitMs?: number;
}

const dirOf = (tag: string) => {
	const d = join(serverRoot(), "runs-langchain", "spike", tag);
	mkdirSync(d, { recursive: true });
	return d;
};
const mark = (tag: string, what: string) => appendFileSync(join(dirOf(tag), "log.txt"), `${new Date().toISOString()} ${what}\n`);

const a = task("a", async (tag: string) => {
	mark(tag, "a ran");
	return readFileSync(join(dirOf(tag), "log.txt"), "utf8").split("\n").filter((l) => l.endsWith(" a ran")).length;
});

const failing = task({ name: "b_fail", retry: { maxAttempts: 2, initialInterval: 100 } }, async (tag: string) => {
	mark(tag, "b_fail attempt");
	throw new Error("b_fail always fails");
});

const killer = task("b_kill", async (tag: string, waitMs: number) => {
	const marker = join(dirOf(tag), "killed");
	if (!existsSync(marker)) {
		mark(tag, "b_kill started");
		await new Promise((r) => setTimeout(r, waitMs));
		writeFileSync(marker, new Date().toISOString());
		mark(tag, "b_kill killing the server container");
		execFileSync("docker", ["kill", hostname()]);
		await new Promise((r) => setTimeout(r, 60_000));
	}
	mark(tag, "b_kill ran after restart");
	return "b ok";
});

const c = task("c", async (tag: string) => {
	mark(tag, "c ran");
	return "c ok";
});

export const spike = entrypoint("spike", async (input: SpikeInput) => {
	const aCount = await a(input.tag);
	if (input.mode === "fail") {
		let caught = "";
		try {
			await failing(input.tag);
		} catch (error) {
			caught = error instanceof Error ? error.message : String(error);
			mark(input.tag, `entrypoint caught: ${caught}`);
		}
		const cResult = await c(input.tag);
		return { aCount, caught, cResult };
	}
	const b = await killer(input.tag, input.waitMs ?? 0);
	const cResult = await c(input.tag);
	return { aCount, b, cResult };
});
