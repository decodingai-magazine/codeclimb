// api: the worker API and the watchdog, in one process (spec: Worker API; Durable runtime on LangGraph, Watchdog).
//   npm run api   (CODECLIMB_API_HOST, CODECLIMB_API_PORT; CODECLIMB_WORKER_TOKEN off loopback; CODECLIMB_SERVER_URL)
import { serveApi } from "../api/server.ts";
import { startWatchdog } from "../api/watchdog.ts";
import { serverUrl } from "../control.ts";
import { loadEnvFile } from "../env.ts";
import { serverRoot } from "../night/types.ts";

const cwd = process.cwd();
loadEnvFile(cwd);
const root = serverRoot();
if (root !== cwd) loadEnvFile(root);

const host = process.env.CODECLIMB_API_HOST ?? "127.0.0.1";
const port = Number(process.env.CODECLIMB_API_PORT ?? 7421);
try {
	await serveApi({ root, host, port, ...(process.env.CODECLIMB_WORKER_TOKEN ? { token: process.env.CODECLIMB_WORKER_TOKEN } : {}) });
} catch (error) {
	console.error(`api: cannot serve on ${host}:${port}: ${(error as Error).message}`);
	process.exit(1);
}
startWatchdog(root);
console.log(`api: http://${host}:${port}/api (Agent Server ${serverUrl()}; watchdog every 60 s)`);
