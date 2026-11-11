// Where a metered call goes: canned answers in mock mode, OpenRouter, or Pi's model runtime (spec: Metering proxy; Mock mode).
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { MOCK_CREDIT_MESSAGE, mockCreditDue, modelRuntime } from "../pi/models.ts";
import { isCreditMessage } from "../night/pause.ts";
import type { CallKind } from "./ledger.ts";

export const OPENROUTER_BASE = "https://openrouter.ai/api";
export const OPENROUTER_TIMEOUT_MS = 5 * 60_000;
/** Embedding prices per million tokens outside OpenRouter. */
export const EMBEDDING_PRICES: Record<string, number> = { "openai/text-embedding-3-small": 0.02, "openai/text-embedding-3-large": 0.13 };

export interface Upstream {
	ok: boolean;
	body: unknown;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
	finish_reason?: string;
	reasoning_tokens?: number;
	error?: string;
	/** HTTP 402 or a credit message from the provider. */
	credit?: boolean;
}

type Body = Record<string, unknown>;


const chatAnswer = (model: string, text: string, finish: string, usage: { prompt_tokens: number; completion_tokens: number }) => ({
	id: `cc-${Date.now()}`,
	object: "chat.completion",
	created: Math.floor(Date.now() / 1000),
	model,
	choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: finish }],
	usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
});

