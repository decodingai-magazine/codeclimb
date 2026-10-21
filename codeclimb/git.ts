// The host experiment repo: a local bare repo, no remote, no branches. One
// commit per experiment, each pinned by `refs/exp/<exp_id>` so gc keeps it.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepoCommit } from "./sandbox/types";

const pexec = promisify(execFile);

// Fixed identity and date: the same starter tree always yields the same SHA.
const FIXED_ENV = {
  GIT_AUTHOR_NAME: "codeclimb",
  GIT_AUTHOR_EMAIL: "codeclimb@localhost",
  GIT_COMMITTER_NAME: "codeclimb",
  GIT_COMMITTER_EMAIL: "codeclimb@localhost",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export const expRef = (expId: string) => `refs/exp/${expId}`;

export class ExperimentRepo {
  constructor(readonly gitDir: string) {}

  private async git(args: string[], env: Record<string, string> = {}): Promise<string> {
    const { stdout } = await pexec("git", ["--git-dir", this.gitDir, ...args], {
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.trim();
  }

  async ensure(): Promise<void> {
    if (!existsSync(join(this.gitDir, "HEAD"))) {
      await pexec("git", ["init", "--bare", "-q", this.gitDir]);
    }
  }

  /** Commit a directory (the scenario's starter repo, possibly missing) as the round-0 commit. */
  async importDir(dir: string | null, expId: string): Promise<string> {
    const tmp = await mkdtemp(join(tmpdir(), "cc-index-"));
    try {
      const env = { ...FIXED_ENV, GIT_INDEX_FILE: join(tmp, "index") };
      let tree: string;
      if (dir && existsSync(dir)) {
        await this.git(["--work-tree", dir, "add", "-A", "."], env);
        tree = await this.git(["write-tree"], env);
      } else {
        tree = await this.git(["hash-object", "-t", "tree", "-w", "/dev/null"], env); // empty tree
      }
      const sha = await this.git(["commit-tree", tree, "-m", "starter"], env);
      await this.git(["update-ref", expRef(expId), sha]);
      return sha;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async bundle(expId: string): Promise<RepoCommit> {
    const tmp = await mkdtemp(join(tmpdir(), "cc-bundle-"));
    try {
      const file = join(tmp, "b.bundle");
      await this.git(["bundle", "create", "-q", file, expRef(expId)]);
      return { bundle: await readFile(file), ref: expRef(expId) };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /** Import an experiment bundle (branch `main`) as `refs/exp/<expId>`. */
  async importBundle(bundle: Buffer, expId: string): Promise<string> {
    const tmp = await mkdtemp(join(tmpdir(), "cc-bundle-"));
    try {
      const file = join(tmp, "out.bundle");
      await writeFile(file, bundle);
      await this.git(["fetch", "-q", "--force", file, `main:${expRef(expId)}`]);
      return await this.git(["rev-parse", expRef(expId)]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async sha(expId: string): Promise<string> {
    return this.git(["rev-parse", expRef(expId)]);
  }

  /** Unified diff parent → experiment, truncated for the reviewer prompt. */
  async diff(parentExpId: string, expId: string, maxChars = 12_000): Promise<string> {
    const d = await this.git(["diff", "--stat", "-p", expRef(parentExpId), expRef(expId)]);
    return d.length > maxChars ? `${d.slice(0, maxChars)}\n... [diff truncated, ${d.length} chars]` : d;
  }
}
