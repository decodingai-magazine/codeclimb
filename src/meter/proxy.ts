// The metering proxy: an HTTP server in the Agent Server process, the only way a program reaches a model (spec: Metering proxy).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { platform } from "node:os";
import { docker } from "../sandbox/docker.ts";
import { callUpstream, unsupported } from "./backends.ts";
import { type CallKind, Ledger, type LedgerOptions, MAX_BODY_BYTES, type MeterRow, ReplayCache, refusal } from "./ledger.ts";

const ROUTES: Record<string, CallKind | "_op"> = {
	"/v1/chat/completions": "chat",
	"/v1/embeddings": "embeddings",
	"/v1/decisions": "decisions",
	"/v1/rerank": "rerank",
	"/v1/_op": "_op",
};
const OP = /^[a-z][a-z0-9_]*$/;

const ledgers = new Map<string, Ledger>();
const cache = new ReplayCache();
let started: Promise<number> | undefined;
let server: Server | undefined;

/** Open a ledger: a random bearer token for one evaluation or one coder attempt. A new night's first token clears the cache. */
export function openLedger(night: string, o: LedgerOptions): Ledger {
	cache.forNight(night);
	const l = new Ledger(o);
	ledgers.set(l.token, l);
	return l;
}

/** Close: revoke the token, abort calls in flight, return the calls. */
export function closeLedger(l: Ledger): MeterRow[] {
	l.closed = true;
	ledgers.delete(l.token);
	for (const ac of l.inflight) ac.abort(new Error("ledger closed"));
	return l.rows;
}

async function bindHost(): Promise<string> {
	if (process.env.CODECLIMB_PROXY_HOST) return process.env.CODECLIMB_PROXY_HOST;
	if (platform() !== "linux") return "127.0.0.1";
	// On Linux a loopback bind is unreachable from the relay: bind the Docker bridge's gateway.
	const r = await docker(["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]);
	const gw = r.stdout.toString().trim();
	return r.code === 0 && gw ? gw : "127.0.0.1";
}

/** Start the listener on first use; returns its port. */
export function proxyPort(): Promise<number> {
	started ??= (async () => {
		const host = await bindHost();
		const port = Number(process.env.CODECLIMB_PROXY_PORT ?? 0);
		server = createServer((req, res) => void handle(req, res));
		await new Promise<void>((resolve, reject) => {
			server?.once("error", reject);
			server?.listen(port, host, () => resolve());
		});
		return (server.address() as AddressInfo).port;
	})();
	return started;
}

function send(res: ServerResponse, status: number, body: unknown): void {
	const text = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
	res.end(text);
}

async function readBody(req: IncomingMessage): Promise<{ bytes: number; text: string }> {
	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const c of req) {
		bytes += (c as Buffer).length;
		if (bytes <= MAX_BODY_BYTES) chunks.push(c as Buffer);
	}
	return { bytes, text: Buffer.concat(chunks).toString("utf8") };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
	const route = ROUTES[(req.url ?? "").split("?")[0] as string];
	if (req.method !== "POST" || !route) return send(res, 404, { error: { message: "not found", type: "invalid_request_error" } });
	const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
	const ledger = ledgers.get(token);
	const { bytes, text } = await readBody(req);
	let body: Record<string, unknown> = {};
	try {
		const v: unknown = text ? JSON.parse(text) : {};
		if (typeof v === "object" && v !== null && !Array.isArray(v)) body = v as Record<string, unknown>;
	} catch {
		// an unparsable body is an unsupported request below
	}
	if (route === "_op") {
		if (!ledger || ledger.closed) return send(res, 401, { error: { message: "bad or revoked token", type: "authentication_error" } });
		if (typeof body.op !== "string" || !OP.test(body.op)) return send(res, 400, { error: { message: "`op` must match ^[a-z][a-z0-9_]*$", type: "invalid_request_error" } });
		ledger.op = body.op;
		return send(res, 200, { op: body.op });
	}
	const kind = route;
	const model = typeof body.model === "string" ? body.model : undefined;
	const bad = text && Object.keys(body).length === 0 ? "the body must be a JSON object" : unsupported(kind, body);
	const refused = refusal(ledger, bytes, model, bad);
	if (refused) {
		if (ledger && !ledger.closed) ledger.record({ kind, model: model ?? "", op: ledger.op, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0, error: refused.message, rejected: refused.status });
		return send(res, refused.status, { error: { message: refused.message, type: refused.type } });
	}
	const l = ledger as Ledger;
	const t0 = Date.now();
	const key = ReplayCache.key(kind, model as string, body);
	const hit = cache.lookup(l, key);
	if (hit) {
		await new Promise((r) => setTimeout(r, hit.row.ms));
		cache.touch(key);
		l.record({ ...hit.row, op: l.op, cost_usd: 0, replayed_usd: hit.row.cost_usd + (hit.row.replayed_usd ?? 0), ms: Date.now() - t0 });
		return send(res, 200, hit.body);
	}
	const ac = new AbortController();
	l.inflight.add(ac);
	try {
		const up = await callUpstream(kind, body, l.o.mock === true, ac.signal);
		const row: MeterRow = {
			kind,
			model: model as string,
			op: l.op,
			ok: up.ok,
			input_tokens: up.input_tokens,
			output_tokens: up.output_tokens,
			cost_usd: up.cost_usd,
			ms: Date.now() - t0,
			...(up.error ? { error: up.error } : {}),
			...(up.finish_reason ? { finish_reason: up.finish_reason } : {}),
			...(up.reasoning_tokens !== undefined ? { reasoning_tokens: up.reasoning_tokens } : {}),
		};
		l.record(row);
		if (up.credit) {
			l.creditStopped = true;
			l.o.onCreditStop?.({ who: "program", model: model as string, message: up.error ?? "out of credits" });
		}
		if (!up.ok) return send(res, 502, { error: { message: up.error ?? "upstream failure", type: "api_error" } });
		cache.store(l, key, up.body, row);
		return send(res, 200, up.body);
	} finally {
		l.inflight.delete(ac);
	}
}
