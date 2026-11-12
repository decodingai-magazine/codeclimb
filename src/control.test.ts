// The control operations against a stand-in Agent Server: what they ask the server for.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { type LessonsInput, resumeErroredThread, resumeNight, runStopGraph, startLessons, startNight, startTimer, startVariation } from "./control.ts";
import type { NightInput } from "./night/types.ts";

interface Seen {
	method: string;
	path: string;
	body: Record<string, unknown>;
}
let seen: Seen[] = [];
/** The night's newest thread, paused at pause 2. */
const PAUSED = "00000000-0000-4000-8000-0000000000aa";

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
	let raw = "";
	for await (const chunk of req) raw += chunk;
	return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
};

const server = createServer(async (req, res) => {
	const path = (req.url ?? "").split("?")[0] ?? "";
	const body = await readBody(req);
	seen.push({ method: req.method ?? "", path, body });
	res.setHeader("content-type", "application/json");
	if (req.method === "POST" && path === "/threads") {
		res.end(JSON.stringify({ thread_id: (body.thread_id as string | undefined) ?? "00000000-0000-4000-8000-000000000001", status: "idle", metadata: body.metadata ?? {} }));
		return;
	}
	if (req.method === "POST" && path === "/threads/search") {
		res.end(JSON.stringify([{ thread_id: PAUSED, status: "interrupted", metadata: { kind: "night", night_id: "n1", run: 0 } }]));
		return;
	}
	if (req.method === "GET" && path === `/threads/${PAUSED}/state`) {
		res.end(JSON.stringify({ values: {}, next: [], tasks: [{ id: "t", name: "night", interrupts: [{ value: { pause: 2 } }] }], metadata: {}, checkpoint: {} }));
		return;
	}
	if (req.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(path)) {
		res.end(JSON.stringify({ run_id: "r1", thread_id: path.split("/")[2], status: "pending" }));
		return;
	}
	res.statusCode = 404;
	res.end("{}");
});

before(async () => {
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	process.env.CODECLIMB_SERVER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
beforeEach(() => {
	seen = [];
});

/** The bodies of the server runs created. */
const runBodies = () => seen.filter((s) => s.method === "POST" && /^\/threads\/[^/]+\/runs$/.test(s.path)).map((s) => s.body);

const input = { night_id: "n1" } as NightInput;

test("control: every server run CodeClimb creates passes durability sync", async () => {
	await startNight(input);
	await startVariation({ ...input, variation: 1 });
	await resumeErroredThread("00000000-0000-4000-8000-000000000002");
	await startTimer("n1", { variation: 0 }, 60);
	await runStopGraph("n1", "manual");
	await startLessons({ night_id: "n1", scenario: "datenorm" } as LessonsInput);
	const bodies = runBodies();
	assert.equal(bodies.length, 6);
	for (const b of bodies) assert.equal(b.durability, "sync", JSON.stringify(b));
});

test("control: the resume of a pause passes durability sync", async () => {
	assert.deepEqual(await resumeNight(mkdtempSync(join(tmpdir(), "cc-control-")), "n1"), { resumed: 2 });
	assert.deepEqual(runBodies(), [{ assistant_id: "night", command: { resume: { pause: 2 } }, multitask_strategy: "reject", durability: "sync" }]);
});
