// Integration test against the local Docker daemon. Skipped, with a message, when Docker is not running.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import { DockerBackend } from "../sandbox/docker.ts";
import { ensureMeterPath, RELAY } from "./relay.ts";

const IMAGE = "codeclimb-python";
const probe = spawnSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" });
const skip = probe.status === 0 && probe.stdout.trim() !== "" ? false : `Docker is not running or image ${IMAGE} is missing: relay test skipped`;
if (skip) console.log(`# ${skip}`);

const relayId = () => spawnSync("docker", ["inspect", "--format", "{{.Id}}", RELAY], { encoding: "utf8" }).stdout.trim();

describe("meter relay", { skip }, () => {
	test("reused while it runs with the right port label, recreated otherwise, never swept", async () => {
		await ensureMeterPath(IMAGE, 41001);
		const first = relayId();
		assert.ok(first);
		await Promise.all([ensureMeterPath(IMAGE, 41001), ensureMeterPath(IMAGE, 41001)]);
		assert.equal(relayId(), first);
		await ensureMeterPath(IMAGE, 41002);
		const second = relayId();
		assert.notEqual(second, first);
		assert.equal(await new DockerBackend().sweep({ prefix: "cc-meter" }), 0);
		assert.equal(relayId(), second);
		spawnSync("docker", ["rm", "-f", RELAY]);
	});
});
