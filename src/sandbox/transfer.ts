// Code moves between the experiment repository and a sandbox as git bundles through file transfer (spec: Sandboxes).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExperimentRepo } from "../experiments.ts";
import type { Sandbox } from "./types.ts";

/** Where the parent's git bundle stays in a sandbox, outside `/repo` and outside `/tmp` (which an evaluator's reset wipes). */
export const PARENT_BUNDLE = "/cc/parent.bundle";

async function check(sb: Sandbox, command: string, what: string): Promise<string> {
	const r = await sb.exec(command, { cwd: "/", timeoutMs: 120_000 });
	if (r.exitCode !== 0) throw new Error(`${what} in ${sb.name} failed (${r.exitCode}): ${(r.stderr || r.stdout).trim().slice(-2000)}`);
	return r.stdout.trim();
}

/** Upload `sha` as a git bundle and check it out as branch `main` of a fresh `/repo`. */
export async function pushCommit(sb: Sandbox, repo: ExperimentRepo, sha: string): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "cc-push-"));
	try {
		const file = join(dir, "parent.bundle");
		await repo.bundle(sha, file);
		await sb.writeFile(PARENT_BUNDLE, readFileSync(file));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	await check(
		sb,
		`rm -rf /repo && git init -q -b main /repo && git -C /repo fetch -q ${PARENT_BUNDLE} 'refs/*:refs/cc-parent/*' && git -C /repo reset -q --hard ${sha} && git -C /repo for-each-ref --format='%(refname)' refs/cc-parent | xargs -r -n1 git -C /repo update-ref -d`,
		"clone of the parent commit",
	);
}

/** Bundle branch `main` of the sandbox's `/repo`, download it and import it as refs/exp/<id>. Returns the commit. */
export async function pullCommit(sb: Sandbox, repo: ExperimentRepo, id: string): Promise<string> {
	const inBox = "/cc/out.bundle";
	await check(sb, `mkdir -p /cc && git -C /repo bundle create -q ${inBox} main`, "git bundle");
	const dir = mkdtempSync(join(tmpdir(), "cc-pull-"));
	try {
		const file = join(dir, "out.bundle");
		writeFileSync(file, await sb.readFile(inBox));
		return await repo.importBundle(file, id);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
