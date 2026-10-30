import assert from "node:assert/strict";
import { after, test } from "node:test";
import { BackendError, type MeterBackends, MeterProxy } from "./meter/proxy";
import { costMetrics } from "./standard-metrics";

// Fake upstream: chat costs $0.01 per call and echoes the last user message; "fail" fails after spending $0.002.
const backends: MeterBackends = {
  async chat(req) {
    const last = req.messages[req.messages.length - 1].content;
    if (last === "fail") throw new BackendError("upstream down", { inputTokens: 5, outputTokens: 0, costUsd: 0.002 });
    return { text: `echo:${last}`, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 3, costUsd: 0.01 } };
  },
  async embed(_model, input) {
    return { vectors: input.map((t) => [t.length, 0]), usage: { inputTokens: input.length * 4, outputTokens: 0, costUsd: 0.0001 } };
  },
};
const proxy = new MeterProxy(backends);
const port = await proxy.listen();
after(() => proxy.stop());

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const chat = (token: string, content: unknown, extra: object = {}) =>
  post("/v1/chat/completions", { model: "p/chat", messages: [{ role: "system", content: "s" }, { role: "user", content }], ...extra }, token);

test("metering proxy: auth, allowed models and unsupported requests", async () => {
  const t = proxy.open({ evalId: "e1", allowedModels: ["p/chat"], capUsd: 1 });
  assert.equal((await chat("nope", "hi")).status, 401);
  assert.equal((await post("/v1/chat/completions", { model: "p/chat", messages: [] })).status, 401);
  const denied = await post("/v1/chat/completions", { model: "p/other", messages: [{ role: "user", content: "x" }] }, t);
  assert.deepEqual([denied.status, denied.body.error.type], [403, "permission_error"]);
  assert.equal((await chat(t, "x", { stream: true })).status, 400);
  assert.equal((await chat(t, "x", { tools: [{ type: "function" }] })).status, 400);
  assert.equal((await chat(t, [{ type: "image_url", image_url: { url: "u" } }])).status, 400);
  assert.equal((await post("/v1/chat/completions", { model: "p/chat", messages: [{ role: "tool", content: "x" }] }, t)).status, 400);
  assert.equal((await post("/v1/_op", { op: "Bad Op" }, t)).status, 400);
  assert.equal((await post("/v1/nope", {}, t)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { headers: { authorization: `Bearer ${t}` } })).status, 405);
  // Refused requests cost nothing.
  assert.deepEqual(proxy.close(t), []);
});

test("metering proxy: OpenAI responses, cost per operation, cap and revocation", async () => {
  const t = proxy.open({ evalId: "e2", allowedModels: ["p/chat", "p/embed"], capUsd: 0.02 });
  const ok = await chat(t, [{ type: "text", text: "hello" }]);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.choices[0].message.content, "echo:hello");
  assert.deepEqual(ok.body.usage, { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 });
  assert.equal((await post("/v1/_op", { op: "query" }, t)).body.op, "query");
  const emb = await post("/v1/embeddings", { model: "p/embed", input: ["ab", "abcd"] }, t);
  assert.deepEqual(emb.body.data.map((d: { embedding: number[] }) => d.embedding), [[2, 0], [4, 0]]);
  assert.equal(emb.body.usage.prompt_tokens, 8);
  // A failed upstream call is a 502, and what it cost is still charged.
  assert.equal((await chat(t, "fail")).status, 502);
  // The cap is checked before each call, so the call that crosses it still runs: $0.0121 → $0.0221.
  assert.equal((await chat(t, "again")).status, 200);
  assert.ok(Math.abs(proxy.spent(t) - 0.0221) < 1e-9);
  const capped = await chat(t, "over");
  assert.deepEqual([capped.status, capped.body.error.type], [402, "insufficient_quota"]);

  const calls = proxy.close(t);
  assert.deepEqual(calls.map((c) => [c.kind, c.op, c.ok]), [
    ["chat", "program", true], ["embeddings", "query", true], ["chat", "query", false], ["chat", "query", true],
  ]);
  assert.equal((await chat(t, "after close")).status, 401);
  assert.equal(proxy.spent(t), 0);

  const m = costMetrics(calls, 4);
  assert.deepEqual(m, {
    cost_program_usd: 0.01, cost_query_usd: 0.0121, cost_usd: 0.0221, cost_per_item_usd: 0.005525, model_calls: 4,
  });
  assert.deepEqual(costMetrics([], 10), { cost_usd: 0, cost_per_item_usd: 0, model_calls: 0 });
});
