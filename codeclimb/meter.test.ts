import { isCreditError } from "./credits";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { checkMeterUrl, publicMeterUrl } from "./meter/index";
import { BackendError, type MeterBackends, type MeterCall, MeterProxy } from "./meter/proxy";
import { costMetrics } from "./standard-metrics";

// Fake upstream: chat costs $0.01 per call and echoes the last user message; "fail" fails after spending $0.002.
const backends: MeterBackends = {
  async chat(req) {
    const last = req.messages[req.messages.length - 1].content;
    if (last === "fail") throw new BackendError("upstream down", { inputTokens: 5, outputTokens: 0, costUsd: 0.002 });
    if (last === "reason") return { text: "", finishReason: "length", usage: { inputTokens: 10, outputTokens: 7, costUsd: 0.01, reasoningTokens: 7 } };
    return { text: `echo:${last}`, finishReason: "stop", usage: { inputTokens: 10, outputTokens: 3, costUsd: 0.01 } };
  },
  async embed(_model, input) {
    return { vectors: input.map((t) => [t.length, 0]), usage: { inputTokens: input.length * 4, outputTokens: 0, costUsd: 0.0001 } };
  },
  async rerank(_model, request) {
    if (request.query === "broke") throw new BackendError("Insufficient credits. Add more", undefined, true);
    return { results: request.documents.map((_, index) => ({ index, relevance_score: 1 / (index + 1) })), usage: { inputTokens: 9, outputTokens: 0, costUsd: 0.0002 } };
  },
  async decide() {
    return { answers: {}, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
  },
};
const upstream = (c: MeterCall) => !c.rejected;
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
  assert.deepEqual(proxy.close(t).filter(upstream), []);
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

  const calls = proxy.close(t).filter(upstream);
  assert.deepEqual(calls.map((c) => [c.kind, c.op, c.ok]), [
    ["chat", "program", true], ["embeddings", "query", true], ["chat", "query", false], ["chat", "query", true],
  ]);
  assert.equal((await chat(t, "after close")).status, 401);
  assert.equal(proxy.spent(t), 0);

  const m = costMetrics(calls, 4);
  assert.deepEqual(m, {
    cost_program_usd: 0.01, cost_query_usd: 0.0121, cost_usd: 0.0221, cost_per_item_usd: 0.005525, model_calls: 4, model_calls_replayed: 0, model_calls_failed: 1,
  });
  assert.deepEqual(costMetrics([], 10), { cost_usd: 0, cost_per_item_usd: 0, model_calls: 0, model_calls_replayed: 0, model_calls_failed: 0 });
});

test("rerank: metered per call, documents required, allowed models only", async () => {
  const t = proxy.open({ evalId: "e-rerank", allowedModels: ["p/rerank"], capUsd: 1 });
  const ok = await post("/v1/rerank", { model: "p/rerank", query: "q", documents: ["a", "b"] }, t);
  assert.deepEqual(ok.body.results, [{ index: 0, relevance_score: 1 }, { index: 1, relevance_score: 0.5 }]);
  assert.equal((await post("/v1/rerank", { model: "p/rerank", query: "q", documents: [] }, t)).status, 400);
  assert.equal((await post("/v1/rerank", { model: "p/rerank", documents: ["a"] }, t)).status, 400);
  assert.equal((await post("/v1/rerank", { model: "p/other", query: "q", documents: ["a"] }, t)).status, 403);
  const calls = proxy.close(t).filter(upstream);
  assert.deepEqual(calls.map((c) => [c.kind, c.model, c.input_tokens, c.cost_usd]), [["rerank", "p/rerank", 9, 0.0002]]);
});

test("out of credits: 402 to the program, one stop, nothing more goes upstream", async () => {
  const stops: unknown[] = [];
  const t = proxy.open({ evalId: "e-credits", allowedModels: ["p/rerank"], capUsd: 1, onCreditStop: (s) => stops.push(s) });
  const body = { model: "p/rerank", query: "broke", documents: ["a"] };
  const first = await post("/v1/rerank", body, t);
  assert.equal(first.status, 402);
  assert.equal(first.body.error.type, "insufficient_quota");
  assert.equal((await post("/v1/rerank", { ...body, query: "fine" }, t)).status, 402);
  assert.deepEqual(stops, [{ who: "program", model: "p/rerank", message: "Insufficient credits. Add more" }]);
  const calls = proxy.close(t);
  assert.deepEqual(calls.map((c) => c.rejected), [undefined, 402]); // the second call never went upstream
  assert.equal(calls[0].error, "Insufficient credits. Add more");
  assert.equal(costMetrics(calls, 1).model_calls, 1);
});

test("the ledger shows refused calls, finish reasons and reasoning tokens, and refused calls cost nothing", async () => {
  const t = proxy.open({ evalId: "e-refused", allowedModels: ["p/a"], capUsd: 1 });
  assert.equal((await post("/v1/chat/completions", { model: "p/other", messages: [{ role: "user", content: "x" }] }, t)).status, 403);
  assert.equal((await post("/v1/rerank", { model: "p/a", query: "" }, t)).status, 400);
  assert.equal((await post("/v1/chat/completions", { model: "p/a", messages: [{ role: "user", content: "reason" }] }, t)).status, 200);
  const calls = proxy.close(t);
  assert.deepEqual(calls.map((c) => [c.kind, c.model, c.rejected]), [["chat", "p/other", 403], ["rerank", "p/a", 400], ["chat", "p/a", undefined]]);
  assert.deepEqual([calls[2].finish_reason, calls[2].reasoning_tokens], ["length", 7]);
  assert.equal(costMetrics(calls, 1).model_calls, 1);
});

