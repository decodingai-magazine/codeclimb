// The worker API: the nights on this checkout's disk, and the stop, resume, continue and export operations
// (spec: Worker API). Default 127.0.0.1:7421. Off loopback, CODECLIMB_WORKER_TOKEN is required as a bearer on everything.
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isMockResults } from "../config.ts";
import { continueNight, resumeNight, stopNight } from "../control.ts";
import { type ExportTarget, exportExperiment, validateExpId } from "../export.ts";
import { isValidNightId } from "../ids.ts";
import { nightPaths } from "../night/files.ts";
import { listNights, live, type NightEntry, report, summary } from "./nights.ts";

export const API_PORT = 7421;
const LOOPBACK = ["127.0.0.1", "::1", "localhost"];

class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
	res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	let text = "";
	for await (const chunk of req) {
		text += chunk;
		if (text.length > 1_000_000) throw new HttpError(413, "body too large");
	}
	try {
		const v: unknown = text ? JSON.parse(text) : {};
		if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
		return v as Record<string, unknown>;
	} catch {
		throw new HttpError(400, "the body must be a JSON object");
	}
}

const digest = (s: string) => createHash("sha256").update(s).digest();

export interface ApiOptions {
	root: string;
	host?: string;
	port?: number;
	/** Required off loopback. */
	token?: string;
}

export class WorkerApi {
	constructor(private readonly o: ApiOptions & { host: string }) {}

