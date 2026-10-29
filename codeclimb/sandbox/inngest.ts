// Inngest Sandboxes backend (Cloud): one microVM per sandbox, driven through the
// SDK's direct client. Long or interactive commands run as sandbox processes
// (streamed output, kill on timeout or abort with their children); short helper
// commands go through `commands.run`, which is one round trip.
//
// Differences from Docker that callers see: egress is open (no network option),
// there are no labels (a run's sandboxes are tracked in this worker's memory),
// and the image has no /spec, so `create` uploads it.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Sandbox as SdkSandbox, SandboxProcess } from "inngest/experimental";
import { SandboxError } from "inngest/experimental";
import { ccInngest } from "../../inngest/codeclimb/client";
import { cloneInto } from "./repo";
import type { CreateSandboxOptions, ExecOptions, ExecResult, Sandbox, SandboxBackend } from "./types";

const VCPU = 2;
const MEMORY_MB = 2048;
/** Helpers up to this long use `commands.run` (which cannot be killed); longer ones run as processes. */
const HELPER_MAX_MS = 120_000;
/** The longest single `wait`; the exec loops until its own deadline. */
const WAIT_SLICE = "60s";
/** A sandbox normally starts in under 2 s; one still starting after this is replaced. */
const START_TIMEOUT = "45s";
/** Files up to this size come back inline as base64. */
const INLINE_READ_MAX = 64 * 1024;
/** Not base64: marks a file too big to inline. */
const BIG = "@big@";
const DEAD = new Set(["TERMINATING", "TERMINATED", "FAILED"]);

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isCode = (e: unknown, code: string) => e instanceof SandboxError && e.code === code;

/** Sandbox names created per Inngest run, for `sweep({ label: ["cc.run", runId] })`. Night sweeps cover a restarted worker. */
const byRun = new Map<string, Set<string>>();

class InngestSandbox implements Sandbox {
  constructor(private sb: SdkSandbox) {}

