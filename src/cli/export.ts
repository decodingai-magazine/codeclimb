// export: one experiment's code out of a results directory's experiments.git (spec: Export).
//   npm run export -- --config configs/datenorm-smoke.yaml [--exp best] --to-dir ../solution [--force]
//   npm run export -- --results runs/datenorm-smoke/results.jsonl --exp <exp id> --to-dir out --with-history
//   npm run export -- --config configs/datenorm-smoke.yaml --to-remote git@github.com:you/repo.git [--branch main]
// `--exp best`, the default, is the kept commit of the most recently finished night.
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadNightConfig } from "../config.ts";
import { exportExperiment, resolveExpId } from "../export.ts";
import { serverRoot } from "../night/types.ts";

const USAGE = "usage: export (--config <yaml> | --results <jsonl>) [--exp <id>|best] (--to-dir <path> [--with-history] [--force] | --to-remote <url> [--branch <name>])";
function die(message: string): never {
	console.error(`export: ${message}`);
	process.exit(2);
}

const { values } = parseArgs({
	options: {
		config: { type: "string" },
		results: { type: "string" },
		exp: { type: "string", default: "best" },
		"to-dir": { type: "string" },
		"to-remote": { type: "string" },
		branch: { type: "string" },
		"with-history": { type: "boolean", default: false },
		force: { type: "boolean", default: false },
	},
});
const cwd = process.cwd();
const root = serverRoot();
let results: string | undefined;
try {
	results = values.results ? resolve(values.results) : values.config ? join(root, loadNightConfig(values.config, { cwd, root, mock: false }).results_path) : undefined;
} catch (error) {
	die((error as Error).message);
}
const toDir = values["to-dir"];
const toRemote = values["to-remote"];
if (!results || (toDir === undefined) === (toRemote === undefined)) die(USAGE);
const resultsDir = dirname(results);
try {
	const expId = resolveExpId(resultsDir, values.exp);
	const r = await exportExperiment(
		join(resultsDir, "experiments.git"),
		expId,
		toDir !== undefined
			? { kind: "dir", path: toDir, withHistory: values["with-history"], force: values.force }
			: { kind: "remote", url: toRemote ?? "", ...(values.branch ? { branch: values.branch } : {}) },
	);
	console.log(`${r.expId} (${r.sha.slice(0, 7)}) → ${r.destination}${r.branch ? ` on branch ${r.branch}` : ""}\n${r.log}`);
} catch (error) {
	die((error as Error).message);
}
