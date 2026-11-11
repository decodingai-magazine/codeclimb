// The experiment repository: a bare repo per results directory, one commit per experiment at refs/exp/<id> (spec: Experiment repository).
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git } from "./git.ts";

const STARTER_DATE = "2026-01-01T00:00:00Z";

export class ExperimentRepo {
	private constructor(readonly dir: string) {}

	/** Open the bare repository at `dir`, creating it if missing. */
	static async open(dir: string): Promise<ExperimentRepo> {
		const abs = resolve(dir);
		if (!existsSync(join(abs, "HEAD"))) {
			mkdirSync(abs, { recursive: true });
			await git(["init", "--bare", "--quiet", abs]);
		}
		return new ExperimentRepo(abs);
	}

	private g(args: string[], env?: Record<string, string>) {
		return git(["--git-dir", this.dir, ...args], env ? { env } : {});
	}

	/** Commit `starterDir` (its .gitignore honoured) with a fixed identity and date, pinned at refs/exp/<id>. Same tree → same SHA. */
	async importStarter(starterDir: string, id: string): Promise<string> {
		const work = resolve(starterDir);
		const scratch = mkdtempSync(join(tmpdir(), "cc-index-"));
		try {
			const env = { GIT_INDEX_FILE: join(scratch, "index"), GIT_AUTHOR_DATE: STARTER_DATE, GIT_COMMITTER_DATE: STARTER_DATE };
			await git(["--git-dir", this.dir, "--work-tree", work, "add", "--all", "."], { env, cwd: work });
			const tree = await this.g(["write-tree"], env);
			const sha = await git(["--git-dir", this.dir, "commit-tree", tree, "-m", "starter"], { env });
			await this.g(["update-ref", `refs/exp/${id}`, sha]);
			return sha;
		} finally {
			rmSync(scratch, { recursive: true, force: true });
		}
	}

	/** Point refs/exp/<id> at an existing commit (seed, rescore). */
	async alias(id: string, sha: string): Promise<void> {
		await this.g(["update-ref", `refs/exp/${id}`, sha]);
	}

	/** The commit of an experiment id, or null. */
	async resolve(id: string): Promise<string | null> {
		try {
			return await this.g(["rev-parse", "--verify", "--quiet", `refs/exp/${id}^{commit}`]);
		} catch {
			return null;
		}
	}

	/** The tree id of a commit: `unchanged` compares these. */
	treeOf(sha: string): Promise<string> {
		return this.g(["rev-parse", `${sha}^{tree}`]);
	}

	/** The unified diff from `base` to `sha`. */
	diff(base: string, sha: string): Promise<string> {
		return this.g(["diff", "--no-color", "--no-ext-diff", base, sha]);
	}

	/** Every text file of a commit, as `### <path>` sections (binary files skipped). */
	async source(sha: string): Promise<string> {
		const numstat = await this.g(["diff", "--numstat", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", sha]);
		const text = numstat.split("\n").filter((l) => l && !l.startsWith("-\t-\t")).map((l) => l.split("\t").slice(2).join("\t"));
		const parts: string[] = [];
		for (const path of text) parts.push(`### ${path}\n${await this.g(["show", `${sha}:${path}`])}`);
		return parts.join("\n\n");
	}

	/** Write a git bundle of `sha` (as branch main) to `file`. */
	async bundle(sha: string, file: string): Promise<void> {
		const tmpRef = `refs/cc-bundle/${process.pid}-${Date.now()}`;
		await this.g(["update-ref", tmpRef, sha]);
		try {
			await this.g(["bundle", "create", file, tmpRef]);
		} finally {
			await this.g(["update-ref", "-d", tmpRef]);
		}
	}

	/** Write the files of `sha` to `dir`, through a temporary index (the bare repository's own is untouched). */
	async exportTree(sha: string, dir: string): Promise<void> {
		mkdirSync(dir, { recursive: true });
		const tmp = mkdtempSync(join(tmpdir(), "cc-index-"));
		try {
			const env = { GIT_INDEX_FILE: join(tmp, "index"), GIT_WORK_TREE: resolve(dir) };
			await this.g(["read-tree", sha], env);
			await this.g(["checkout-index", "--all"], env);
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	}

	/** Import the `main` branch of a git bundle file as refs/exp/<id>; returns its SHA. */
	async importBundle(file: string, id: string, ref = "main"): Promise<string> {
		await this.g(["fetch", "--quiet", "--force", file, `${ref}:refs/exp/${id}`]);
		return (await this.resolve(id)) as string;
	}
}