  get name(): string {
    return this.sb.name;
  }

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (opts.signal?.aborted) return { exitCode: 130, stdout: "", stderr: "", timedOut: false, aborted: true };
    const helper = !opts.onData && !opts.signal && opts.stdin === undefined && (opts.timeoutMs ?? 0) <= HELPER_MAX_MS;
    return helper ? this.run(command, opts) : this.process(command, opts);
  }

  private async run(command: string, opts: ExecOptions): Promise<ExecResult> {
    try {
      const r = await this.sb.commands.run(["/bin/bash", "-c", command], {
        cwd: opts.cwd ?? "/repo",
        environment: opts.env,
        timeout: `${Math.ceil((opts.timeoutMs ?? HELPER_MAX_MS) / 1000)}s`,
      });
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: false, aborted: false };
    } catch (e) {
      if (isCode(e, "sandbox_exec_timed_out")) return { exitCode: 124, stdout: "", stderr: "", timedOut: true, aborted: false };
      throw e;
    }
  }

  private async process(command: string, opts: ExecOptions): Promise<ExecResult> {
    let script = command;
    if (opts.stdin !== undefined) {
      // Open the uploaded stdin, then drop the file: the fd stays valid.
      const file = `/tmp/cc-exec-${randomUUID()}.in`;
      await this.writeFile(file, opts.stdin);
      script = `exec < ${file}; rm -f ${file}; ${command}`;
    }
    const proc = await this.sb.processes.start({
      command: ["/bin/bash", "-c", script], cwd: opts.cwd ?? "/repo", environment: opts.env,
    });

    let timedOut = false;
    let aborted = false;
    const kill = () => proc.signal({ signal: 9, includeChildren: true }).catch(() => undefined);
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          void kill();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      void kill();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    // Live output for Pi's bash tool; on a broken stream the rest comes from getOutput below.
    let streamed = 0;
    let streamDone = false;
    const pump = opts.onData
      ? (async () => {
          const reader = (await proc.streamOutput()).getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            streamed += 1;
            opts.onData!(Buffer.from(value.data));
          }
          streamDone = true;
        })().catch(() => undefined)
      : Promise.resolve();

    try {
      const done = await waitFor(proc);
      // The stream ends with the process; don't hang on a stuck one.
      await Promise.race([pump, sleep(10_000)]);
      const chunks = await proc
        .getOutput()
        .then((o) => o.chunks)
        .catch((e) => {
          if (isCode(e, "sandbox_process_output_not_retained")) return [];
          throw e;
        });
      if (opts.onData && !streamDone) for (const c of chunks.slice(streamed)) opts.onData(Buffer.from(c.data));
      const text = (stream: "STDOUT" | "STDERR") =>
        Buffer.concat(chunks.filter((c) => c.stream === stream).map((c) => Buffer.from(c.data))).toString();
      if (done.state === "FAILED" || done.state === "LOST") throw new Error(`sandbox process ${done.state.toLowerCase()} in ${this.name}`);
      const exitCode = done.exitCode ?? 128 + (done.terminationSignal ?? 9);
      return { exitCode, stdout: text("STDOUT"), stderr: text("STDERR"), timedOut, aborted };
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  async readFile(path: string): Promise<Buffer> {
    // Small files come back as base64 on stdout (one round trip, faster than a download); bigger ones
    // are downloaded, since the SDK's base64 check overflows the stack on multi-MiB output.
    const q = quote(path);
    const r = await this.sb.commands.run(
      ["/bin/sh", "-c", `test -f ${q} -a -r ${q} || exit 2; [ "$(stat -c %s -- ${q})" -le ${INLINE_READ_MAX} ] && base64 -w0 -- ${q} || echo ${BIG}`],
      { cwd: "/" },
    );
    if (r.exitCode !== 0) throw new Error(`ENOENT: cannot read ${path}: ${r.stderr.trim()}`);
    if (r.stdout.trim() !== BIG && !r.output.truncated) return Buffer.from(r.stdout, "base64");
    return Buffer.from(await (await this.sb.files.download({ path })).arrayBuffer());
  }

  async writeFile(path: string, data: Buffer | string): Promise<void> {
    const body = new Uint8Array(typeof data === "string" ? Buffer.from(data) : data);
    try {
      await this.sb.files.upload({ path, data: body });
    } catch (e) {
      // Upload does not create parent directories.
      if (!isCode(e, "sandbox_file_not_found") && (e as SandboxError).status !== 404) throw e;
      const dir = path.slice(0, path.lastIndexOf("/")) || "/";
      const r = await this.sb.commands.run(["/bin/sh", "-c", `mkdir -p ${quote(dir)}`], { cwd: "/" });
      if (r.exitCode !== 0) throw new Error(`cannot write ${path}: ${r.stderr.trim()}`);
      await this.sb.files.upload({ path, data: body });
    }
  }

  async isAlive(): Promise<boolean> {
    const s = await ccInngest.sandboxes.get(this.sb.id);
    return s?.status === "RUNNING";
  }

  async instanceId(): Promise<string> {
    return this.sb.id;
  }

  async destroy(): Promise<void> {
    await this.sb.destroy().catch((e) => {
      if (!isCode(e, "sandbox_not_found")) throw e;
    });
  }
}

/** Wait for a process to end, in slices: a single wait is capped by the API. */
async function waitFor(proc: SandboxProcess): Promise<SandboxProcess> {
  let failures = 0;
  for (;;) {
    try {
      const p = await proc.wait({ timeout: WAIT_SLICE });
      if (p.state !== "STARTING" && p.state !== "RUNNING") return p;
    } catch (e) {
      if (isCode(e, "sandbox_process_wait_timed_out")) continue;
      if (!(e instanceof SandboxError && e.retryable) || ++failures > 5) throw e;
      await sleep(1000 * failures);
    }
  }
}

/** Every sandbox of this account, all pages. */
async function listAll(): Promise<SdkSandbox[]> {
  const all: SdkSandbox[] = [];
  let cursor: string | undefined;
  do {
    const page = await ccInngest.sandboxes.list({ limit: 100, cursor });
    all.push(...page.items);
    cursor = page.page.hasMore ? page.page.cursor : undefined;
  } while (cursor);
  return all;
}

/** The live sandboxes called `name` (normally zero or one). */
async function liveNamed(name: string): Promise<SdkSandbox[]> {
  return (await listAll()).filter((s) => s.name === name && !DEAD.has(s.status));
}