	private authorized(req: IncomingMessage): boolean {
		if (LOOPBACK.includes(this.o.host)) return true;
		const got = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1] ?? "";
		return timingSafeEqual(digest(got), digest(this.o.token ?? ""));
	}

	private find(id: string): NightEntry {
		if (!isValidNightId(id)) throw new HttpError(400, "invalid night id");
		const n = listNights(this.o.root).find((x) => x.id === id);
		if (!n) throw new HttpError(404, `no night ${id}`);
		return n;
	}

	private gitDir(n: NightEntry, expId: string): string {
		try {
			validateExpId(expId);
		} catch (error) {
			throw new HttpError(400, (error as Error).message);
		}
		if (!expId.startsWith(`${n.id}-`)) throw new HttpError(400, "the experiment is not from this night");
		return join(nightPaths(this.o.root, n.night.config.results_path, n.id).resultsDir, "experiments.git");
	}

	private async continue(n: NightEntry, body: Record<string, unknown>) {
		const { direction, rounds } = body;
		if (direction !== undefined && typeof direction !== "string") throw new HttpError(400, "direction must be text");
		if (!(typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 1)) throw new HttpError(400, "rounds must be an integer ≥ 1");
		const cfg = n.night.config;
		const mock = isMockResults(cfg.results_path);
		const r = await continueNight(this.o.root, n.id, cfg, { mock, rounds, ...(direction?.trim() ? { direction } : {}) });
		if ("refused" in r) throw new HttpError(409, r.refused);
		return { night_id: n.id, variation: r.input.variation, thread: r.thread, max_rounds: r.input.config.max_rounds, rescore: r.input.continue?.rescore ?? false };
	}

	/** A download: `repo` (default) a .tar.gz of a git repository on codeclimb/<exp> with the lineage; `source` the tree; `bundle` a git bundle. */
	private async download(n: NightEntry, expId: string, format: string, res: ServerResponse): Promise<void> {
		const gitDir = this.gitDir(n, expId);
		const ref = `refs/exp/${expId}`;
		let tmp: string | null = null;
		let cmd = "git";
		let args: string[];
		let name: string;
		if (format === "bundle") {
			args = ["--git-dir", gitDir, "bundle", "create", "-", ref];
			name = `${expId}.bundle`;
		} else if (format === "source") {
			args = ["--git-dir", gitDir, "archive", "--format=tar.gz", `--prefix=${expId}/`, ref];
			name = `${expId}-source.tar.gz`;
		} else if (format === "repo") {
			tmp = mkdtempSync(join(tmpdir(), "cc-export-"));
			try {
				await exportExperiment(gitDir, expId, { kind: "dir", path: join(tmp, expId), withHistory: true });
			} catch (error) {
				rmSync(tmp, { recursive: true, force: true });
				throw new HttpError(404, (error as Error).message);
			}
			cmd = "tar";
			args = ["-czf", "-", "-C", tmp, expId];
			name = `${expId}.tar.gz`;
		} else throw new HttpError(400, `unknown format "${format}": repo, source or bundle`);
		const dir = tmp;
		await new Promise<void>((done) => {
			const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
			let started = false;
			let err = "";
			p.stderr.on("data", (d) => {
				err += d;
			});
			p.stdout.on("data", (chunk: Buffer) => {
				if (!started) {
					started = true;
					res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"` });
				}
				res.write(chunk);
			});
			p.on("close", (code) => {
				if (dir) rmSync(dir, { recursive: true, force: true });
				if (started) res.end();
				else send(res, code === 0 ? 500 : 404, { error: code === 0 ? "empty export" : `no experiment ${expId}: ${err.trim().split("\n").at(-1)}` });
				done();
			});
		});
	}

	/** Into a folder on the API's machine (always the git-repository form), or pushed to a remote branch. */
	private async exportTo(n: NightEntry, expId: string, body: Record<string, unknown>) {
		const gitDir = this.gitDir(n, expId);
		let target: ExportTarget;
		if (body.kind === "dir" && typeof body.path === "string") target = { kind: "dir", path: body.path.trim().replace(/^~(?=$|\/)/, homedir()), withHistory: true };
		else if (body.kind === "remote" && typeof body.url === "string") target = { kind: "remote", url: body.url, ...(typeof body.branch === "string" ? { branch: body.branch } : {}) };
		else throw new HttpError(400, 'the body must be {kind: "dir", path} or {kind: "remote", url, branch?}');
		try {
			return await exportExperiment(gitDir, expId, target);
		} catch (error) {
			throw new HttpError(400, (error as Error).message);
		}
	}

	async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", "http://worker");
		const path = url.pathname.replace(/\/+$/, "") || "/";
		try {
			if (!this.authorized(req)) throw new HttpError(401, "missing or wrong worker token");
			if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true });
			if (req.method === "GET" && path === "/api/nights") {
				const nights = listNights(this.o.root)
					.map((n) => summary(this.o.root, n))
					.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
				return send(res, 200, { nights });
			}
			const m = /^\/api\/nights\/([^/]+)(?:\/(live|report|stop|resume|continue|export)(?:\/([^/]+))?)?$/.exec(path);
			if (m?.[1]) {
				const n = this.find(decodeURIComponent(m[1]));
				const op = m[2];
				const exp = m[3] ? decodeURIComponent(m[3]) : undefined;
				if (req.method === "GET" && !op) return send(res, 200, summary(this.o.root, n));
				if (req.method === "GET" && op === "live") return send(res, 200, live(this.o.root, n));
				if (req.method === "GET" && op === "report") return send(res, 200, await report(this.o.root, n));
				if (req.method === "POST" && op === "stop") {
					// Writes stop.json at once, then the stop graph.
					await stopNight(this.o.root, n.id, "app", n.dir);
					return send(res, 200, { stopped: n.id });
				}
				if (req.method === "POST" && op === "resume") {
					const r = await resumeNight(this.o.root, n.id);
					if ("refused" in r) throw new HttpError(409, r.refused);
					return send(res, 200, { night_id: n.id, ...r });
				}
				if (req.method === "POST" && op === "continue") return send(res, 200, await this.continue(n, await readBody(req)));
				if (req.method === "GET" && op === "export" && exp) return await this.download(n, exp, url.searchParams.get("format") ?? "repo", res);
				if (req.method === "POST" && op === "export" && exp) return send(res, 200, await this.exportTo(n, exp, await readBody(req)));
			}
			throw new HttpError(404, `no route ${req.method} ${path}`);
		} catch (error) {
			const status = error instanceof HttpError ? error.status : 500;
			if (status === 500) console.error("api:", error);
			if (!res.headersSent) send(res, status, { error: (error as Error).message });
			else res.end();
		}
	}
}

/** Listen; a busy port is a startup error: two APIs would run two watchdogs over the same nights. */
export async function serveApi(o: ApiOptions): Promise<Server> {
	const host = o.host ?? "127.0.0.1";
	const port = o.port ?? API_PORT;
	if (!LOOPBACK.includes(host) && !o.token) throw new Error(`the worker API on ${host} needs CODECLIMB_WORKER_TOKEN`);
	const api = new WorkerApi({ ...o, host });
	const server = createServer((req, res) => void api.handle(req, res));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return server;
}
