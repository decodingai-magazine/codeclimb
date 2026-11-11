// The sandbox interface: Pi's tools and the orchestrator call only this (spec: Sandboxes).
import type { ExperimentRepo } from "../experiments.ts";

export interface ExecOptions {
	/** Working directory in the sandbox; default `/repo`. */
	cwd?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
	onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
	stdin?: string | Buffer;
	env?: Record<string, string>;
}

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	aborted: boolean;
}

export interface Sandbox {
	readonly name: string;
	/** Changes when the sandbox is recreated under the same name. */
	readonly instanceId: string;
	exec(command: string, opts?: ExecOptions): Promise<ExecResult>;
	readFile(path: string): Promise<Buffer>;
	/** Creates the parent directories. */
	writeFile(path: string, data: string | Buffer): Promise<void>;
	/** Upload a host directory's contents into a sandbox directory, as a tar. */
	uploadDir(hostDir: string, sandboxDir: string): Promise<void>;
	/** Download a sandbox directory's contents into a host directory, as a tar. */
	downloadDir(sandboxDir: string, hostDir: string): Promise<void>;
	isAlive(): Promise<boolean>;
	ageMs(): Promise<number>;
	destroy(): Promise<void>;
}

export interface CreateOptions {
	name: string;
	image: string;
	labels: { night: string; run: string };
	/** A commit of the experiment repository, cloned into `/repo` through a git bundle. */
	commit?: { repo: ExperimentRepo; sha: string };
	/** Host directory uploaded as `/spec` (coders only). */
	specDir?: string;
	network?: string;
}

export interface SandboxBackend {
	/** Replaces a stale sandbox of the same name. */
	create(opts: CreateOptions): Promise<Sandbox>;
	/** A live sandbox by name, or null. */
	find(name: string): Promise<Sandbox | null>;
	/** Destroy every managed sandbox whose name starts with `prefix`, or that carries `label` (`key=value`). Returns how many. */
	sweep(by: { prefix: string } | { label: string }): Promise<number>;
	/** A backend's maximum active time, if it has one. */
	readonly maxActiveMs?: number;
}

export class SandboxRefusedError extends Error {
	override name = "SandboxRefusedError";
}
