// Metering proxy: the only way a program under evaluation reaches a model. It
// runs in the worker, so provider keys never enter a sandbox. Each eval gets
// its own bearer token, mapped to a ledger that records every call's model,
// operation, tokens and cost, and enforces `allowed_models` and the eval's $ cap.
//
// OpenAI-compatible, the subset a stdlib program needs:
//   POST /v1/chat/completions  text messages only (no tools, no streaming); FORWARDED fields pass through
//   POST /v1/embeddings
//   POST /v1/decisions  OpenRouter's decisions models: {model, state, questions}, answered as {answers}
//   POST /v1/_op {"op": "query"}  the runner names the operation later calls belong to
// Status codes follow SDK retry policy: 401 bad token, 403 model not allowed,
// 402 budget spent, 400 unsupported request; only upstream failures are 502.
import { type CreditStop, isCreditError } from "../credits";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { type Context, context, SpanStatusCode, trace } from "@opentelemetry/api";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** FORWARDED request fields, for backends that take them (OpenRouter); Pi ignores them. */
  options?: Record<string, unknown>;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** The part of `outputTokens` a model spent reasoning, when the backend reports it. */
  reasoningTokens?: number;
}

export interface ChatResult {
  text: string;
  finishReason: "stop" | "length";
  usage: CallUsage;
  responseModel?: string;
}

export interface EmbedResult {
  vectors: number[][];
  usage: CallUsage;
}

export interface DecisionResult {
  answers: Record<string, unknown>;
  usage: CallUsage;
}

export interface RerankRequest {
  query: string;
  documents: string[];
  top_n?: number;
}

export interface RerankResult {
  /** Best first; `index` points into the request's documents. */
  results: { index: number; relevance_score: number }[];
  usage: CallUsage;
}

export interface MeterBackends {
  chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
  embed(model: string, input: string[], signal: AbortSignal): Promise<EmbedResult>;
  decide(model: string, request: Record<string, unknown>, signal: AbortSignal): Promise<DecisionResult>;
  rerank(model: string, request: RerankRequest, signal: AbortSignal): Promise<RerankResult>;
}

const NO_USAGE: CallUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

/** Free canned answers, for `run-night --mock`. */
const MOCK_BACKENDS: MeterBackends = {
  chat: async () => ({ text: "mock", finishReason: "stop", usage: NO_USAGE }),
  embed: async (_model, input) => ({ vectors: input.map(() => [1, 0, 0, 0]), usage: NO_USAGE }),
  decide: async () => ({ answers: {}, usage: NO_USAGE }),
  rerank: async (_model, { documents }) => ({ results: documents.map((_, index) => ({ index, relevance_score: 0 })), usage: NO_USAGE }),
};

/** An upstream failure. `usage` is what the failed call still cost. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly usage?: CallUsage,
    /** The account is out of credits, whatever the message says. */
    readonly credits = false,
  ) {
    super(message);
  }
}

export interface MeterCall {
  kind: "chat" | "embeddings" | "decisions" | "rerank";
  model: string;
  op: string;
  ok: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ms: number;
  /** Why it failed. */
  error?: string;
  /** Chat: `length` means `max_tokens` cut the reply off, and a reasoning model may have written none. */
  finish_reason?: string;
  reasoning_tokens?: number;
  /** It repeated an earlier eval's call and got that answer for free: what that call cost. */
  replayed_usd?: number;
  /** The status the proxy refused it with: it never went upstream and isn't a model call. */
  rejected?: number;
}

/** Operation of calls made before the runner names one. */
export const DEFAULT_OP = "program";
/** On `checkMeterUrl`'s probe: its expected 401 is no warning. */
export const PROBE_HEADER = "x-codeclimb-probe";

interface Ledger {
  evalId: string;
  allowed: Set<string>;
  capUsd: number;
  op: string;
  calls: MeterCall[];
  costUsd: number;
  /** The eval step's trace context, captured at open(): call spans nest under it. */
  ctx: Context;
  attrs: Record<string, string>;
  abort: AbortController;
  /** Set by the first out-of-credits call; later calls are refused without going upstream. */
  creditStop?: CreditStop;
  onCreditStop?: (stop: CreditStop) => void;
  /** Canned answers instead of the real backends. */
  mock?: boolean;
  /** Evals in one scope replay each other's calls (`MeterProxy.replays`). */
  replayScope?: string;
  /** What this eval has replayed: asked again, the program is retrying a bad answer, so it goes upstream. */
  replayed: Set<string>;
  /** A coder's ledger spans many runs of the program: it replays its own calls too, unless they look like retries. */
  repeatRuns: boolean;
}

