// Docker backend (dev): one container per sandbox, `docker exec` for commands
// and file transfer. Commands run in their own session so a timeout or abort
// kills the whole process tree inside the container, not just the docker CLI.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cloneInto } from "./repo";
import type {
  CreateSandboxOptions,
  ExecOptions,
  ExecResult,
  Sandbox,
  SandboxBackend,
} from "./types";

const CPUS = "2";
const MEMORY = "2g";

interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

function docker(args: string[], opts: { stdin?: Buffer | string; onData?: (b: Buffer) => void } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => {
      out.push(b);
      opts.onData?.(b);
    });
    child.stderr.on("data", (b: Buffer) => {
      err.push(b);
      opts.onData?.(b);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
    child.stdin.on("error", () => {});
    child.stdin.end(opts.stdin ?? "");
  });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

class DockerSandbox implements Sandbox {
  constructor(readonly name: string) {}

  async exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    if (opts.signal?.aborted) return { exitCode: 130, stdout: "", stderr: "", timedOut: false, aborted: true };
    const pidFile = `/tmp/cc-exec-${randomUUID()}.pid`;
    // setsid -w: new session (pgid = pid) and wait for it, so we can kill the group.
    const script = `echo $$ > ${pidFile}; ${command}`;
    const args = ["exec", "-i", "-w", opts.cwd ?? "/repo", this.name, "setsid", "-w", "bash", "-c", script];
    let timedOut = false;
    let aborted = false;
    const kill = () =>
      docker(["exec", this.name, "bash", "-c", `kill -KILL -- -$(cat ${pidFile}) 2>/dev/null; true`]).catch(() => undefined);
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
    try {
      const r = await docker(args, { stdin: opts.stdin, onData: opts.onData });
      return { exitCode: r.code, stdout: r.stdout.toString(), stderr: r.stderr.toString(), timedOut, aborted };
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      void docker(["exec", this.name, "rm", "-f", pidFile]).catch(() => undefined);
    }
  }

  async readFile(path: string): Promise<Buffer> {
    const r = await docker(["exec", this.name, "cat", "--", path]);
    if (r.code !== 0) throw new Error(`ENOENT: cannot read ${path}: ${r.stderr.toString().trim()}`);
    return r.stdout;
  }

  async writeFile(path: string, data: Buffer | string): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf("/")) || "/";
    const r = await docker(
      ["exec", "-i", this.name, "bash", "-c", `mkdir -p ${shellQuote(dir)} && cat > ${shellQuote(path)}`],
      { stdin: data },
    );
    if (r.code !== 0) throw new Error(`cannot write ${path}: ${r.stderr.toString().trim()}`);
  }

  async isAlive(): Promise<boolean> {
    const r = await docker(["inspect", "-f", "{{.State.Running}}", this.name]);
    return r.code === 0 && r.stdout.toString().trim() === "true";
  }

  async destroy(): Promise<void> {
    await docker(["rm", "-f", this.name]);
  }
}

export class DockerBackend implements SandboxBackend {
  readonly kind = "docker" as const;

  async create(opts: CreateSandboxOptions): Promise<Sandbox> {
    await docker(["rm", "-f", opts.name]); // a stale container from a crashed attempt
    const labels = Object.entries({ "cc.managed": "1", ...opts.labels }).flatMap(([k, v]) => ["--label", `${k}=${v}`]);
    const r = await docker([
      "run", "-d", "--cpus", CPUS, "--memory", MEMORY, "--network", opts.network ?? "none",
      "--name", opts.name, ...labels, opts.baseline, "sleep", "infinity",
    ]);
    if (r.code !== 0) throw new Error(`docker run failed: ${r.stderr.toString().trim()}`);
    const sandbox = new DockerSandbox(opts.name);
    try {
      await cloneInto(sandbox, opts.commit);
    } catch (e) {
      await sandbox.destroy();
      throw e;
    }
    return sandbox;
  }

  async find(name: string): Promise<Sandbox | null> {
    const sandbox = new DockerSandbox(name);
    return (await sandbox.isAlive()) ? sandbox : null;
  }

  async sweep(filter: { prefix?: string; label?: [string, string] }): Promise<number> {
    const args = ["ps", "-aq", "--filter", "label=cc.managed=1"];
    if (filter.prefix) args.push("--filter", `name=^${filter.prefix}`);
    if (filter.label) args.push("--filter", `label=${filter.label[0]}=${filter.label[1]}`);
    const ids = (await docker(args)).stdout.toString().split("\n").filter(Boolean);
    if (ids.length) await docker(["rm", "-f", ...ids]);
    return ids.length;
  }
}
