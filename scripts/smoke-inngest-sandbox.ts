// Cloud check: the Inngest sandbox backend end to end on one sandbox (create with
// /spec and a commit, helpers, processes, stdin, timeout, abort, files, the
// evaluator reset, find, re-create under the same name, sweep), then nothing left.
//   CODECLIMB_ENV=cloud npx tsx scripts/smoke-inngest-sandbox.ts
import "../codeclimb/env";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESET_SCRIPT } from "../codeclimb/evaluate";
import { ExperimentRepo } from "../codeclimb/git";
import { InngestBackend } from "../codeclimb/sandbox/inngest";
import { commitAndExport } from "../codeclimb/sandbox/repo";

const t = () => performance.now();
const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const t0 = t();
  const r = await fn();
  console.log(`ok  ${label} (${Math.round(t() - t0)} ms)`);
  return r;
};

const tmp = await mkdtemp(join(tmpdir(), "cc-smoke-"));
const repo = new ExperimentRepo(join(tmp, "experiments.git"));
await repo.ensure();
await repo.importDir("scenarios/datenorm/spec/starter", "smoke-r0");
const backend = new InngestBackend();
// No pgrep in the base image.
const SLEEPS = `n=0; for c in /proc/[0-9]*/comm; do [ "$(cat $c 2>/dev/null)" = sleep ] && n=$((n+1)); done; echo $n`;
const name = `cc-smoke-inngest-${Date.now()}`;

const commit = await repo.bundle("smoke-r0");
const sandbox = await step("create (spec + commit)", () =>
  backend.create({ name, baseline: "autocode-base", specDir: "scenarios/datenorm/spec", commit, labels: { "cc.run": "smoke-run" } }),
);
try {
  await step("tools", async () => {
    const r = await sandbox.exec("python3 --version && git --version && ls /spec | head -3 && git -C /repo log --oneline | head -1 && ls -la /tmp", { cwd: "/" });
    console.log(r.stdout.trim().replace(/^/gm, "    "));
    assert.equal(r.exitCode, 0, r.stderr);
  });
  await step("helper exit code + cwd + env", async () => {
    const r = await sandbox.exec('pwd; echo "$FOO"; exit 3', { env: { FOO: "bar" } });
    assert.deepEqual([r.exitCode, r.stdout], [3, "/repo\nbar\n"]);
  });
  await step("process with onData + stdin", async () => {
    const seen: string[] = [];
    const r = await sandbox.exec("cat; echo err >&2", { stdin: "from-stdin\n", onData: (b) => seen.push(b.toString()) });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, "from-stdin\n");
    assert.equal(r.stderr, "err\n");
    assert.match(seen.join(""), /from-stdin[\s\S]*err|err[\s\S]*from-stdin/);
  });
  await step("timeout kills the tree", async () => {
    const r = await sandbox.exec("sleep 300 & sleep 300", { timeoutMs: 3000, onData: () => {} });
    assert.equal(r.timedOut, true);
    // Children die a moment after the shell (the guest agent kills them asynchronously).
    let left = "";
    for (let i = 0; i < 10 && left !== "0"; i++) {
      if (i) await new Promise((r) => setTimeout(r, 1000));
      left = (await sandbox.exec(SLEEPS, { cwd: "/" })).stdout.trim();
    }
    assert.equal(left, "0");
  });
  await step("abort", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 2000);
    const r = await sandbox.exec("sleep 300", { signal: ac.signal });
    assert.equal(r.aborted, true);
  });
  await step("files: write into a new dir, read back, 3 MiB", async () => {
    await sandbox.writeFile("/tmp/cc/new/dir/a.txt", "héllo");
    assert.equal((await sandbox.readFile("/tmp/cc/new/dir/a.txt")).toString(), "héllo");
    const mid = Buffer.alloc(60 * 1024, 5);
    await sandbox.writeFile("/tmp/cc/mid.bin", mid);
    assert.ok((await sandbox.readFile("/tmp/cc/mid.bin")).equals(mid));
    const big = Buffer.alloc(3 * 2 ** 20, 7);
    await sandbox.writeFile("/tmp/cc/big.bin", big);
    assert.ok((await sandbox.readFile("/tmp/cc/big.bin")).equals(big));
    await assert.rejects(sandbox.readFile("/nope"), /ENOENT/);
  });
  await step("commitAndExport", async () => {
    await sandbox.exec("echo x > new.txt");
    const { sha, bundle } = await commitAndExport(sandbox, commit.ref, "smoke");
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.ok(bundle.length > 0);
  });
  await step("evaluator reset spares the guest agent", async () => {
    await sandbox.exec("nohup sleep 300 >/dev/null 2>&1 &", { cwd: "/" });
    const r = await sandbox.exec(RESET_SCRIPT, { cwd: "/", timeoutMs: 120_000 });
    assert.equal(r.exitCode, 0, r.stderr);
    const after = await sandbox.exec(SLEEPS, { cwd: "/" });
    assert.equal(after.stdout.trim(), "0");
  });
  await step("find + isAlive + instanceId", async () => {
    const found = await backend.find(name);
    assert.ok(found);
    assert.equal(await found.isAlive(), true);
    assert.equal(await found.instanceId(), await sandbox.instanceId());
  });
  await step("re-create under the same name gives a new sandbox", async () => {
    const before = await sandbox.instanceId();
    const again = await backend.create({ name, baseline: "autocode-base" });
    assert.notEqual(await again.instanceId(), before);
    assert.equal(await again.isAlive(), true);
  });
  await step("sweep by run label", async () => {
    assert.equal(await backend.sweep({ label: ["cc.run", "smoke-run"] }), 1);
    assert.equal(await backend.find(name), null);
  });
} finally {
  const left = await backend.sweep({ prefix: name });
  console.log(`swept ${left} left over`);
}
