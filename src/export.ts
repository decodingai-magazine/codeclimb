// Export one experiment's commit out of a results directory's `experiments.git` (spec: Export): a folder of plain files,
// a folder as a git repository with the kept lineage on `codeclimb/<exp id>`, or a push of that lineage to a remote branch.
// The CLI and the worker API both call it, so every user-supplied value is validated here. No LangGraph.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readJson } from "./night/files.ts";
import type { DoneJson } from "./night/types.ts";

export type ExportTarget = { kind: "dir"; path: string; withHistory?: boolean; force?: boolean } | { kind: "remote"; url: string; branch?: string };

export interface ExportResult {
	expId: string;
	sha: string;
	destination: string;
	branch?: string;
	log: string;
}

/** The transports git may use. `ext::` and `fd::` run commands and are not among them. */
const ALLOWED_PROTOCOLS = ["file", "git", "https", "ssh"];
const EXP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

interface Run {
	code: number;
	stdout: string;
	stderr: string;
}

function run(cmd: string, args: string[], opts: { cwd?: string; stdin?: NodeJS.ReadableStream } = {}): Promise<Run> {
	return new Promise((done, fail) => {
		// Git never prompts for credentials, and only the allowed transports work.
		const p = spawn(cmd, args, {
			...(opts.cwd ? { cwd: opts.cwd } : {}),
			env: { ...process.env, GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS.join(":"), GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "" },
			stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		p.stdout?.on("data", (d) => {
			stdout += d;
		});
		p.stderr?.on("data", (d) => {
			stderr += d;
		});
		if (opts.stdin && p.stdin) opts.stdin.pipe(p.stdin);
		p.on("error", fail);
		p.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
	});
}

async function git(args: string[]): Promise<string> {
	const r = await run("git", args);
	if (r.code !== 0) throw new Error(`git ${args.find((a) => !a.startsWith("-") && !a.includes("/")) ?? ""} failed: ${(r.stderr || r.stdout).trim()}`);
	return (r.stdout + r.stderr).trim();
}

export function validateExpId(expId: string): void {
	if (!EXP_ID.test(expId)) throw new Error(`invalid experiment id "${expId}"`);
}

/** A remote is an https, ssh, git or file URL, an scp-like address or a local path. Option-like values and command transports are refused. */
export function validateRemote(url: string): void {
	const u = url.trim();
	if (!u) throw new Error("remote URL is empty");
	if (u.startsWith("-")) throw new Error("remote URL must not start with '-'");
	if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(u)) throw new Error("remote helpers such as ext:: and fd:: are not allowed");
	if (/[\s\0]/.test(u)) throw new Error("remote URL must not contain whitespace");
	const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(u)?.[1]?.toLowerCase();
	if (scheme && !ALLOWED_PROTOCOLS.includes(scheme)) throw new Error(`protocol ${scheme}:// is not allowed: ${ALLOWED_PROTOCOLS.join(", ")} or a local path`);
}

export async function validateBranch(branch: string): Promise<void> {
	if (!branch || branch.startsWith("-") || (await run("git", ["check-ref-format", "--branch", branch])).code !== 0) throw new Error(`invalid branch name "${branch}"`);
}

/** `best` is the kept commit of the most recently finished night in the results directory; any other value is an experiment id. */
export function resolveExpId(resultsDir: string, expId: string): string {
	if (expId !== "best") return expId;
	const nights = join(resultsDir, "nights");
	const done = existsSync(nights)
		? readdirSync(nights)
				.map((n) => readJson<DoneJson>(join(nights, n, "done.json")))
				.filter((d): d is DoneJson => d !== null)
				.sort((a, b) => (a.finished_at ?? "").localeCompare(b.finished_at ?? ""))
		: [];
	const best = done.at(-1)?.kept?.exp_id;
	if (!best) throw new Error(`no finished night under ${resultsDir}: pass an experiment id instead of "best"`);
	return best;
}

export async function exportExperiment(gitDir: string, expId: string, target: ExportTarget): Promise<ExportResult> {
	validateExpId(expId);
	const ref = `refs/exp/${expId}`;
	const sha = await git(["--git-dir", gitDir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).catch(() => {
		throw new Error(`experiment ${expId} has no commit in ${gitDir}`);
	});

	if (target.kind === "remote") {
		validateRemote(target.url);
		const url = target.url.trim();
		const branch = target.branch?.trim() || `codeclimb/${expId}`;
		await validateBranch(branch);
		// Never forced: a branch holding other history rejects the push, which is the safe outcome. `--` ends the options.
		const log = await git(["--git-dir", gitDir, "push", "--porcelain", "--", url, `${sha}:refs/heads/${branch}`]);
		return { expId, sha, destination: url, branch, log };
	}

	if (!target.path.trim()) throw new Error("directory path is empty");
	const dir = resolve(target.path.trim());
	const nonEmpty = existsSync(dir) && readdirSync(dir).length > 0;

	if (target.withHistory) {
		if (nonEmpty) throw new Error(`${dir} is not empty: git history needs an empty or new folder`);
		const branch = `codeclimb/${expId}`;
		mkdirSync(dir, { recursive: true });
		await git(["init", "-q", "--", dir]);
		// Only this experiment's lineage (the starter, the kept commits, this one), not every experiment in the repository.
		await git(["-C", dir, "fetch", "-q", "--no-tags", "--", gitDir, `${ref}:refs/heads/${branch}`]);
		await git(["-C", dir, "checkout", "-q", branch]);
		return { expId, sha, destination: dir, branch, log: `initialized ${dir} on branch ${branch} at ${sha.slice(0, 7)}` };
	}

	if (nonEmpty && !target.force) throw new Error(`${dir} is not empty: pass --force to write into it`);
	mkdirSync(dir, { recursive: true });
	const archive = spawn("git", ["--git-dir", gitDir, "archive", "--format=tar", sha], { stdio: ["ignore", "pipe", "pipe"] });
	let archiveErr = "";
	archive.stderr.on("data", (d) => {
		archiveErr += d;
	});
	const archiveCode = new Promise<number>((r) => archive.on("close", (c) => r(c ?? 1)));
	const untar = await run("tar", ["-x", "-f", "-", "-C", dir], { stdin: archive.stdout });
	if ((await archiveCode) !== 0 || untar.code !== 0) throw new Error(`export failed: ${(archiveErr || untar.stderr).trim()}`);
	const files = (await git(["--git-dir", gitDir, "ls-tree", "-r", "--name-only", sha])).split("\n").filter(Boolean);
	return { expId, sha, destination: dir, log: `wrote ${files.length} files from ${sha.slice(0, 7)} to ${dir}` };
}
