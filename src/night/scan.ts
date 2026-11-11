// The scenario's `check` and `scan` host commands, and masking: no LangGraph (spec: Scenario contract; Repair; Keep rule).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExperimentRepo } from "../experiments.ts";
import { fillPlaceholders, runHostCommand } from "../hostcmd.ts";

export const HIDDEN = "[hidden]";

/** Replace every found name with `[hidden]`, in any letter case, the longest name first, in one pass. */
export function mask(text: string, found: string[]): string {
	const names = [...new Set(found.filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
	if (!names.length) return text;
	const re = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
	return text.replace(re, HIDDEN);
}

/** Distinct names, case aside: `Acme` and `ACME` are one held-out item. */
export const distinctNames = (found: string[]) => new Set(found.map((n) => n.toLowerCase())).size;

export interface Scanner {
	scenarioDir: string;
	/** The scenario's `scan` command; none → nothing is ever found. */
	scan?: string;
	signal?: AbortSignal;
}

function tempDir<T>(prefix: string, body: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** The held-out names in `text`, as the text has them. Without `scan`, or for empty text, nothing is found. */
export function scanText(s: Scanner, text: string): Promise<string[]> {
	const command = s.scan;
	if (!command || !text.trim()) return Promise.resolve([]);
	return tempDir("cc-scan-", async (dir) => {
		const file = join(dir, "text.txt");
		const report = join(dir, "report.json");
		writeFileSync(file, text);
		await runHostCommand(fillPlaceholders(command, { text: file, report }), { cwd: s.scenarioDir, ...(s.signal ? { signal: s.signal } : {}) });
		const found = (JSON.parse(readFileSync(report, "utf8")) as { found?: unknown }).found;
		if (!Array.isArray(found) || !found.every((f) => typeof f === "string")) throw new Error(`scan report has no list of strings \`found\``);
		return found as string[];
	});
}

/** Scan, then mask what was found. */
export async function maskText(s: Scanner, text: string): Promise<string> {
	return mask(text, await scanText(s, text));
}

export interface CheckReport {
	errors: string[];
	notes: string[];
}

/** Run the scenario's `check` on the commit's files in a temporary checkout. */
export function checkCommit(scenarioDir: string, check: string, repo: ExperimentRepo, sha: string, signal?: AbortSignal): Promise<CheckReport> {
	return tempDir("cc-check-", async (dir) => {
		const tree = join(dir, "repo");
		const report = join(dir, "report.json");
		await repo.exportTree(sha, tree);
		await runHostCommand(fillPlaceholders(check, { repo: tree, report }), { cwd: scenarioDir, ...(signal ? { signal } : {}) });
		const r = JSON.parse(readFileSync(report, "utf8")) as Partial<CheckReport>;
		const list = (v: unknown, what: string) => {
			if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`check report: \`${what}\` must be a list of strings`);
			return v as string[];
		};
		return { errors: list(r.errors, "errors"), notes: list(r.notes, "notes") };
	});
}

/** The lines `sha` adds over `base`, without the diff's own markup. */
export async function addedLines(repo: ExperimentRepo, base: string, sha: string): Promise<string> {
	const diff = await repo.diff(base, sha);
	return diff
		.split("\n")
		.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
		.map((l) => l.slice(1))
		.join("\n");
}
