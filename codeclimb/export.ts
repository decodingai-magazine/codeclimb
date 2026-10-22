// Export one experiment's code out of the night's bare `experiments.git`:
// into a local directory (plain files, or with its git lineage) or as a branch
// pushed to a git remote. Used by `npm run export` and the report server's
// Export button, so every user-supplied value is validated here.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expRef } from "./git";

export type ExportTarget =
  | { kind: "dir"; path: string; withHistory?: boolean; force?: boolean }
  | { kind: "remote"; url: string; branch?: string };

export type ExportResult = { expId: string; sha: string; destination: string; branch?: string; log: string };

/** Transports git may use for a push. Leaves out `ext::` and `fd::`, which run commands. */
const ALLOWED_PROTOCOLS = "file:git:http:https:ssh";
const EXP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Run = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[], opts: { cwd?: string; stdin?: NodeJS.ReadableStream } = {}): Promise<Run> {
  return new Promise((done, fail) => {
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, GIT_ALLOW_PROTOCOL: ALLOWED_PROTOCOLS, GIT_TERMINAL_PROMPT: "0" },
      stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    p.stdout!.on("data", (d) => (stdout += d));
    p.stderr!.on("data", (d) => (stderr += d));
    if (opts.stdin) opts.stdin.pipe(p.stdin!);
    p.on("error", fail);
    p.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

async function git(args: string[], cwd?: string): Promise<string> {
  const r = await run("git", args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args[0] === "--git-dir" ? args[2] : args[0]} failed: ${(r.stderr || r.stdout).trim()}`);
  return (r.stdout + r.stderr).trim();
}

export function validateExpId(expId: string): void {
  if (!EXP_ID.test(expId)) throw new Error(`invalid experiment id "${expId}"`);
}

/** A remote is a URL (http(s), ssh, git) or an scp-like/local path. Option-looking and command transports are refused. */
export function validateRemote(url: string): void {
  const u = url.trim();
  if (!u) throw new Error("remote URL is empty");
  if (u.startsWith("-")) throw new Error("remote URL must not start with '-'");
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(u)) throw new Error("remote helpers like ext:: and fd:: are not allowed");
  if (/[\s\0]/.test(u)) throw new Error("remote URL must not contain whitespace");
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(u)?.[1]?.toLowerCase();
  if (scheme && !ALLOWED_PROTOCOLS.split(":").includes(scheme)) throw new Error(`protocol ${scheme}:// is not allowed`);
}

export async function validateBranch(branch: string): Promise<void> {
  if (!branch || branch.startsWith("-")) throw new Error(`invalid branch name "${branch}"`);
  const r = await run("git", ["check-ref-format", "--branch", branch]);
  if (r.code !== 0) throw new Error(`invalid branch name "${branch}"`);
}

/** `best` resolves to the kept commit of the most recently finished night under `root`. */
export function resolveExpId(root: string, expId: string): string {
  if (expId !== "best") return expId;
  const nightsDir = join(root, "nights");
  const done = existsSync(nightsDir)
    ? readdirSync(nightsDir)
        .map((n) => join(nightsDir, n, "done.json"))
        .filter(existsSync)
        .map((f) => JSON.parse(readFileSync(f, "utf8")) as { kept?: { exp_id?: string }; finished_at?: string })
        .sort((a, b) => (a.finished_at ?? "").localeCompare(b.finished_at ?? ""))
    : [];
  const best = done.at(-1)?.kept?.exp_id;
  if (!best) throw new Error(`no finished night under ${root}: pass an experiment id instead of "best"`);
  return best;
}

export async function exportExperiment(gitDir: string, expId: string, target: ExportTarget): Promise<ExportResult> {
  validateExpId(expId);
  const sha = await git(["--git-dir", gitDir, "rev-parse", "--verify", "--quiet", `${expRef(expId)}^{commit}`]).catch(() => {
    throw new Error(`experiment ${expId} has no commit in ${gitDir}`);
  });

  if (target.kind === "remote") {
    validateRemote(target.url);
    const branch = target.branch?.trim() || `codeclimb/${expId}`;
    await validateBranch(branch);
    // Never --force: a branch that already holds other history rejects the push, which is the safe outcome.
    const log = await git(["--git-dir", gitDir, "push", "--porcelain", target.url.trim(), `${sha}:refs/heads/${branch}`]);
    return { expId, sha, destination: target.url.trim(), branch, log };
  }

  if (!target.path.trim()) throw new Error("directory path is empty");
  const dir = resolve(target.path.trim());
  const nonEmpty = existsSync(dir) && readdirSync(dir).length > 0;

  if (target.withHistory) {
    if (nonEmpty) throw new Error(`${dir} is not empty: git history needs an empty or new directory`);
    const branch = `codeclimb/${expId}`;
    mkdirSync(dir, { recursive: true });
    await git(["init", "-q", dir]);
    // Only this experiment's lineage (starter → kept commits → this one), not every experiment in the bare repo.
    await git(["-C", dir, "fetch", "-q", "--no-tags", gitDir, `${expRef(expId)}:refs/heads/${branch}`]);
    await git(["-C", dir, "checkout", "-q", branch]);
    return { expId, sha, destination: dir, branch, log: `initialized ${dir} on branch ${branch} at ${sha.slice(0, 7)}` };
  }

  if (nonEmpty && !target.force) throw new Error(`${dir} is not empty: pass force to overwrite files in it`);
  mkdirSync(dir, { recursive: true });
  const archive = spawn("git", ["--git-dir", gitDir, "archive", "--format=tar", sha], { stdio: ["ignore", "pipe", "pipe"] });
  let archiveErr = "";
  archive.stderr.on("data", (d) => (archiveErr += d));
  const untar = await run("tar", ["-x", "-f", "-", "-C", dir], { stdin: archive.stdout });
  const archiveCode: number = await new Promise((r) => (archive.exitCode !== null ? r(archive.exitCode) : archive.on("close", (c) => r(c ?? 1))));
  if (archiveCode !== 0 || untar.code !== 0) throw new Error(`export failed: ${(archiveErr || untar.stderr).trim()}`);
  const files = (await git(["--git-dir", gitDir, "ls-tree", "-r", "--name-only", sha])).split("\n").filter(Boolean);
  return { expId, sha, destination: dir, log: `wrote ${files.length} files from ${sha.slice(0, 7)} to ${dir}` };
}