/** The spec bundle at /spec, and the git defaults the Docker baseline sets in its image. */
async function setUp(sandbox: InngestSandbox, specDir: string | undefined): Promise<void> {
  const git = [
    "git config --global user.name codeclimb",
    "git config --global user.email codeclimb@localhost",
    "git config --global init.defaultBranch main",
    "git config --global --add safe.directory '*'",
  ].join(" && ");
  let script = `mkdir -p /repo /spec /tmp/cc && ${git}`;
  if (specDir) {
    await sandbox.writeFile("/tmp/cc/spec.tar", execFileSync("tar", ["-C", specDir, "-cf", "-", "."], { maxBuffer: 100 * 2 ** 20 }));
    script += " && tar -xf /tmp/cc/spec.tar -C /spec && rm -f /tmp/cc/spec.tar";
  }
  const r = await sandbox.exec(script, { cwd: "/" });
  if (r.exitCode !== 0) throw new Error(`sandbox setup failed (${r.exitCode}): ${r.stderr.trim()}`);
}

export class InngestBackend implements SandboxBackend {
  readonly kind = "inngest" as const;

  async create(opts: CreateSandboxOptions): Promise<Sandbox> {
    // A stale sandbox from a crashed attempt: destroy it, as Docker's `rm -f` does.
    for (const old of await liveNamed(opts.name)) await old.destroy().catch(() => undefined);
    const sb = await createFresh(opts.name);
    const runId = opts.labels?.["cc.run"];
    if (runId) byRun.set(runId, (byRun.get(runId) ?? new Set()).add(opts.name));
    const sandbox = new InngestSandbox(sb);
    try {
      await setUp(sandbox, opts.specDir);
      if (opts.commit) await cloneInto(sandbox, opts.commit);
    } catch (e) {
      await sandbox.destroy();
      throw e;
    }
    return sandbox;
  }

  async find(name: string): Promise<Sandbox | null> {
    const [sb] = await liveNamed(name);
    if (!sb) return null;
    if (sb.status === "RUNNING") return new InngestSandbox(sb);
    if (sb.status === "PAUSED" || sb.status === "PAUSING") return new InngestSandbox(await sb.resume());
    // Still starting (or resuming): give it a moment, else treat it as lost; create() replaces it.
    const ready = await sb.waitUntilRunning({ timeout: "30s" }).catch(() => null);
    return ready?.status === "RUNNING" ? new InngestSandbox(ready) : null;
  }

  async sweep(filter: { prefix?: string; label?: [string, string] }): Promise<number> {
    let names: Set<string> | undefined;
    if (filter.label) {
      // Only `cc.run` is tracked; other labels have no Inngest equivalent.
      if (filter.label[0] !== "cc.run") return 0;
      names = byRun.get(filter.label[1]);
      byRun.delete(filter.label[1]);
      if (!names?.size) return 0;
    }
    // A finished night's runs no longer need tracking.
    if (filter.prefix) for (const [run, set] of byRun) if ([...set].every((n) => n.startsWith(filter.prefix!))) byRun.delete(run);
    const doomed = (await listAll()).filter(
      (s) => !DEAD.has(s.status) && (!filter.prefix || s.name.startsWith(filter.prefix)) && (!names || names.has(s.name)),
    );
    await Promise.all(doomed.map((s) => s.destroy().catch(() => undefined)));
    return doomed.length;
  }
}

/** Destroy a sandbox by id, ignoring one already gone. */
async function destroyId(id: string | undefined): Promise<void> {
  if (id) await (await ccInngest.sandboxes.get(id).catch(() => null))?.destroy().catch(() => undefined);
}

/**
 * Create, retrying while a destroyed namesake still holds the name, and replacing a sandbox that
 * never reaches RUNNING (seen in the beta: stuck in STARTING with "launch result is unknown").
 */
async function createFresh(name: string): Promise<SdkSandbox> {
  for (let attempt = 0; ; attempt++) {
    try {
      const sb = await ccInngest.sandboxes.create({
        name, vcpu: VCPU, memoryMb: MEMORY_MB, environment: { PYTHONDONTWRITEBYTECODE: "1" }, runningTimeout: START_TIMEOUT,
      });
      if (sb.status === "RUNNING") return sb;
      await sb.destroy().catch(() => undefined);
      throw new Error(`sandbox ${name} came back ${sb.status}`);
    } catch (e) {
      const stuck = isCode(e, "sandbox_start_timed_out");
      if (stuck) await destroyId((e as SandboxError).sandboxId);
      const retry = stuck || isCode(e, "sandbox_name_taken") || (e instanceof SandboxError && e.retryable) || /came back/.test(String(e));
      if (!retry || attempt >= 6) throw e;
      await sleep(2000 + attempt * 1000);
    }
  }
}
