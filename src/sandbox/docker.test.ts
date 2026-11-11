// Integration tests against the local Docker daemon. Skipped, with a message, when Docker is not running.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { ExperimentRepo } from "../experiments.ts";
import { DockerBackend } from "./docker.ts";
import { pullCommit } from "./transfer.ts";

const IMAGE = "codeclimb-python";
// `docker images -q`, not `docker image inspect`: the latter misses some images Docker Desktop can run.
const probe = spawnSync("docker", ["images", "-q", IMAGE], { encoding: "utf8" });
const dockerUp = probe.status === 0 && probe.stdout.trim() !== "";
const skip = dockerUp ? false : `Docker is not running or image ${IMAGE} is missing (npm run build:image): Docker tests skipped`;
if (skip) console.log(`# ${skip}`);

const PREFIX = `cc-t${randomBytes(3).toString("hex")}`;
const backend = new DockerBackend();
const labels = (run: string) => ({ night: PREFIX.slice(3), run });

describe("Docker sandbox", { skip, concurrency: true }, () => {
	after(async () => {
		await backend.sweep({ prefix: PREFIX });
	});

	test("create, exec, find by name, sweep by prefix", async () => {
		const sb = await backend.create({ name: `${PREFIX}-sw-a`, image: IMAGE, labels: labels("a") });
		const r = await sb.exec("echo out; echo err >&2; exit 3", { cwd: "/" });
		assert.deepEqual([r.exitCode, r.stdout, r.stderr, r.timedOut, r.aborted], [3, "out\n", "err\n", false, false]);
		const streamed: string[] = [];
		await sb.exec("echo one; echo two", { onOutput: (chunk) => streamed.push(chunk) });
		assert.equal(streamed.join(""), "one\ntwo\n");
		const env = await sb.exec('printf %s "$FOO"', { env: { FOO: "bar" } });
		assert.equal(env.stdout, "bar");
		const stdin = await sb.exec("cat", { stdin: "piped" });
		assert.equal(stdin.stdout, "piped");
		const found = await backend.find(`${PREFIX}-sw-a`);
		assert.equal(found?.instanceId, sb.instanceId);
		assert.equal(await backend.find(`${PREFIX}-sw-nope`), null);
		await backend.create({ name: `${PREFIX}-sw-b`, image: IMAGE, labels: labels("b") });
		const other = await backend.create({ name: `x${PREFIX}-sw-c`, image: IMAGE, labels: labels("c") });
		assert.equal(await backend.sweep({ prefix: `${PREFIX}-sw-` }), 2);
		assert.equal(await backend.find(`${PREFIX}-sw-a`), null);
		assert.equal(await backend.find(`${PREFIX}-sw-b`), null);
		assert.ok(await other.isAlive(), "the prefix is anchored at the name's start");
		await other.destroy();
	});

	test("a timeout, an abort, and an aborted signal all kill the whole process tree", async () => {
		const sb = await backend.create({ name: `${PREFIX}-kill`, image: IMAGE, labels: labels("kill") });
		const tree = "sleep 301 & (sleep 302 &) ; sleep 303";
		const t = await sb.exec(tree, { timeoutMs: 1500 });
		assert.equal(t.timedOut, true);
		const ac = new AbortController();
		setTimeout(() => ac.abort(), 1500);
		const a = await sb.exec(tree, { signal: ac.signal });
		assert.equal(a.aborted, true);
		const pre = AbortSignal.abort();
		const p = await sb.exec("touch /tmp/ran; sleep 304", { signal: pre });
		assert.equal(p.aborted, true);
		await new Promise((r) => setTimeout(r, 500));
		const ps = await sb.exec("ps -eo args= 2>/dev/null || ls /proc | grep -E '^[0-9]+$' | while read p; do tr '\\0' ' ' < /proc/$p/cmdline; echo; done");
		assert.doesNotMatch(ps.stdout, /sleep 30[1-4]/);
		assert.equal((await sb.exec("test -e /tmp/ran")).exitCode, 1);
	});

	test("a file of 10 MiB survives a write and a read; write creates parent directories", async () => {
		const sb = await backend.create({ name: `${PREFIX}-file`, image: IMAGE, labels: labels("file") });
		const data = randomBytes(10 * 1024 * 1024 + 7);
		await sb.writeFile("/deep/new/dir/blob.bin", data);
		const back = await sb.readFile("/deep/new/dir/blob.bin");
		assert.ok(back.equals(data));
	});

	test("a directory moves as a tar, and /spec is uploaded at create", async () => {
		const spec = mkdtempSync(join(tmpdir(), "cc-spec-"));
		mkdirSync(join(spec, "spec"));
		writeFileSync(join(spec, "spec", "SPEC.md"), "the spec\n");
		const sb = await backend.create({ name: `${PREFIX}-dir`, image: IMAGE, labels: labels("dir"), specDir: spec });
		assert.equal((await sb.exec("cat /spec/spec/SPEC.md")).stdout, "the spec\n");
		await sb.exec("mkdir -p /out/sub && echo hi > /out/sub/a.txt");
		const dest = mkdtempSync(join(tmpdir(), "cc-out-"));
		await sb.downloadDir("/out", dest);
		assert.equal(execFileSync("cat", [join(dest, "sub", "a.txt")], { encoding: "utf8" }), "hi\n");
	});

	test("a commit moves host to sandbox and back as a git bundle, with no git credentials in the sandbox", async () => {
		const repo = await ExperimentRepo.open(join(mkdtempSync(join(tmpdir(), "cc-repo-")), "experiments.git"));
		const parent = await repo.importStarter("scenarios/datenorm/starter", "t-r0-starter");
		const sb = await backend.create({ name: `${PREFIX}-git`, image: IMAGE, labels: labels("git"), commit: { repo, sha: parent } });
		assert.equal((await sb.exec("git -C /repo rev-parse HEAD")).stdout.trim(), parent);
		assert.equal((await sb.exec("test -e /repo/README.md")).exitCode, 0);
		assert.notEqual((await sb.exec("git config --get credential.helper")).exitCode, 0);
		assert.equal((await sb.exec("test -e ~/.git-credentials || test -e ~/.config/git/credentials")).exitCode, 1);
		await sb.exec("echo change >> /repo/README.md && git -C /repo commit -qam change");
		const sha = await pullCommit(sb, repo, "t-r1-e0");
		assert.equal(await repo.resolve("t-r1-e0"), sha);
		assert.notEqual(sha, parent);
		assert.equal(execFileSync("git", ["--git-dir", repo.dir, "rev-parse", `${sha}^`], { encoding: "utf8" }).trim(), parent);
	});

	test("a container has 2 CPUs, 2 GiB and the managed labels", async () => {
		const sb = await backend.create({ name: `${PREFIX}-lim`, image: IMAGE, labels: labels("lim") });
		const info = JSON.parse(execFileSync("docker", ["inspect", sb.instanceId], { encoding: "utf8" }))[0];
		assert.equal(info.HostConfig.NanoCpus, 2e9);
		assert.equal(info.HostConfig.Memory, 2 * 1024 ** 3);
		assert.deepEqual(
			{ m: info.Config.Labels["cc.managed"], n: info.Config.Labels["cc.night"], r: info.Config.Labels["cc.run"] },
			{ m: "1", n: PREFIX.slice(3), r: "lim" },
		);
	});

	test("create replaces a stale sandbox of the same name", async () => {
		const first = await backend.create({ name: `${PREFIX}-stale`, image: IMAGE, labels: labels("s") });
		await first.exec("touch /marker");
		const second = await backend.create({ name: `${PREFIX}-stale`, image: IMAGE, labels: labels("s") });
		assert.notEqual(second.instanceId, first.instanceId);
		assert.equal((await second.exec("test -e /marker")).exitCode, 1);
		assert.equal(await first.isAlive(), false);
	});

	test("create refuses a night the refusal check names", async () => {
		const guarded = new DockerBackend({ refuseNight: (night) => night === "stopped" });
		await assert.rejects(guarded.create({ name: `${PREFIX}-ref`, image: IMAGE, labels: { night: "stopped", run: "x" } }), /stop/);
		assert.equal(await backend.find(`${PREFIX}-ref`), null);
	});
});