/**
 * On a coder's ledger, the same call again within this time of its answer is a retry of a bad answer, not
 * another run. A program retries at once; a coder's rerun comes later. It was 30 s from the call's start:
 * a 27 s train run rerun at once had about half its calls inside that, answered anew by a model that is
 * not deterministic at temperature 0, so identical code scored 0.722 to 0.767 on mention F1.
 */
const RETRY_WINDOW_MS = 5_000;

/** A successful call, for later evals of the night. `ms` is kept so a replay takes as long as the call did. */
interface Replay {
  evalId: string;
  out: unknown;
  ms: number;
  /** When it was last answered: when the answer went out, after a replay's delay too. */
  at: number;
}

const tracer = trace.getTracer("codeclimb");
const OP_RE = /^[a-z][a-z0-9_]*$/;
/** Chat fields sent upstream as they are. A provider that doesn't support one ignores it. */
const FORWARDED = ["response_format", "seed", "top_p", "stop", "reasoning"];
/** Decisions fields sent upstream as they are. */
const DECISION_FIELDS = ["state", "questions", "assets"];
const MAX_BODY = 16 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "invalid_request_error",
    /** It reached upstream, so the ledger has it already. */
    readonly recorded = false,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "request body too large");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "body must be a JSON object");
  }
}

/** OpenAI content: a string, or text parts. Anything else (images, tool messages) is unsupported. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.every((p) => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")) {
    return content.map((p) => p.text as string).join("");
  }
  throw new HttpError(400, "only text message content is supported");
}

function parseChat(body: Record<string, unknown>): ChatRequest {
  if (body.stream) throw new HttpError(400, "streaming is not supported");
  if ((Array.isArray(body.tools) && body.tools.length) || body.functions) throw new HttpError(400, "tools are not supported");
  if (!Array.isArray(body.messages) || !body.messages.length) throw new HttpError(400, "messages must be a non-empty array");
  const messages = body.messages.map((m: { role?: unknown; content?: unknown }) => {
    if (m?.role !== "system" && m?.role !== "user" && m?.role !== "assistant") throw new HttpError(400, `unsupported role ${String(m?.role)}`);
    return { role: m.role, content: textOf(m.content) } as ChatMessage;
  });
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  const options = Object.fromEntries(FORWARDED.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
  return {
    model: String(body.model),
    messages,
    ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(Object.keys(options).length ? { options } : {}),
  };
}

export class MeterProxy {
  private readonly ledgers = new Map<string, Ledger>();
  /**
   * The last night's calls by request. The same request in a later eval gets the same answer, so code that
   * didn't change scores the same and costs nothing, and a metric moves only where a change reached.
   */
  private replays = { scope: "", calls: new Map<string, Replay>() };
  private server: Server | undefined;

  constructor(
    private readonly backends: MeterBackends,
    private readonly host = "127.0.0.1",
  ) {}

  private backendsFor(ledger: Ledger): MeterBackends {
    return ledger.mock ? MOCK_BACKENDS : this.backends;
  }

  async listen(port = 0): Promise<number> {
    if (this.server) return this.port;
    const server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, this.host, resolve);
    });
    this.server = server;
    return this.port;
  }

  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  async stop(): Promise<void> {
    for (const token of [...this.ledgers.keys()]) this.close(token);
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = undefined;
  }

  /** A ledger for one eval. Returns its bearer token. */
  open(opts: { evalId: string; allowedModels: string[]; capUsd: number; attrs?: Record<string, string>; onCreditStop?: (stop: CreditStop) => void; mock?: boolean; replayScope?: string; repeatRuns?: boolean }): string {
    const token = `cc-${randomBytes(24).toString("hex")}`;
    this.ledgers.set(token, {
      evalId: opts.evalId, allowed: new Set(opts.allowedModels), capUsd: opts.capUsd, op: DEFAULT_OP, calls: [], costUsd: 0,
      ctx: context.active(), attrs: opts.attrs ?? {}, abort: new AbortController(), onCreditStop: opts.onCreditStop, mock: opts.mock,
      replayScope: opts.replayScope, replayed: new Set(), repeatRuns: opts.repeatRuns ?? false,
    });
    if (opts.replayScope && opts.replayScope !== this.replays.scope) this.replays = { scope: opts.replayScope, calls: new Map() };
    return token;
  }

  /** What the token's ledger has spent so far ($); 0 for an unknown or closed token. */
  spent(token: string): number {
    return this.ledgers.get(token)?.costUsd ?? 0;
  }

  /** Revokes the token, aborts its calls in flight and returns what the eval spent. */
  close(token: string): MeterCall[] {
    const ledger = this.ledgers.get(token);
    if (!ledger) return [];
    this.ledgers.delete(token);
    ledger.abort.abort();
    return ledger.calls;
  }

  /** The request handler, also mounted at /v1 on the worker API's port. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let ledger: Ledger | undefined;
    let kind: MeterCall["kind"] | undefined;
    let model = "";
    try {
      const path = (req.url ?? "").split("?")[0].replace(/\/+$/, "");
      const route = { "/v1/chat/completions": "chat", "/v1/embeddings": "embeddings", "/v1/decisions": "decisions", "/v1/rerank": "rerank", "/v1/_op": "op" }[path];
      if (!route) throw new HttpError(404, `unknown endpoint ${path}`, "not_found_error");
      if (req.method !== "POST") throw new HttpError(405, "use POST");
      const auth = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      ledger = auth ? this.ledgers.get(auth) : undefined;
      if (!ledger) throw new HttpError(401, "invalid or expired token", "authentication_error");
      const body = await readJson(req);
      if (route === "op") {
        if (typeof body.op !== "string" || !OP_RE.test(body.op)) throw new HttpError(400, "op must match [a-z][a-z0-9_]*");
        ledger.op = body.op;
        return send(res, 200, { op: ledger.op });
      }
      kind = route as MeterCall["kind"];
      model = String(body.model ?? "");
      if (!ledger.allowed.has(model)) throw new HttpError(403, `model ${model || "(none)"} is not in allowed_models`, "permission_error");
      if (ledger.creditStop) throw new HttpError(402, `out of credits: ${ledger.creditStop.message}`, "insufficient_quota");
      if (ledger.costUsd >= ledger.capUsd) throw new HttpError(402, `budget of $${ledger.capUsd} is spent`, "insufficient_quota");
      if (route === "chat") return send(res, 200, await this.chat(ledger, parseChat(body)));
      if (route === "decisions") return send(res, 200, await this.decide(ledger, model, body));
      if (route === "rerank") return send(res, 200, await this.rerank(ledger, model, body));
      return send(res, 200, await this.embed(ledger, model, body.input));
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, (e as Error).message, "server_error");
      if (err.status === 401 && !req.headers[PROBE_HEADER]) console.warn(`[meter] ${req.url}: ${err.message}`);
      // A refused call spends nothing, so only this line shows that it happened.
      if (ledger && kind && !err.recorded) {
        ledger.calls.push({ kind, model, op: ledger.op, ok: false, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0, error: err.message, rejected: err.status });
      }
      if (!res.headersSent) send(res, err.status, { error: { message: err.message, type: err.type } });
    }
  }

  private async metered<T extends { usage: CallUsage; finishReason?: string }>(
    ledger: Ledger,
    kind: MeterCall["kind"],
    model: string,
    request: unknown,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const key = createHash("sha256").update(JSON.stringify([kind, model, request])).digest("hex");
    const earlier = this.replays.scope === ledger.replayScope ? this.replays.calls.get(key) : undefined;
    const again = ledger.repeatRuns ? earlier && Date.now() - earlier.at > RETRY_WINDOW_MS : earlier && earlier.evalId !== ledger.evalId && !ledger.replayed.has(key);
    const replay = again ? earlier : undefined;
    const op = ledger.op;
    const span = tracer.startSpan(
      `gen_ai.${kind}`,
      { attributes: { ...ledger.attrs, "gen_ai.operation.name": kind, "gen_ai.request.model": model, "codeclimb.op": op } },
      ledger.ctx,
    );
    const t0 = performance.now();
    const record = (ok: boolean, usage: CallUsage | undefined, error?: string, finishReason?: string, replayed?: number) => {
      const u = usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      ledger.calls.push({
        kind, model, op, ok, input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_usd: u.costUsd,
        ms: Math.round((performance.now() - t0) * 1000) / 1000, ...(error ? { error } : {}),
        ...(finishReason ? { finish_reason: finishReason } : {}), ...(u.reasoningTokens ? { reasoning_tokens: u.reasoningTokens } : {}),
        ...(replayed === undefined ? {} : { replayed_usd: replayed }),
      });
      ledger.costUsd += u.costUsd;
      span.setAttributes({
        "gen_ai.usage.input_tokens": u.inputTokens, "gen_ai.usage.output_tokens": u.outputTokens, "codeclimb.cost_usd": u.costUsd,
      });
    };
    try {
      if (replay) {
        ledger.replayed.add(key);
        await delay(replay.ms, undefined, { signal: ledger.abort.signal });
        replay.at = Date.now();
        const out = replay.out as T;
        record(true, { ...out.usage, costUsd: 0 }, undefined, out.finishReason, out.usage.costUsd);
        return out;
      }
      const out = await run(ledger.abort.signal);
      record(true, out.usage, undefined, out.finishReason);
      if (ledger.replayScope === this.replays.scope && ledger.replayScope && out.finishReason !== "length") {
        this.replays.calls.set(key, { evalId: ledger.evalId, out, ms: performance.now() - t0, at: Date.now() });
      }
      return out;
    } catch (e) {
      const { message } = e as Error;
      record(false, e instanceof BackendError ? e.usage : undefined, message);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      if ((e instanceof BackendError && e.credits) || isCreditError(message)) {
        if (!ledger.creditStop) {
          ledger.creditStop = { who: "program", model, message };
          ledger.onCreditStop?.(ledger.creditStop);
        }
        throw new HttpError(402, `out of credits: ${message}`, "insufficient_quota", true);
      }
      throw new HttpError(502, `upstream: ${message}`, "api_error", true);
    } finally {
      span.end();
    }
  }

  private async chat(ledger: Ledger, req: ChatRequest) {
    const out = await this.metered(ledger, "chat", req.model, req, (signal) => this.backendsFor(ledger).chat(req, signal));
    return {
      id: `chatcmpl-${randomBytes(8).toString("hex")}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [{ index: 0, message: { role: "assistant", content: out.text }, finish_reason: out.finishReason }],
      usage: { prompt_tokens: out.usage.inputTokens, completion_tokens: out.usage.outputTokens, total_tokens: out.usage.inputTokens + out.usage.outputTokens },
    };
  }

  private async decide(ledger: Ledger, model: string, body: Record<string, unknown>) {
    if (body.state === undefined || !body.questions || typeof body.questions !== "object") throw new HttpError(400, "decisions need state and questions");
    const request = Object.fromEntries(DECISION_FIELDS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
    const out = await this.metered(ledger, "decisions", model, request, (signal) => this.backendsFor(ledger).decide(model, request, signal));
    return { model, answers: out.answers, usage: { input_tokens: out.usage.inputTokens, output_tokens: out.usage.outputTokens } };
  }

  private async rerank(ledger: Ledger, model: string, body: Record<string, unknown>) {
    const { query, documents, top_n } = body;
    if (typeof query !== "string" || !query) throw new HttpError(400, "rerank needs a query");
    if (!Array.isArray(documents) || !documents.length || !documents.every((d) => typeof d === "string")) {
      throw new HttpError(400, "documents must be a non-empty array of strings");
    }
    const request = { query, documents: documents as string[], ...(typeof top_n === "number" ? { top_n } : {}) };
    const out = await this.metered(ledger, "rerank", model, request, (signal) => this.backendsFor(ledger).rerank(model, request, signal));
    return { model, results: out.results, usage: { total_tokens: out.usage.inputTokens } };
  }

  private async embed(ledger: Ledger, model: string, input: unknown) {
    const texts = typeof input === "string" ? [input] : input;
    if (!Array.isArray(texts) || !texts.length || !texts.every((t) => typeof t === "string")) {
      throw new HttpError(400, "input must be a string or a non-empty array of strings");
    }
    const out = await this.metered(ledger, "embeddings", model, texts, (signal) => this.backendsFor(ledger).embed(model, texts as string[], signal));
    return {
      object: "list",
      model,
      data: out.vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
      usage: { prompt_tokens: out.usage.inputTokens, total_tokens: out.usage.inputTokens },
    };
  }
}
