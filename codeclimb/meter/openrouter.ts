// `openrouter/<id>` models, called directly rather than through Pi: the program needs what Pi's
// runtime drops (`response_format`, `seed`, embeddings), and OpenRouter reports each call's real cost.
// The key stays on the worker; only the proxy calls this.
import { BackendError, type CallUsage, type MeterBackends } from "./proxy";

export const OPENROUTER_PREFIX = "openrouter/";
const BASE_URL = "https://openrouter.ai/api";
const CALL_TIMEOUT_MS = 5 * 60_000;

export const isOpenRouterModel = (ref: string) => ref.startsWith(OPENROUTER_PREFIX);

/** Chat and embeddings name tokens prompt/completion; decisions name them input/output. */
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost?: number;
}

interface Reply {
  choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  data?: { index: number; embedding: number[] }[];
  answers?: Record<string, unknown>;
  model?: string;
  usage?: Usage;
  error?: { message?: string };
}

function usageOf(u: Usage | undefined): CallUsage {
  // Without a cost the ledger can't enforce its cap, so the call counts as failed.
  if (typeof u?.cost !== "number") throw new BackendError("OpenRouter's response has no usage.cost");
  return { inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0, outputTokens: u.completion_tokens ?? u.output_tokens ?? 0, costUsd: u.cost };
}

function requireKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new BackendError("OPENROUTER_API_KEY is not set on the worker");
  return key;
}

async function post(baseUrl: string, path: string, body: unknown, signal: AbortSignal): Promise<Reply> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${requireKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]),
  }).catch((e: Error) => {
    throw new BackendError(e.message);
  });
  const reply = (await res.json().catch(() => ({}))) as Reply;
  // OpenRouter can answer 200 with an `error` body when the provider fails mid-call.
  if (!res.ok || reply.error) throw new BackendError(reply.error?.message ?? `OpenRouter returned ${res.status}`);
  return reply;
}

export function openRouterBackends(baseUrl = BASE_URL): MeterBackends {
  return {
    async chat(req, signal) {
      const reply = await post(
        baseUrl,
        "/v1/chat/completions",
        {
          ...req.options,
          model: req.model.slice(OPENROUTER_PREFIX.length),
          messages: req.messages,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          usage: { include: true },
        },
        signal,
      );
      const usage = usageOf(reply.usage);
      const choice = reply.choices?.[0];
      if (!choice) throw new BackendError("OpenRouter's response has no choices", usage);
      // A reasoning model cut off by max_tokens answers with null content.
      return { text: choice.message?.content ?? "", finishReason: choice.finish_reason === "length" ? "length" : "stop", usage, responseModel: reply.model };
    },

    async embed(ref, input, signal) {
      const reply = await post(baseUrl, "/v1/embeddings", { model: ref.slice(OPENROUTER_PREFIX.length), input }, signal);
      const usage = usageOf(reply.usage);
      if (!Array.isArray(reply.data)) throw new BackendError("OpenRouter's response has no data", usage);
      return { vectors: [...reply.data].sort((a, b) => a.index - b.index).map((d) => d.embedding), usage };
    },

    // Decisions models (typesafe/jev-*) refuse chat; OpenRouter serves them on this alpha endpoint.
    async decide(ref, request, signal) {
      const reply = await post(baseUrl, "/alpha/decisions", { ...request, model: ref.slice(OPENROUTER_PREFIX.length) }, signal);
      const usage = usageOf(reply.usage);
      if (!reply.answers) throw new BackendError("OpenRouter's response has no answers", usage);
      return { answers: reply.answers, usage };
    },
  };
}

/**
 * Fails listing every `openrouter/` model the key can't call. It asks the per-model endpoints API:
 * `/models` omits some models a key can use (typesafe/jev-1.14).
 */
export async function checkOpenRouterModels(refs: string[], baseUrl = BASE_URL): Promise<void> {
  const models = [...new Set(refs)].filter(isOpenRouterModel);
  if (!models.length) return;
  if (!process.env.OPENROUTER_API_KEY) throw new Error(`models not ready: OPENROUTER_API_KEY is not set (needed for ${models.join(", ")})`);
  const problems = await Promise.all(
    models.map(async (ref) => {
      const id = ref.slice(OPENROUTER_PREFIX.length);
      const res = await fetch(`${baseUrl}/v1/models/${id}/endpoints`, {
        headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        signal: AbortSignal.timeout(30_000),
      }).catch((e: Error) => e);
      if (res instanceof Error) return `${ref}: ${res.message}`;
      const body = (await res.json().catch(() => ({}))) as { data?: { endpoints?: unknown[] } };
      return res.ok && body.data?.endpoints?.length ? null : `${ref}: OpenRouter lists no endpoint for it (${res.status})`;
    }),
  );
  const failed = problems.filter((p) => p !== null);
  if (failed.length) throw new Error(`models not ready:\n  - ${failed.join("\n  - ")}`);
}
