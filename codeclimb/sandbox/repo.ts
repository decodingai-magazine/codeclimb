// Moving code in and out of a sandbox as git bundles: no git credentials and no
// host paths inside sandboxes, one code path for every backend.
import type { RepoCommit, Sandbox } from "./types";

const PARENT_BUNDLE = "/tmp/cc/parent.bundle";
const OUT_BUNDLE = "/tmp/cc/out.bundle";
const GIT = "git -c user.name=codeclimb -c user.email=codeclimb@localhost";

async function run(sandbox: Sandbox, command: string, what: string): Promise<string> {
  const r = await sandbox.exec(command, { cwd: "/", timeoutMs: 120_000 });
  if (r.exitCode !== 0) throw new Error(`${what} failed (${r.exitCode}): ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout.trim();
}

/** Clone `commit` into an empty `/repo`. The parent bundle stays at /tmp/cc for `commitAndExport`. */
export async function cloneInto(sandbox: Sandbox, commit: RepoCommit): Promise<void> {
  await sandbox.writeFile(PARENT_BUNDLE, commit.bundle);
  await run(
    sandbox,
    [
      "mkdir -p /repo && cd /repo",
      `${GIT} init -q -b main`,
      `${GIT} fetch -q ${PARENT_BUNDLE} '${commit.ref}:refs/heads/cc-parent'`,
      `${GIT} reset -q --hard cc-parent`,
      `${GIT} branch -q -D cc-parent`,
    ].join(" && "),
    "clone",
  );
}

/**
 * Commit everything in `/repo` as one commit on the parent, squashing (and
 * ignoring) whatever git history the agent made, then export it as a bundle.
 */
export async function commitAndExport(
  sandbox: Sandbox,
  parentRef: string,
  message: string,
): Promise<{ sha: string; bundle: Buffer }> {
  await sandbox.writeFile("/tmp/cc/msg.txt", message);
  const sha = await run(
    sandbox,
    [
      "cd /repo && rm -rf .git",
      `${GIT} init -q -b main`,
      `${GIT} fetch -q ${PARENT_BUNDLE} '${parentRef}:refs/heads/cc-parent'`,
      `${GIT} reset -q --soft cc-parent`,
      `${GIT} add -A`,
      `${GIT} commit -q --allow-empty -F /tmp/cc/msg.txt`,
      `${GIT} branch -q -D cc-parent`,
      `${GIT} bundle create -q ${OUT_BUNDLE} main`,
      `${GIT} rev-parse HEAD`,
    ].join(" && "),
    "commit",
  );
  return { sha, bundle: await sandbox.readFile(OUT_BUNDLE) };
}
