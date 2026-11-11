// `run-night`: start, stop, resume or continue a night through the Agent Server, and follow it (spec: CLI).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type NightConfig, loadNightConfig } from "../config.ts";
import { nightThreads, serverUrl, startNight, stopNight } from "../control.ts";
import { loadEnvFile } from "../env.ts";
import { defaultNightId, isValidNightId } from "../ids.ts";
import { findNightDir, type NightPaths, nightPaths, readJson } from "../night/files.ts";
import { type NightInput, serverRoot } from "../night/types.ts";

const FOLLOW_MS = 5_000;

const cwd = process.cwd();
loadEnvFile(cwd);
const root = serverRoot();
if (root !== cwd) loadEnvFile(root);

function die(message: string): never {
	console.error(`run-night: ${message}`);
	process.exit(2);
}

interface Row {
	night_id?: string;
	round: number;
	kind?: string;
	split: string;
	exp_id: string;
	metrics: Record<string, number>;
	decision: string;
	coder_usd: number;
	dev_usd?: number;
	program_usd: number;
	reviewer_usd: number;
	hypothesis: string | null;
}

/** Print the night's new rows every 5 s until `done.json` or `stop.json` appears. Ctrl-C detaches. */
async function follow(paths: NightPaths, nightId: string, primary: string): Promise<never> {
	const results = paths.results;
	let seen = 0;
	let pauseShown = false;
	process.on("SIGINT", () => {
		console.log(`\ndetached; night ${nightId} keeps running`);
		process.exit(0);
	});
	for (;;) {
		if (existsSync(results)) {
			const rows: Row[] = [];
			for (const line of readFileSync(results, "utf8").split("\n")) {
				try {
					const row = JSON.parse(line) as Row;
					if (row.night_id === nightId) rows.push(row);
				} catch {} // empty, or half appended: read again next poll
			}
			for (const r of rows.slice(seen)) {
				const spend = r.coder_usd + (r.dev_usd ?? 0) + r.program_usd + r.reviewer_usd;
				const value = r.metrics[primary];
				console.log(`r${r.round} ${r.kind ?? "experiment"} ${r.split} ${r.exp_id.slice(nightId.length + 1)} ${primary}=${value ?? "-"} ${r.decision} $${spend.toFixed(4)} ${(r.hypothesis ?? "").slice(0, 100)}`);
			}
			seen = Math.max(seen, rows.length);
		}
		const done = readJson(paths.doneJson);
		if (done) {
			console.log("done");
			console.log(JSON.stringify(done, null, 2));
			process.exit(0);
		}
		const stopped = readJson(paths.stopJson);
		if (stopped) {
			console.log("stopped");
			console.log(JSON.stringify(stopped, null, 2));
			process.exit(0);
		}
		const pause = readJson<{ round: number; stops: { where: string }[] }>(paths.pauseJson);
		if (pause && !pauseShown) {
			console.log(`paused in round ${pause.round} (${pause.stops.map((s) => s.where).join("; ")}); resume with: npm run run-night -- resume --night ${nightId}`);
		}
		pauseShown = pause !== null;
		await new Promise((r) => setTimeout(r, FOLLOW_MS));
	}
}

async function start(argv: string[]): Promise<void> {
	const { values } = parseArgs({
		args: argv,
		options: {
			config: { type: "string" },
			"night-id": { type: "string" },
			sandbox: { type: "string" },
			seed: { type: "string" },
			rounds: { type: "string" },
			"no-wait": { type: "boolean", default: false },
			mock: { type: "boolean", default: false },
			"mock-offline": { type: "string" },
		},
	});
	if (!values.config) die("--config <yaml> is required");
	if (values["mock-offline"] !== undefined && !values.mock) die("--mock-offline only with --mock");
	if (values.sandbox !== undefined && values.sandbox !== "docker") console.log(`note: --sandbox ${values.sandbox} is read as docker on this stack`);
	if (values.seed !== undefined) die("--seed is not built yet");
	const nightId = values["night-id"] ?? defaultNightId(new Date());
	if (!isValidNightId(nightId)) die(`night id \`${nightId}\` must be 1 to 48 letters, digits or hyphens, not starting with a hyphen`);
	let config: NightConfig;
	try {
		config = loadNightConfig(values.config, { cwd, root, mock: values.mock });
	} catch (error) {
		die((error as Error).message);
	}
	if (values.rounds !== undefined) {
		const n = Number(values.rounds);
		if (!Number.isInteger(n) || n < 1) die("--rounds must be an integer ≥ 1");
		config.max_rounds = n;
	}
	const input: NightInput = { night_id: nightId, config, mock: values.mock };
	if (values["mock-offline"] !== undefined) {
		const n = Number(values["mock-offline"]);
		if (!Number.isInteger(n) || n < 1) die("--mock-offline must be an integer ≥ 1");
		input.mock_offline = n;
	}
	const paths = nightPaths(root, config.results_path, nightId);
	if (existsSync(paths.nightDir) && (await nightThreads(nightId)).length === 0) die(`night id ${nightId} was used before (${paths.nightDir}): pick another`);
	let result: Awaited<ReturnType<typeof startNight>>;
	try {
		result = await startNight(input);
	} catch (error) {
		die(`cannot start the night on the Agent Server at ${serverUrl()} (is \`npm run server\` running?): ${(error as Error).message}`);
	}
	if (result.started) console.log(`started night ${nightId} (thread ${result.threadId}); results: ${paths.resultsDir}`);
	else console.log(`note: night ${nightId} already has a thread (${result.threadId}): nothing started; following the running night`);
	if (values["no-wait"]) return;
	await follow(paths, nightId, config.primary_metric);
}

async function stop(argv: string[]): Promise<void> {
	const { values } = parseArgs({ args: argv, options: { night: { type: "string" } } });
	if (!values.night) die("--night <id> is required");
	const dir = findNightDir(root, values.night);
	// A night still in init has no night.json yet: its cancel path writes stop.json itself.
	if (!dir && (await nightThreads(values.night)).length === 0) die(`night ${values.night} not found under ${join(root, "runs")} nor on the Agent Server`);
	await stopNight(root, values.night, "manual", dir);
	console.log("stopped");
	const stopJson = dir ? readJson(join(dir, "stop.json")) : null;
	if (stopJson) console.log(JSON.stringify(stopJson, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === "stop") await stop(rest);
else if (command === "resume" || command === "continue") die(`${command} is not built yet`);
else await start(process.argv.slice(2));
