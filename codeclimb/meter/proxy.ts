// Metering proxy: the only way a program under evaluation reaches a model. It
// runs in the worker, so provider keys never enter a sandbox. Each eval gets
// its own bearer token, mapped to a ledger that records every call's model,
// operation, tokens and cost, and enforces `allowed_models` and the eval's $ cap.
//
// OpenAI-compatible, the subset a stdlib program needs:
//   POST /v1/chat/completions  text messages only (no tools, no streaming)
//   POST /v1/embeddings
//   POST /v1/_op {"op": "query"}  the runner names the operation later calls belong to
// Status codes follow SDK retry policy: 401 bad token, 403 model not allowed,
// 402 eval budget spent, 400 unsupported request; only upstream failures are 502.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
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
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
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

export interface MeterBackends {
  chat(req: ChatRequest, signal: AbortSignal): Promise<ChatResult>;
  embed(model: string, input: string[], signal: AbortSignal): Promise<EmbedResult>;
}

/** An upstream failure. `usage` is what the failed call still cost. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly usage?: CallUsage,
  ) {
    super(message);
  }
}

export interface MeterCall {
  kind: "chat" | "embeddings";
  model: string;
  op: string;
  ok: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  ms: number;
}

/** Operation of calls made before the runner names one. */
export const DEFAULT_OP = "program";

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
}

const tracer = trace.getTracer("codeclimb");
const OP_RE = /^[a-z][a-z0-9_]*$/;
const MAX_BODY = 16 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly type = "invalid_request_error",
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
  return {
    model: String(body.model),
    messages,
    ...(typeof maxTokens === "number" ? { maxTokens } : {}),
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
  };
}

export class MeterProxy {
  private readonly ledgers = new Map<string, Ledger>();
  private server: Server | undefined;

  constructor(
    private readonly backends: MeterBackends,
    private readonly host = "127.0.0.1",
  ) {}

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
  open(opts: { evalId: string; allowedModels: string[]; capUsd: number; attrs?: Record<string, string> }): string {
    const token = `cc-${randomBytes(24).toString("hex")}`;
    this.ledgers.set(token, {
      evalId: opts.evalId, allowed: new Set(opts.allowedModels), capUsd: opts.capUsd, op: DEFAULT_OP, calls: [], costUsd: 0,
      ctx: context.active(), attrs: opts.attrs ?? {}, abort: new AbortController(),
    });
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

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const path = (req.url ?? "").split("?")[0].replace(/\/+$/, "");
      const route = { "/v1/chat/completions": "chat", "/v1/embeddings": "embeddings", "/v1/_op": "op" }[path];
      if (!route) throw new HttpError(404, `unknown endpoint ${path}`, "not_found_error");
      if (req.method !== "POST") throw new HttpError(405, "use POST");
      const auth = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
      const ledger = auth ? this.ledgers.get(auth) : undefined;
      if (!ledger) throw new HttpError(401, "invalid or expired token", "authentication_error");
      const body = await readJson(req);
      if (route === "op") {
        if (typeof body.op !== "string" || !OP_RE.test(body.op)) throw new HttpError(400, "op must match [a-z][a-z0-9_]*");
        ledger.op = body.op;
        return send(res, 200, { op: ledger.op });
      }
      const model = String(body.model ?? "");
      if (!ledger.allowed.has(model)) throw new HttpError(403, `model ${model || "(none)"} is not in allowed_models`, "permission_error");
      if (ledger.costUsd >= ledger.capUsd) throw new HttpError(402, `eval budget of $${ledger.capUsd} is spent`, "insufficient_quota");
      if (route === "chat") return send(res, 200, await this.chat(ledger, parseChat(body)));
      return send(res, 200, await this.embed(ledger, model, body.input));
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, (e as Error).message, "server_error");
      if (!res.headersSent) send(res, err.status, { error: { message: err.message, type: err.type } });
    }
  }

  private async metered<T extends { usage: CallUsage }>(
    ledger: Ledger,
    kind: MeterCall["kind"],
    model: string,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const op = ledger.op;
    const span = tracer.startSpan(
      kind === "chat" ? "gen_ai.chat" : "gen_ai.embeddings",
      { attributes: { ...ledger.attrs, "gen_ai.operation.name": kind, "gen_ai.request.model": model, "codeclimb.op": op } },
      ledger.ctx,
    );
    const t0 = performance.now();
    const record = (ok: boolean, usage: CallUsage | undefined) => {
      const u = usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      ledger.calls.push({
        kind, model, op, ok, input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_usd: u.costUsd,
        ms: Math.round((performance.now() - t0) * 1000) / 1000,
      });
      ledger.costUsd += u.costUsd;
      span.setAttributes({
        "gen_ai.usage.input_tokens": u.inputTokens, "gen_ai.usage.output_tokens": u.outputTokens, "codeclimb.cost_usd": u.costUsd,
      });
    };
    try {
      const out = await run(ledger.abort.signal);
      record(true, out.usage);
      return out;
    } catch (e) {
      record(false, e instanceof BackendError ? e.usage : undefined);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw new HttpError(502, `upstream: ${(e as Error).message}`, "api_error");
    } finally {
      span.end();
    }
  }

  private async chat(ledger: Ledger, req: ChatRequest) {
    const out = await this.metered(ledger, "chat", req.model, (signal) => this.backends.chat(req, signal));
    return {
      id: `chatcmpl-${randomBytes(8).toString("hex")}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [{ index: 0, message: { role: "assistant", content: out.text }, finish_reason: out.finishReason }],
      usage: { prompt_tokens: out.usage.inputTokens, completion_tokens: out.usage.outputTokens, total_tokens: out.usage.inputTokens + out.usage.outputTokens },
    };
  }

  private async embed(ledger: Ledger, model: string, input: unknown) {
    const texts = typeof input === "string" ? [input] : input;
    if (!Array.isArray(texts) || !texts.length || !texts.every((t) => typeof t === "string")) {
      throw new HttpError(400, "input must be a string or a non-empty array of strings");
    }
    const out = await this.metered(ledger, "embeddings", model, (signal) => this.backends.embed(model, texts as string[], signal));
    return {
      object: "list",
      model,
      data: out.vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
      usage: { prompt_tokens: out.usage.inputTokens, total_tokens: out.usage.inputTokens },
    };
  }
}