test("credit errors are exhausted accounts, not throttles", () => {
  for (const m of ["Key limit exceeded (daily limit). Manage it using https://openrouter.ai/workspaces/default/keys", "402 Payment Required", "Insufficient credits. Add more", "insufficient_quota", "quota exceeded", "You have exceeded your premium request allowance", "Your credit balance is too low", "Monthly usage limit reached"]) {
    assert.ok(isCreditError(m), m);
  }
  for (const m of ["429 Too Many Requests", "rate limit reached", "503 service unavailable", "connection refused", "context length exceeded", "budget of $2 spent"]) {
    assert.ok(!isCreditError(m), m);
  }
});

test("the public proxy URL: the override, else the first tunnel up, else a clear error", async () => {
  const up = (url: string) => async () => url;
  const down = async () => undefined;
  assert.equal(await publicMeterUrl("https://x.example/v1/", [up("https://t")], 7422), "https://x.example/v1");
  assert.equal(await publicMeterUrl(undefined, [up("https://cf"), up("https://ngrok")], 7422), "https://cf/v1");
  assert.equal(await publicMeterUrl(undefined, [down, up("https://ngrok")], 7422), "https://ngrok/v1");
  await assert.rejects(publicMeterUrl(undefined, [down, down], 7422), /tunnel:cloudflare/);
});

test("the path to the proxy: the proxy's own refusal passes, a tunnel's error page doesn't", async () => {
  await checkMeterUrl(`http://127.0.0.1:${port}/v1`);
  const edge = createServer((_, res) => res.writeHead(403, { "content-type": "text/html" }).end("ERR_NGROK_725"));
  await new Promise<void>((r) => edge.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(edge.address() as AddressInfo).port}/v1`;
  await assert.rejects(checkMeterUrl(url, 2, 0), /metering proxy isn't reachable.*403: ERR_NGROK_725/);
  edge.close();
  await assert.rejects(checkMeterUrl(url, 1, 0), /metering proxy isn't reachable/);
});

test("replay: a later eval of the night gets the same answer for free; a retry goes upstream", async () => {
  let upstream = 0;
  const backends = {
    chat: async () => ({ text: `answer ${++upstream}`, finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 } }),
  } as unknown as MeterBackends;
  const proxy = new MeterProxy(backends);
  await proxy.listen();
  try {
    const ask = async (token: string, content = "same") => {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: "m", messages: [{ role: "user", content }] }),
      });
      return ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
    };
    const open = (evalId: string, replayScope = "night") => proxy.open({ evalId, allowedModels: ["m"], capUsd: 1, replayScope });

    const first = open("e1");
    assert.equal(await ask(first), "answer 1");
    assert.equal(await ask(first), "answer 2"); // the same eval asks upstream

    const second = open("e2");
    assert.equal(await ask(second), "answer 2");
    assert.equal(proxy.spent(second), 0);
    assert.equal(await ask(second), "answer 3"); // asked twice: the program didn't accept the answer
    assert.equal(await ask(second, "other"), "answer 4");
    const calls = proxy.close(second);
    assert.deepEqual(calls.map((c) => [c.cost_usd, c.replayed_usd]), [[0, 0.01], [0.01, undefined], [0.01, undefined]]);
    assert.equal(costMetrics(calls, 1).cost_usd, 0.03); // priced as if asked, so it compares across evals
    proxy.close(first);

    const otherNight = open("e3", "night2");
    assert.equal(await ask(otherNight), "answer 5");
    proxy.close(otherNight);
  } finally {
    await proxy.stop();
  }
});

test("replay: a coder's next run repeats its own calls, a quick retry doesn't", async () => {
  let upstream = 0;
  const fake = { chat: async () => ({ text: `answer ${++upstream}`, finishReason: "stop" as const, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 } }) } as unknown as MeterBackends;
  const proxy = new MeterProxy(fake);
  await proxy.listen();
  const now = Date.now;
  let clock = now();
  Date.now = () => clock;
  try {
    const token = proxy.open({ evalId: "dev", allowedModels: ["m"], capUsd: 1, replayScope: "night", repeatRuns: true });
    const ask = async () => {
      const res = await fetch(`http://127.0.0.1:${proxy.port}/v1/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "same" }] }),
      });
      return ((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content;
    };
    assert.equal(await ask(), "answer 1");
    assert.equal(await ask(), "answer 2"); // at once: a retry
    clock += 60_000;
    assert.equal(await ask(), "answer 2"); // the next run
    assert.equal(await ask(), "answer 3"); // a retry of the replayed answer
    clock += 10_000;
    assert.equal(await ask(), "answer 3"); // a rerun soon after: replayed, so identical code scores the same
    assert.equal(proxy.close(token).filter((c) => c.replayed_usd !== undefined).length, 2);
  } finally {
    Date.now = now;
    await proxy.stop();
  }
});

