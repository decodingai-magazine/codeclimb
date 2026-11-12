// server: the Agent Server through `langgraphjs up`, with its own Postgres and Redis (spec: Deployment and environment).
//   npm run server         build the image, start or recreate the stack, wait until /ok answers
//   npm run server:logs    follow the server container's logs
//   npm run server:stop    stop the stack; Postgres keeps every thread (no -v)
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { METER_NETWORK } from "../meter/relay.ts";

const PORT = 8123;
const READY_DEADLINE_MS = 5 * 60_000;
const root = realpathSync(process.cwd());

const die = (message: string): never => {
	console.error(`server: ${message}`);
	process.exit(1);
};

// The compose project name `langgraphjs up` gives the stack: the config's folder name and the sha256 of its path, lowercased.
const lower = root.toLocaleLowerCase();
const project = `${basename(lower)}-${createHash("sha256").update(lower).digest("hex")}`;
const container = `${project}-langgraph-api-1`;

function compose(args: string[]): never {
	const r = spawnSync("docker", ["compose", "--project-name", project, ...args], { stdio: "inherit" });
	process.exit(r.status ?? 1);
}

async function healthy(): Promise<boolean> {
	try {
		return (await fetch(`http://127.0.0.1:${PORT}/ok`)).ok;
	} catch {
		return false;
	}
}

async function up(): Promise<void> {
	if (!existsSync(join(root, "langgraph.json"))) die(`run it from the checkout: no langgraph.json in ${root}`);
	if (!existsSync(join(root, ".env"))) die(`no .env in ${root}: copy .env.example (the server needs LANGSMITH_API_KEY to boot)`);
	const realDocker = spawnSync("sh", ["-c", "command -v docker"], { encoding: "utf8" }).stdout.trim();
	if (!realDocker) die("docker is not on PATH");
	const gitDir = spawnSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).stdout.trim();
	if (!gitDir) die(`${root} is not a git checkout`);
	// Pi creates a missing auth.json as `{}`; do the same, or Docker would create a directory in its place.
	const piAuth = resolve(process.env.CODECLIMB_PI_AUTH_PATH ?? join(homedir(), ".pi", "agent", "auth.json"));
	if (!existsSync(piAuth)) {
		mkdirSync(dirname(piAuth), { recursive: true });
		writeFileSync(piAuth, "{}", { mode: 0o600 });
	}
	// An external network must exist before `up`.
	if (spawnSync("docker", ["network", "inspect", METER_NETWORK], { stdio: "ignore" }).status !== 0) {
		const c = spawnSync("docker", ["network", "create", METER_NETWORK], { encoding: "utf8" });
		if (c.status !== 0 && !/already exists/.test(c.stderr)) die(`docker network create ${METER_NETWORK} failed: ${c.stderr.trim()}`);
	}

	const shimDir = join(dirname(fileURLToPath(import.meta.url)), "server-docker");
	const cli = join(root, "node_modules", ".bin", "langgraphjs");
	// `up` swallows a failed build or a container that exits, and its own wait is 10 s: the pass-through records the
	// compose status, and the /ok poll below decides the rest.
	const upStatus = join(mkdtempSync(join(tmpdir(), "codeclimb-server-")), "status");
	const r = spawnSync(cli, ["up", "--port", String(PORT), "--no-pull", "--wait"], {
		cwd: root,
		stdio: "inherit",
		env: {
			...process.env,
			PATH: `${shimDir}:${process.env.PATH ?? ""}`,
			CODECLIMB_REAL_DOCKER: realDocker,
			CODECLIMB_HOST_ROOT: root,
			CODECLIMB_HOST_GIT_DIR: gitDir,
			CODECLIMB_HOST_PI_AUTH: piAuth,
			CODECLIMB_UP_STATUS: upStatus,
		},
	});
	if (r.error) die(`langgraphjs up failed: ${r.error.message}`);
	const status = existsSync(upStatus) ? readFileSync(upStatus, "utf8").trim() : "missing";
	if (status !== "0") die(`docker compose up failed (status ${status}); see the output above`);

	const deadline = Date.now() + READY_DEADLINE_MS;
	while (!(await healthy())) {
		const state = spawnSync("docker", ["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", container], { encoding: "utf8" }).stdout.trim();
		if (state.startsWith("exited") || state.startsWith("dead")) die(`the server container stopped (${state}); see npm run server:logs`);
		if (Date.now() > deadline) die(`no answer on http://127.0.0.1:${PORT}/ok after ${READY_DEADLINE_MS / 60_000} min; see npm run server:logs`);
		await new Promise((r) => setTimeout(r, 1000));
	}
	const ports = spawnSync("docker", ["port", container, "8000"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
	if (ports.length === 0 || ports.some((p) => !p.startsWith("127.0.0.1:"))) {
		spawnSync("docker", ["compose", "--project-name", project, "stop"], { stdio: "inherit" });
		die(`the server's port is published beyond loopback (${ports.join(", ")}); the stack was stopped`);
	}
	// A Mac must not sleep while the server runs: caffeinate lives as long as the server container.
	if (platform() === "darwin") spawn("caffeinate", ["-i", "docker", "wait", container], { detached: true, stdio: "ignore" }).unref();
	console.log(`server: http://127.0.0.1:${PORT} (container ${container}); logs: npm run server:logs; stop: npm run server:stop`);
}

const command = process.argv[2] ?? "up";
if (command === "up") await up();
else if (command === "logs") compose(["logs", "--follow", "langgraph-api"]);
else if (command === "stop") compose(["down"]);
else die(`unknown command ${command}: up, logs or stop`);
