// The scenario's host commands: placeholders, bash -c in the scenario directory, timeout, output cap (spec: Scenario contract).
import { spawn } from "node:child_process";

export const HOST_TIMEOUT_MS = 30 * 60_000;
const OUTPUT_CAP = 64 * 1024 * 1024;
export const ERROR_TAIL = 2_000;

/** Single-quote a value for bash. */
export const shellQuote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** Replace `{name}` placeholders with shell-quoted values; an unknown placeholder is an error. */
export function fillPlaceholders(template: string, values: Record<string, string>): string {
	return template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
		const v = values[key];
		if (v === undefined) throw new Error(`unknown placeholder {${key}} in \`${template}\``);
		return shellQuote(v);
	});
}

/** The last `n` characters of `text`, cut at a line start, so no half line (or half name) is kept. */
export function tail(text: string, n = ERROR_TAIL): string {
	if (text.length <= n) return text;
	if (text[text.length - n - 1] === "\n") return text.slice(-n);
	const cut = text.slice(-n);
	const nl = cut.indexOf("\n");
	return nl === -1 ? "" : cut.slice(nl + 1);
}

export interface HostCommandOptions {
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** Run `bash -c command` in `cwd`; kills its process group on timeout or abort. Throws with the output's tail on failure. */
export function runHostCommand(command: string, opts: HostCommandOptions): Promise<string> {
	return new Promise((resolve, reject) => {
		if (opts.signal?.aborted) return reject(opts.signal.reason);
		const child = spawn("bash", ["-c", command], { cwd: opts.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		let size = 0;
		let why: string | undefined;
		const killGroup = (reason: string) => {
			why ??= reason;
			try {
				process.kill(-(child.pid as number), "SIGKILL");
			} catch {}
		};
		const onData = (b: Buffer) => {
			size += b.length;
			output += b.toString("utf8");
			if (output.length > 2 * ERROR_TAIL + 1_000_000) output = output.slice(-(ERROR_TAIL + 1_000_000));
			if (size > OUTPUT_CAP) killGroup("output over 64 MiB");
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);
		const timeoutMs = opts.timeoutMs ?? HOST_TIMEOUT_MS;
		const timer = setTimeout(() => killGroup(`timeout after ${timeoutMs / 60_000} min`), timeoutMs);
		const onAbort = () => killGroup("aborted");
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", reject);
		child.on("close", (code) => {
			clearTimeout(timer);
			opts.signal?.removeEventListener("abort", onAbort);
			if (why === "aborted") return reject(opts.signal?.reason ?? new Error("aborted"));
			if (code === 0 && !why) return resolve(output);
			reject(new Error(`host command failed (${why ?? `exit ${code}`}): ${command.slice(0, 200)}\n${tail(output)}`));
		});
	});
}
