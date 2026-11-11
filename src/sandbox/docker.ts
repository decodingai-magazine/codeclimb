// Docker backend of the sandbox interface (spec: Sandboxes, Docker backend).
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { Readable } from "node:stream";
import { pushCommit } from "./transfer.ts";
import { type CreateOptions, type ExecOptions, type ExecResult, type Sandbox, type SandboxBackend, SandboxRefusedError } from "./types.ts";

const PID_DIR = "/tmp/.cc-pid";
/** Helper execs run from `/`: `/repo` is missing during an evaluator's reset. */
const HELPER_CWD = "/";

interface Proc {
	code: number;
	stdout: Buffer;
	stderr: string;
}

/** Run `docker <args>`, collecting output as buffers (no size limit). `input` is written to stdin or piped from a stream. */
function docker(args: string[], input?: string | Buffer | Readable): Promise<Proc> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on("data", (b: Buffer) => out.push(b));
		child.stderr.on("data", (b: Buffer) => err.push(b));
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString("utf8") }));
		child.stdin.on("error", () => {});
		if (input === undefined) child.stdin.end();
		else if (typeof input === "string" || Buffer.isBuffer(input)) child.stdin.end(input);
		else input.pipe(child.stdin);
	});
}

async function dockerOk(args: string[], input?: string | Buffer | Readable): Promise<Buffer> {
	const r = await docker(args, input);
	if (r.code !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} failed (${r.code}): ${r.stderr.trim().slice(-2000)}`);
	return r.stdout;
}

class DockerSandbox implements Sandbox {
	constructor(
		readonly name: string,
		readonly instanceId: string,
	) {}

	exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
		if (opts.signal?.aborted) return Promise.resolve({ exitCode: -1, stdout: "", stderr: "", timedOut: false, aborted: true });
		const pidFile = `${PID_DIR}/${randomUUID()}`;
		const env = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
		// A new session leader writes its pid first, so a second exec can kill its whole process group.
		const leader = `mkdir -p ${PID_DIR}; echo $$ > "$0"; exec bash -c "$1"`;
		const args = ["exec", ...(opts.stdin !== undefined ? ["-i"] : []), "-w", opts.cwd ?? "/repo", ...env, this.instanceId, "setsid", "-w", "bash", "-c", leader, pidFile, command];
		return new Promise((resolve, reject) => {
			const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			let aborted = false;
			let killing = false;
			child.stdout.setEncoding("utf8").on("data", (s: string) => {
				stdout += s;
				opts.onOutput?.(s, "stdout");
			});
			child.stderr.setEncoding("utf8").on("data", (s: string) => {
				stderr += s;
				opts.onOutput?.(s, "stderr");
			});
			child.stdin.on("error", () => {});
			child.stdin.end(opts.stdin);
			const killTree = async () => {
				if (killing) return;
				killing = true;
				// Killing the docker exec client alone leaves the command running in the container.
				for (let i = 0; i < 20 && child.exitCode === null; i++) {
					await docker(["exec", "-w", HELPER_CWD, this.instanceId, "bash", "-c", 'p=$(cat "$1" 2>/dev/null) && [ -n "$p" ] && kill -KILL -- "-$p"', "bash", pidFile]);
					await new Promise((r) => setTimeout(r, 250));
				}
				if (child.exitCode === null) child.kill("SIGKILL");
			};
			const timer = opts.timeoutMs === undefined ? undefined : setTimeout(() => {
				timedOut = true;
				void killTree();
			}, opts.timeoutMs);
			const onAbort = () => {
				aborted = true;
				void killTree();
			};
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			child.on("error", reject);
			child.on("close", (code) => {
				if (timer) clearTimeout(timer);
				opts.signal?.removeEventListener("abort", onAbort);
				void docker(["exec", "-w", HELPER_CWD, this.instanceId, "rm", "-f", pidFile]);
				resolve({ exitCode: code ?? -1, stdout, stderr, timedOut, aborted });
			});
		});
	}

	async readFile(path: string): Promise<Buffer> {
		return dockerOk(["exec", "-w", HELPER_CWD, this.instanceId, "cat", "--", path]);
	}

	async writeFile(path: string, data: string | Buffer): Promise<void> {
		await dockerOk(["exec", "-i", "-w", HELPER_CWD, this.instanceId, "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path], data);
	}

	async uploadDir(hostDir: string, sandboxDir: string): Promise<void> {
		const tar = spawn("tar", ["-c", "-C", hostDir, "."], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COPYFILE_DISABLE: "1" } });
		const [r] = await Promise.all([
			docker(["exec", "-i", "-w", HELPER_CWD, this.instanceId, "sh", "-c", 'mkdir -p "$1" && tar -x --no-same-owner -C "$1"', "sh", sandboxDir], tar.stdout),
			new Promise((res) => tar.on("close", res)),
		]);
		if (r.code !== 0) throw new Error(`upload ${hostDir} → ${sandboxDir}: ${r.stderr.trim().slice(-2000)}`);
	}

	async downloadDir(sandboxDir: string, hostDir: string): Promise<void> {
		mkdirSync(hostDir, { recursive: true });
		const tarball = await dockerOk(["exec", "-w", HELPER_CWD, this.instanceId, "tar", "-c", "-C", sandboxDir, "."]);
		await new Promise<void>((resolve, reject) => {
			const tar = spawn("tar", ["-x", "-C", hostDir], { stdio: ["pipe", "ignore", "pipe"] });
			let err = "";
			tar.stderr.setEncoding("utf8").on("data", (s: string) => (err += s));
			tar.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`untar into ${hostDir}: ${err.slice(-2000)}`))));
			tar.stdin.end(tarball);
		});
	}

	async isAlive(): Promise<boolean> {
		const r = await docker(["inspect", "-f", "{{.State.Running}}", this.instanceId]);
		return r.code === 0 && r.stdout.toString().trim() === "true";
	}

	async ageMs(): Promise<number> {
		const started = (await dockerOk(["inspect", "-f", "{{.State.StartedAt}}", this.instanceId])).toString().trim();
		return Date.now() - Date.parse(started);
	}

	async destroy(): Promise<void> {
		await docker(["rm", "-f", this.instanceId]);
	}
}

export interface DockerBackendOptions {
	/** Refuse to create a sandbox for this night (it has a `stop.json`). */
	refuseNight?: (night: string) => boolean;
}

export class DockerBackend implements SandboxBackend {
	constructor(private readonly opts: DockerBackendOptions = {}) {}

	async create(o: CreateOptions): Promise<Sandbox> {
		if (this.opts.refuseNight?.(o.labels.night)) throw new SandboxRefusedError(`night ${o.labels.night} is stopped: no new sandbox`);
		await docker(["rm", "-f", o.name]);
		const args = ["run", "-d", "--name", o.name, "--cpus", "2", "--memory", "2g", "--memory-swap", "2g"];
		args.push("--label", "cc.managed=1", "--label", `cc.night=${o.labels.night}`, "--label", `cc.run=${o.labels.run}`);
		if (o.network) args.push("--network", o.network);
		args.push(o.image);
		const id = (await dockerOk(args)).toString().trim();
		const sb = new DockerSandbox(o.name, id);
		try {
			if (o.commit) await pushCommit(sb, o.commit.repo, o.commit.sha);
			if (o.specDir) await sb.uploadDir(o.specDir, "/spec");
		} catch (error) {
			await sb.destroy();
			throw error;
		}
		return sb;
	}

	async find(name: string): Promise<Sandbox | null> {
		const r = await docker(["inspect", "-f", '{{.Id}} {{.State.Running}} {{index .Config.Labels "cc.managed"}}', name]);
		if (r.code !== 0) return null;
		const [id, running, managed] = r.stdout.toString().trim().split(" ");
		return id && running === "true" && managed === "1" ? new DockerSandbox(name, id) : null;
	}

	async sweep(by: { prefix: string } | { label: string }): Promise<number> {
		const filters = ["--filter", "label=cc.managed=1"];
		if ("label" in by) filters.push("--filter", `label=${by.label}`);
		const names = (await dockerOk(["ps", "-a", ...filters, "--format", "{{.Names}}"])).toString().split("\n").filter(Boolean);
		// Docker's name filter matches anywhere in the name: anchor the prefix here.
		const doomed = "prefix" in by ? names.filter((n) => n.startsWith(by.prefix)) : names;
		await Promise.all(doomed.map((n) => docker(["rm", "-f", n])));
		return doomed.length;
	}
}
