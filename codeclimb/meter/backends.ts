// The proxy's real backends. Chat goes through Pi's model runtime: the same
// credentials and catalog prices as the coders. Pi has no embeddings, so those
// are passed through to the provider's OpenAI-compatible endpoint with Pi's
// resolved key and priced from EMBEDDINGS.
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveModel } from "../pi/session";
import { BackendError, type CallUsage, type MeterBackends } from "./proxy";

// Pi's message types, from the runtime's own signature (pi-ai is not a direct dependency).
type Message = Parameters<ModelRuntime["completeSimple"]>[1]["messages"][number];
type AssistantMessage = Awaited<ReturnType<ModelRuntime["completeSimple"]>>;

/** Embedding providers and $ per million input tokens. Prices change: keep in step with the provider's page. */
const EMBEDDINGS: Record<string, { baseUrl: string; usdPerMTok: Record<string, number> }> = {
  openai: { baseUrl: "https://api.openai.com/v1", usdPerMTok: { "text-embedding-3-small": 0.02, "text-embedding-3-large": 0.13 } },
};

/** An embeddings model priced in EMBEDDINGS: not in Pi's catalog, so checkModels skips it. */
export function isEmbeddingModel(ref: string): boolean {
  const i = ref.indexOf("/");
  return i > 0 && EMBEDDINGS[ref.slice(0, i)]?.usdPerMTok[ref.slice(i + 1)] !== undefined;
}

const ZERO_USAGE = {
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function split(ref: string): [string, string] {
  const i = ref.indexOf("/");
  if (i < 0) throw new BackendError(`model "${ref}" must be "<provider>/<id>"`);
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export function piBackends(rt: ModelRuntime): MeterBackends {
  return {
    async chat(req, signal) {
      const model = await resolveModel(req.model).catch((e: Error) => {
        throw new BackendError(e.message);
      });
      const now = Date.now();
      const systemPrompt = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || undefined;
      // Earlier assistant turns become minimal assistant messages of the same model.
      const messages: Message[] = req.messages
        .filter((m) => m.role !== "system")
        .map((m) =>
          m.role === "user"
            ? { role: "user", content: m.content, timestamp: now }
            : ({
                role: "assistant", content: [{ type: "text", text: m.content }], api: model.api, provider: model.provider,
                model: model.id, usage: ZERO_USAGE, stopReason: "stop", timestamp: now,
              } as AssistantMessage),
        );
      let out: AssistantMessage;
      try {
        out = await rt.completeSimple(model, { systemPrompt, messages }, { maxTokens: req.maxTokens, temperature: req.temperature, signal });
      } catch (e) {
        throw new BackendError((e as Error).message);
      }
      const u = out.usage;
      const usage: CallUsage = { inputTokens: u.input + u.cacheRead + u.cacheWrite, outputTokens: u.output, costUsd: u.cost.total };
      // Pi reports failures as a message, not an exception; what they cost was still spent.
      if (out.stopReason === "error" || out.stopReason === "aborted") throw new BackendError(out.errorMessage ?? out.stopReason, usage);
      const text = out.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
      return { text, finishReason: out.stopReason === "length" ? "length" : "stop", usage, responseModel: out.responseModel ?? out.model };
    },

    async embed(ref, input, signal) {
      const [provider, id] = split(ref);
      const entry = EMBEDDINGS[provider];
      const price = entry?.usdPerMTok[id];
      if (!entry || price === undefined) throw new BackendError(`no embeddings pricing for ${ref}`);
      const auth = (await rt.getAuth(provider))?.auth;
      if (!auth?.apiKey) throw new BackendError(`no ${provider} credentials`);
      const res = await fetch(`${auth.baseUrl ?? entry.baseUrl}/embeddings`, {
        method: "POST",
        headers: { ...auth.headers, "content-type": "application/json", authorization: `Bearer ${auth.apiKey}` },
        body: JSON.stringify({ model: id, input }),
        signal,
      }).catch((e: Error) => {
        throw new BackendError(e.message);
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { index: number; embedding: number[] }[];
        usage?: { prompt_tokens?: number };
        error?: { message?: string };
      };
      if (!res.ok || !Array.isArray(body.data)) throw new BackendError(body.error?.message ?? `embeddings returned ${res.status}`);
      const tokens = body.usage?.prompt_tokens ?? 0;
      return {
        vectors: [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding),
        usage: { inputTokens: tokens, outputTokens: 0, costUsd: (tokens / 1e6) * price },
      };
    },
  };
}
