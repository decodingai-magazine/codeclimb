// Integration test against the local Docker daemon. Skipped, with a message, when Docker is not running.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, test } from "node:test";
import { DockerBackend } from "../sandbox/docker.ts";
import { ensureMeterPath, METER_NETWORK, RELAY } from "./relay.ts";

const IMAGE = "codeclimb-python";
const probe = spawnSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" });
const skip = probe.status === 0 && probe.stdout.trim() !== "" ? false : `Docker is not running or image ${IMAGE} is missing: relay test skipped`;
if (skip) console.log(`# ${skip}`);

const dockerOut = (args: string[]) => spawnSync("docker", args, { encoding: "utf8" }).stdout.trim();
const relayId = () => dockerOut(["inspect", "--format", "{{.Id}}", RELAY]);
const relayLabel = (name: string) => dockerOut(["inspect", "--format", `{{index .Config.Labels "${name}"}}`, RELAY]);

// A stand-in for the server container: on cc-meter under an alias, answering HTTP on the proxy's port.
const TARGET = "relay-test-target";
const TARGET_ALIAS = "codeclimb-relay-test";
const TARGET_PORT = 41003;

/** GET the relay from a container on cc-meter, as a metered sandbox would. */
const throughRelay = () =>
	spawnSync("docker", ["run", "--rm", "--network", METER_NETWORK, IMAGE, "python3", "-c", `import urllib.request; print(urllib.request.urlopen("http://${RELAY}:8080/", timeout=10).read().decode())`], { encoding: "utf8" });

describe("meter relay", { skip }, () => {
	// The relay is shared with any running server: put back the one found, rather than leave none.
	let found: { port: string; target: string } | undefined;
	const targetEnv = process.env.CODECLIMB_RELAY_TARGET;
	before(() => {
		if (relayId()) found = { port: relayLabel("cc.meter.port"), target: relayLabel("cc.meter.target") };
	});
	after(async () => {
		spawnSync("docker", ["rm", "-f", TARGET]);
		spawnSync("docker", ["rm", "-f", RELAY]);
		if (found?.port && found.target) {
			process.env.CODECLIMB_RELAY_TARGET = found.target;
			await ensureMeterPath(IMAGE, Number(found.port));
		}
		if (targetEnv === undefined) delete process.env.CODECLIMB_RELAY_TARGET;
		else process.env.CODECLIMB_RELAY_TARGET = targetEnv;
	});

	test("reused while it runs with the right port and target labels, recreated otherwise, never swept", async () => {
		process.env.CODECLIMB_RELAY_TARGET = "target-a";
		await ensureMeterPath(IMAGE, 41001);
		const first = relayId();
		assert.ok(first);
		assert.equal(relayLabel("cc.meter.target"), "target-a");
		await Promise.all([ensureMeterPath(IMAGE, 41001), ensureMeterPath(IMAGE, 41001)]);
		assert.equal(relayId(), first);
		await ensureMeterPath(IMAGE, 41002);
		const second = relayId();
		assert.notEqual(second, first);
		// Same port, another target: a relay left by another server forwards nowhere, so it is recreated.
		process.env.CODECLIMB_RELAY_TARGET = "target-b";
		await ensureMeterPath(IMAGE, 41002);
		const third = relayId();
		assert.notEqual(third, second);
		assert.equal(relayLabel("cc.meter.target"), "target-b");
		assert.equal(await new DockerBackend().sweep({ prefix: "cc-meter" }), 0);
		assert.equal(relayId(), third);
	});

	test("forwards from cc-meter to the target by its alias on cc-meter", async () => {
		spawnSync("docker", ["rm", "-f", TARGET]);
		const run = spawnSync("docker", ["run", "-d", "--name", TARGET, "--network", METER_NETWORK, "--network-alias", TARGET_ALIAS, IMAGE, "python3", "-c", `
import http.server
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"proxy here")
http.server.HTTPServer(("0.0.0.0", ${TARGET_PORT}), H).serve_forever()
`], { encoding: "utf8" });
		assert.equal(run.status, 0, run.stderr);
		process.env.CODECLIMB_RELAY_TARGET = TARGET_ALIAS;
		await ensureMeterPath(IMAGE, TARGET_PORT);
		let r = throughRelay();
		for (let i = 0; i < 10 && r.stdout.trim() !== "proxy here"; i++) {
			await new Promise((res) => setTimeout(res, 500));
			r = throughRelay();
		}
		assert.equal(r.stdout.trim(), "proxy here", r.stderr);
	});
});
