// lessons: a scenario's lessons.md across nights, by hand (spec: Lessons across nights).
//   npm run lessons -- distill --config <yaml> --night ID [--apply]   propose from one night (a model call; a mock night's is free)
//   npm run lessons -- apply --config <yaml> --night ID               the night's newest proposal into the scenario's lessons.md
//   npm run lessons -- format --config <yaml> [--check]               lessons.md in its one layout, after a hand edit
import { readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { parseArgs } from "node:util";
import { type NightConfig, loadNightConfig, RUNS_DIR } from "../config.ts";
import { loadEnvFile } from "../env.ts";
import { applyProposal, lessonsFile, parseLessons, proposalsOf, proposeLessons, serializeLessons, writeProposal } from "../lessons.ts";
import { findNightDir } from "../night/files.ts";
import { scanText } from "../night/scan.ts";
import { serverRoot } from "../night/types.ts";

const cwd = process.cwd();
loadEnvFile(cwd);
const root = serverRoot();
if (root !== cwd) loadEnvFile(root);

function die(message: string): never {
	console.error(`lessons: ${message}`);
	process.exit(2);
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { config: { type: "string" }, night: { type: "string" }, apply: { type: "boolean", default: false }, check: { type: "boolean", default: false } },
});
const command = positionals[0];
if (!values.config) die("usage: lessons distill|apply|format --config <yaml> [--night ID]");
const configFile = values.config;
const load = (mock: boolean): NightConfig => {
	try {
		return loadNightConfig(configFile, { cwd, root, mock });
	} catch (error) {
		die((error as Error).message);
	}
};

if (command === "format") {
	const cfg = load(false);
	if (!cfg.scenario_spec.lessons) die(`scenario ${cfg.scenario_spec.name} declares no lessons`);
	const file = lessonsFile(root, cfg);
	const text = readFileSync(file, "utf8");
	let formatted: string;
	try {
		formatted = serializeLessons(parseLessons(text));
	} catch (error) {
		die((error as Error).message);
	}
	if (values.check) {
		console.log(formatted === text ? `${file} is in layout` : `${file} is out of layout: run format without --check`);
		process.exit(formatted === text ? 0 : 1);
	}
	writeFileSync(file, formatted);
	console.log(`wrote ${file}`);
} else if (command === "distill" || command === "apply") {
	const nightId = values.night;
	if (!nightId) die(`${command} needs --night <id>`);
	const dir = findNightDir(root, nightId);
	if (!dir) die(`night ${nightId} not found under ${join(root, RUNS_DIR)}`);
	// A mock night lives under runs-langchain/mock/: its folder says which config paths apply.
	const cfg = load(dir.includes(`${sep}${RUNS_DIR}${sep}mock${sep}`));
	if (!cfg.scenario_spec.lessons) die(`scenario ${cfg.scenario_spec.name} declares no lessons`);
	try {
		if (command === "distill") {
			const scan = cfg.scenario_spec.scan;
			const scanner = { scenarioDir: join(root, cfg.scenario), ...(scan ? { scan } : {}) };
			const proposal = await proposeLessons(root, cfg, nightId, (text) => scanText(scanner, text));
			if (!proposal) {
				console.log(`nothing new to distill from ${nightId}`);
				process.exit(0);
			}
			const { dir: out, applied } = writeProposal(root, cfg, proposal, values.apply);
			console.log(`${proposal.ops.length} ops, ${proposal.rejected.length} rejected, $${proposal.usd.toFixed(4)}; ${applied ? "applied" : "proposed"}: ${out}`);
		} else {
			const newest = proposalsOf(root, cfg, nightId).at(-1);
			if (!newest) die(`no proposal for ${nightId}`);
			applyProposal(root, cfg, newest.dir);
			console.log(`applied ${newest.dir} to ${lessonsFile(root, cfg)}`);
		}
	} catch (error) {
		die((error as Error).message);
	}
} else die(`unknown command ${command ?? "(none)"}: distill | apply | format`);