export function mockCall(kind: CallKind, body: Body): Upstream {
	const model = String(body.model);
	const zero = { ok: true, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
	if (mockCreditDue("program")) return { ...zero, ok: false, credit: true, error: MOCK_CREDIT_MESSAGE, body: { error: { message: MOCK_CREDIT_MESSAGE, type: "api_error" } } };
	if (kind === "chat") return { ...zero, finish_reason: "stop", body: chatAnswer(model, "mock", "stop", { prompt_tokens: 0, completion_tokens: 0 }) };
	if (kind === "embeddings") {
		const inputs = Array.isArray(body.input) ? body.input : [body.input];
		return { ...zero, body: { object: "list", model, data: inputs.map((_, index) => ({ object: "embedding", index, embedding: [1, 0, 0, 0] })), usage: { prompt_tokens: 0, total_tokens: 0 } } };
	}
	if (kind === "decisions") return { ...zero, body: { answers: {} } };
	const docs = Array.isArray(body.documents) ? body.documents : [];
	return { ...zero, body: { results: docs.map((_, index) => ({ index, relevance_score: 0 })) } };
}

async function openRouter(kind: CallKind, body: Body, signal: AbortSignal): Promise<Upstream> {
	const key = process.env.OPENROUTER_API_KEY;
	const fail = (error: string, credit = false): Upstream => ({ ok: false, body: { error: { message: error, type: "api_error" } }, input_tokens: 0, output_tokens: 0, cost_usd: 0, error, credit });
	if (!key) return fail("OPENROUTER_API_KEY is not set on the Agent Server");
	const path = kind === "chat" ? "/v1/chat/completions" : kind === "embeddings" ? "/v1/embeddings" : kind === "rerank" ? "/v1/rerank" : "/alpha/decisions";
	const sent = { ...body, model: String(body.model).replace(/^openrouter\//, ""), ...(kind === "chat" ? { usage: { include: true } } : {}) };
	let res: Response;
	try {
		res = await fetch(`${OPENROUTER_BASE}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify(sent),
			signal: AbortSignal.any([signal, AbortSignal.timeout(OPENROUTER_TIMEOUT_MS)]),
		});
	} catch (e) {
		return fail(`openrouter: ${(e as Error).message}`);
	}
	const text = await res.text();
	let json: Body = {};
	try {
		json = JSON.parse(text) as Body;
	} catch {
		return fail(`openrouter ${res.status}: ${text.slice(0, 500)}`, res.status === 402);
	}
	const usage = (json.usage ?? {}) as Body;
	const cost = typeof usage.cost === "number" ? usage.cost : undefined;
	const tokens = { input_tokens: Number(usage.prompt_tokens ?? 0), output_tokens: Number(usage.completion_tokens ?? 0) };
	if (res.status === 402 || !res.ok || json.error) {
		const msg = `openrouter ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 500)}`;
		return { ...fail(msg, res.status === 402 || isCreditMessage(msg)), ...tokens, cost_usd: cost ?? 0 };
	}
	if (cost === undefined) return { ...fail("openrouter reply has no usage cost"), ...tokens };
	let finish: string | undefined;
	if (kind === "chat") {
		const choice = ((json.choices as Body[] | undefined) ?? [])[0] as Body | undefined;
		const message = (choice?.message ?? {}) as Body;
		if (message.content === null) message.content = "";
		finish = typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined;
		if (message.content === "" && choice?.finish_reason == null) finish = "length";
	}
	const reasoning = ((usage.completion_tokens_details ?? {}) as Body).reasoning_tokens;
	return { ok: true, body: json, ...tokens, cost_usd: cost, ...(finish ? { finish_reason: finish } : {}), ...(typeof reasoning === "number" ? { reasoning_tokens: reasoning } : {}) };
}

function piModel(spec: string, models: { getModel(p: string, id: string): Model<Api> | undefined }): Model<Api> | undefined {
	const slash = spec.indexOf("/");
	return slash > 0 ? models.getModel(spec.slice(0, slash), spec.slice(slash + 1)) : undefined;
}

async function piChat(body: Body, signal: AbortSignal): Promise<Upstream> {
	const rt = await modelRuntime();
	const spec = String(body.model);
	const model = piModel(spec, rt);
	const fail = (error: string, credit = false, cost = 0, tokens = { input_tokens: 0, output_tokens: 0 }): Upstream => ({ ok: false, body: { error: { message: error, type: "api_error" } }, ...tokens, cost_usd: cost, error, credit });
	if (!model) return fail(`model ${spec} is not in Pi's model runtime`);
	const msgs = body.messages as { role: string; content: string }[];
	const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
	const messages: Message[] = msgs
		.filter((m) => m.role !== "system")
		.map((m): Message =>
			m.role === "user"
				? { role: "user", content: m.content, timestamp: Date.now() }
				: { role: "assistant", content: [{ type: "text", text: m.content }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() },
		);
	try {
		const reply = await rt.completeSimple(model, { ...(system ? { systemPrompt: system } : {}), messages }, { signal, ...(typeof body.max_tokens === "number" ? { maxTokens: body.max_tokens } : {}) });
		const u = reply.usage;
		const tokens = { input_tokens: u.input + u.cacheRead + u.cacheWrite, output_tokens: u.output };
		if (reply.stopReason === "error" || reply.stopReason === "aborted") {
			const msg = reply.errorMessage ?? reply.stopReason;
			return fail(msg, isCreditMessage(msg), u.cost.total, tokens);
		}
		const text = reply.content.filter((c) => c.type === "text").map((c) => (c as { text: string }).text).join("");
		const finish = reply.stopReason === "length" ? "length" : "stop";
		return { ok: true, body: chatAnswer(spec, text, finish, { prompt_tokens: tokens.input_tokens, completion_tokens: tokens.output_tokens }), ...tokens, cost_usd: u.cost.total, finish_reason: finish, ...(typeof u.reasoning === "number" ? { reasoning_tokens: u.reasoning } : {}) };
	} catch (e) {
		const msg = (e as Error).message;
		return fail(msg, isCreditMessage(msg));
	}
}

async function piEmbeddings(body: Body, signal: AbortSignal): Promise<Upstream> {
	const spec = String(body.model);
	const price = EMBEDDING_PRICES[spec] as number;
	const fail = (error: string, credit = false): Upstream => ({ ok: false, body: { error: { message: error, type: "api_error" } }, input_tokens: 0, output_tokens: 0, cost_usd: 0, error, credit });
	const auth = await (await modelRuntime()).getAuth("openai");
	const key = (auth?.auth as { apiKey?: string } | undefined)?.apiKey ?? process.env.OPENAI_API_KEY;
	if (!key) return fail("no OpenAI key for embeddings");
	try {
		const res = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
			body: JSON.stringify({ ...body, model: spec.replace(/^openai\//, "") }),
			signal,
		});
		const json = (await res.json()) as Body;
		if (!res.ok) return fail(`openai ${res.status}: ${JSON.stringify(json).slice(0, 500)}`, res.status === 402);
		const tokens = Number(((json.usage ?? {}) as Body).prompt_tokens ?? 0);
		return { ok: true, body: json, input_tokens: tokens, output_tokens: 0, cost_usd: (tokens / 1e6) * price };
	} catch (e) {
		return fail((e as Error).message);
	}
}

/** An unsupported request's reason, or null. */
export function unsupported(kind: CallKind, body: Body): string | null {
	const model = String(body.model ?? "");
	if (!model) return "`model` is required";
	const router = model.startsWith("openrouter/");
	if ((kind === "decisions" || kind === "rerank") && !router) return `${kind} exist only on openrouter/ models`;
	if (kind === "embeddings" && !router && !(model in EMBEDDING_PRICES)) return `embeddings outside OpenRouter only for ${Object.keys(EMBEDDING_PRICES).join(", ")}`;
	if (kind === "embeddings" && !(typeof body.input === "string" || (Array.isArray(body.input) && body.input.every((s) => typeof s === "string")))) return "`input` must be a string or a list of strings";
	if (kind === "chat") {
		if (body.stream) return "streaming is not supported";
		if (body.tools || body.tool_choice || body.functions) return "tools are not supported";
		const msgs = body.messages;
		if (!Array.isArray(msgs) || !msgs.length || msgs.some((m) => typeof m !== "object" || m === null || !["system", "user", "assistant"].includes((m as Body).role as string) || typeof (m as Body).content !== "string")) {
			return "only text messages (system, user, assistant) are supported";
		}
	}
	if (kind === "rerank" && (typeof body.query !== "string" || !Array.isArray(body.documents))) return "rerank needs `query` and `documents`";
	return null;
}

/** Forward a call upstream. Only the fields the spec names travel to chat. */
export async function callUpstream(kind: CallKind, body: Body, mock: boolean, signal: AbortSignal): Promise<Upstream> {
	if (mock) return mockCall(kind, body);
	if (String(body.model).startsWith("openrouter/")) {
		const forwarded = kind === "chat" ? pick(body, ["model", "messages", "max_tokens", "temperature", "response_format", "seed", "top_p", "stop", "reasoning"]) : body;
		return openRouter(kind, forwarded, signal);
	}
	return kind === "chat" ? piChat(body, signal) : piEmbeddings(body, signal);
}

const pick = (o: Body, keys: string[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
