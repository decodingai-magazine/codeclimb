// One interface for every sandbox backend. Pi's tool adapters and the
// orchestrator only ever call this.

export interface ExecOptions {
  cwd?: string;
  /** Kill the command after this many ms; the result then has `timedOut: true`. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Streams stdout + stderr chunks as they arrive. */
  onData?: (chunk: Buffer) => void;
  stdin?: Buffer | string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

/** A commit to clone into `/repo`: a git bundle plus the ref inside it. */
export interface RepoCommit {
  bundle: Buffer;
  ref: string;
}

export interface Sandbox {
  readonly name: string;
  exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  isAlive(): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface CreateSandboxOptions {
  /** Unique, deterministic name, e.g. `cc-<night>-r2-b1`. Reused to find a live sandbox on retry. */
  name: string;
  /** Baseline environment (Docker image / Inngest custom image). */
  baseline: string;
  /** Commit cloned into `/repo`. */
  commit: RepoCommit;
  labels?: Record<string, string>;
  network?: "none" | "bridge";
}

export interface SandboxBackend {
  readonly kind: "docker" | "inngest";
  create(opts: CreateSandboxOptions): Promise<Sandbox>;
  /** A live sandbox by name, or null. Used to resume a crashed Pi step. */
  find(name: string): Promise<Sandbox | null>;
  /** Destroy every sandbox whose name starts with `prefix` or that carries `label=value`. */
  sweep(filter: { prefix?: string; label?: [string, string] }): Promise<number>;
}
