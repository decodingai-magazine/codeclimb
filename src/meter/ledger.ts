// Ledgers, refusals and the replay cache of the metering proxy: no I/O (spec: Metering proxy).
import { createHash, randomBytes } from "node:crypto";

export const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** A coder's repeat within this window of its last answer is a retry: it goes upstream. */
export const CODER_RETRY_MS = 5_000;

export type CallKind = "chat" | "embeddings" | "decisions" | "rerank";

export interface MeterRow {
	kind: CallKind;
	model: string;
	op: string;
	ok: boolean;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	ms: number;
	error?: string;
	finish_reason?: string;
	reasoning_tokens?: number;
	replayed_usd?: number;
	rejected?: number;
}

export interface CreditStop {
	who: "program";
	model: string;
	message: string;
}

export interface LedgerOptions {
	/** The evaluation id, or `<exp>-dev` for the coder's dev ledger. */
	id: string;
	allowedModels: string[];
	capUsd: number;
	/** The coder's ledger replays its own calls too (outside the retry window). */
	coder?: boolean;
	/** The A/A run neither reads nor writes the cache. */
	noCache?: boolean;
	onCreditStop?: (stop: CreditStop) => void;
	/** Canned answers at zero cost. */
	mock?: boolean;
	/** Spend that carries over from an earlier token of the same ledger (a new Pi attempt). */
	spentUsd?: number;
}

export class Ledger {
	readonly token = randomBytes(24).toString("hex");
	readonly rows: MeterRow[] = [];
	op = "program";
	spentUsd: number;
	creditStopped = false;
	closed = false;
	readonly inflight = new Set<AbortController>();
	constructor(readonly o: LedgerOptions) {
		this.spentUsd = o.spentUsd ?? 0;
	}
	record(row: MeterRow): void {
		this.rows.push(row);
		this.spentUsd += row.cost_usd;
	}
}

export interface Refusal {
	status: number;
	type: "authentication_error" | "permission_error" | "insufficient_quota" | "invalid_request_error" | "api_error";
	message: string;
}

/** The refusal of a request, in the spec's order: 401, 413, 403, 402 credit stop, 402 cap spent, 400; null when it may go upstream. */
export function refusal(ledger: Ledger | undefined, bodyBytes: number, model: string | undefined, unsupported: string | null): Refusal | null {
	if (!ledger || ledger.closed) return { status: 401, type: "authentication_error", message: "bad or revoked token" };
	if (bodyBytes > MAX_BODY_BYTES) return { status: 413, type: "invalid_request_error", message: `request body over ${MAX_BODY_BYTES} bytes` };
	if (model !== undefined && !ledger.o.allowedModels.includes(model)) return { status: 403, type: "permission_error", message: `model ${model} is not in allowed_models` };
	if (ledger.creditStopped) return { status: 402, type: "insufficient_quota", message: "the provider is out of credits" };
	if (ledger.spentUsd >= ledger.o.capUsd) return { status: 402, type: "insufficient_quota", message: `the budget of $${ledger.o.capUsd} is spent` };
	if (unsupported) return { status: 400, type: "invalid_request_error", message: unsupported };
	return null;
}

export interface CacheEntry {
	/** The answer body sent back. */
	body: unknown;
	row: MeterRow;
	/** The ledger id that made the call. */
	ledgerId: string;
	at: number;
}

/** One night's cache at a time: a new night's first token clears it. */
export class ReplayCache {
	private night: string | null = null;
	private readonly entries = new Map<string, CacheEntry>();

	static key(kind: CallKind, model: string, request: unknown): string {
		return createHash("sha256").update(JSON.stringify([kind, model, request])).digest("hex");
	}

	forNight(night: string): void {
		if (this.night !== night) {
			this.entries.clear();
			this.night = night;
		}
	}

	/** A cached answer this ledger may replay: another evaluation's, or the coder's own outside the retry window. */
	lookup(ledger: Ledger, key: string, now = Date.now()): CacheEntry | null {
		if (ledger.o.noCache) return null;
		const e = this.entries.get(key);
		if (!e) return null;
		if (e.ledgerId === ledger.o.id && !(ledger.o.coder && now - e.at > CODER_RETRY_MS)) return null;
		return e;
	}

	/** Store a successful call; not one cut off by max_tokens, and nothing from the A/A run. */
	store(ledger: Ledger, key: string, body: unknown, row: MeterRow, now = Date.now()): void {
		if (ledger.o.noCache || !row.ok || row.finish_reason === "length") return;
		this.entries.set(key, { body, row, ledgerId: ledger.o.id, at: now });
	}

	/** A replayed call's answer time refreshes the coder's retry window. */
	touch(key: string, now = Date.now()): void {
		const e = this.entries.get(key);
		if (e) e.at = now;
	}
}
