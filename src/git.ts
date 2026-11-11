// Host git, isolated from the user's own git config: no global or system config, no signing, no global excludes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const CODECLIMB_IDENT = { name: "codeclimb", email: "codeclimb@localhost" } as const;

const ISOLATION = ["-c", "core.autocrlf=false", "-c", "core.excludesFile=/dev/null", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "init.defaultBranch=main"];

export interface GitOptions {
	env?: Record<string, string>;
	cwd?: string;
	signal?: AbortSignal;
}

export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		HOME: process.env.HOME ?? "/tmp",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
		GIT_AUTHOR_NAME: CODECLIMB_IDENT.name,
		GIT_AUTHOR_EMAIL: CODECLIMB_IDENT.email,
		GIT_COMMITTER_NAME: CODECLIMB_IDENT.name,
		GIT_COMMITTER_EMAIL: CODECLIMB_IDENT.email,
		...extra,
	};
}

/** Run git; returns trimmed stdout. Throws with git's stderr on a non-zero exit. */
export async function git(args: string[], opts: GitOptions = {}): Promise<string> {
	try {
		const { stdout } = await run("git", [...ISOLATION, ...args], {
			env: gitEnv(opts.env),
			cwd: opts.cwd,
			maxBuffer: 256 * 1024 * 1024,
			signal: opts.signal,
			timeout: 120_000,
		});
		return stdout.trim();
	} catch (error) {
		const e = error as { stderr?: string; message: string };
		throw new Error(`git ${args.slice(0, 3).join(" ")}: ${(e.stderr || e.message).trim().slice(-2000)}`);
	}
}
