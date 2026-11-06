import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { routedBackends } from "./meter/backends";
import { checkOpenRouterModels, openRouterBackends } from "./meter/openrouter";
import { BackendError, type MeterBackends, MeterProxy } from "./meter/proxy";

// Fake OpenRouter: records requests; the model id picks the behaviour.
const seen: { url: string; auth?: string; body: Record<string, any> }[] = [];
const reply = (status: number, body: unknown) => ({ status, body });

function answer(req: IncomingMessage, body: Record<string, any>) {
  if (req.method === "GET") {
    if (req.url?.includes("/models/ok/model/endpoints")) return reply(200, { data: { endpoints: [{}] } });
    if (req.url?.includes("/models/empty/model/endpoints")) return reply(200, { data: { endpoints: [] } });
    return reply(404, { error: { message: "no such model" } });
  }
  const usage = { prompt_tokens: 7, completion_tokens: 2, cost: 0.003 };
  if (req.url?.endsWith("/embeddings")) {
    return reply(200, { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 2, cost: 0.0001 } });
  }
  if (req.url?.endsWith("/v1/rerank")) {
    return reply(200, { results: [{ index: 1, relevance_score: 0.9, document: { text: "b" } }], usage: { total_tokens: 5, cost: 0.0002 } });
  }
  if (req.url?.endsWith("/alpha/decisions")) {
    return reply(200, { answers: { same: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 40, output_tokens: 5, cost: 0.002 } });
  }
  if (body.model === "down") return reply(503, { error: { message: "no provider" } });
  if (body.model === "late") return reply(200, { error: { message: "provider failed" } });
  if (body.model === "free") return reply(200, { choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1 } });
  if (body.model === "cut") return reply(200, { choices: [{ finish_reason: "length", message: { content: null } }], usage });
  return reply(200, { model: `${body.model}-v1`, choices: [{ finish_reason: "stop", message: { content: "hello" } }], usage });
}

const upstream = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  seen.push({ url: req.url ?? "", auth: req.headers.authorization, body });
  const { status, body: out } = answer(req, body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(out));
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/api`;
after(() => new Promise((r) => upstream.close(r)));
const keyBefore = process.env.OPENROUTER_API_KEY;
process.env.OPENROUTER_API_KEY = "test-key";
after(() => {
  if (keyBefore === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = keyBefore;
});

const or = openRouterBackends(base);
const signal = new AbortController().signal;
const ask = (model: string, options?: Record<string, unknown>) =>
  or.chat({ model: `openrouter/${model}`, messages: [{ role: "user", content: "hi" }], maxTokens: 5, ...(options ? { options } : {}) }, signal);

test("openrouter chat: strips the prefix, forwards options, takes the reported cost", async () => {
  const out = await ask("a/b", { response_format: { type: "json_object" }, seed: 7 });
  assert.equal(out.text, "hello");
  assert.deepEqual(out.usage, { inputTokens: 7, outputTokens: 2, costUsd: 0.003 });
  assert.equal(out.responseModel, "a/b-v1");
  const sent = seen.at(-1)!;
  assert.match(sent.url, /\/api\/v1\/chat\/completions$/);
  assert.equal(sent.auth, "Bearer test-key");
  assert.equal(sent.body.model, "a/b");
  assert.deepEqual(sent.body.response_format, { type: "json_object" });
  assert.equal(sent.body.seed, 7);
  assert.equal(sent.body.max_tokens, 5);
});

test("openrouter chat: null content, HTTP errors, error bodies, missing cost", async () => {
  const cut = await ask("cut");
  assert.deepEqual([cut.text, cut.finishReason], ["", "length"]);
  await assert.rejects(ask("down"), (e: Error) => e instanceof BackendError && e.message === "no provider");
  await assert.rejects(ask("late"), /provider failed/);
  await assert.rejects(ask("free"), /usage\.cost/);
});

test("openrouter embeddings: vectors in input order, reported cost", async () => {
  const out = await or.embed("openrouter/m/e", ["a", "b"], signal);
  assert.deepEqual(out.vectors, [[1], [2]]);
  assert.deepEqual(out.usage, { inputTokens: 2, outputTokens: 0, costUsd: 0.0001 });
  assert.equal(seen.at(-1)!.body.model, "m/e");
});

test("openrouter decisions: alpha endpoint, input/output tokens, reported cost", async () => {
  const out = await or.decide("openrouter/t/jev", { state: "s", questions: { same: { type: "noul" } } }, signal);
  assert.deepEqual(out.answers, { same: { type: "noul", noul: 0.9 } });
  assert.deepEqual(out.usage, { inputTokens: 40, outputTokens: 5, costUsd: 0.002 });
  assert.match(seen.at(-1)!.url, /\/api\/alpha\/decisions$/);
  assert.equal(seen.at(-1)!.body.model, "t/jev");
});

test("openrouter rerank: results without the documents, reported cost", async () => {
  const out = await or.rerank("openrouter/q/r", { query: "q", documents: ["a", "b"], top_n: 1 }, signal);
  assert.deepEqual(out, { results: [{ index: 1, relevance_score: 0.9 }], usage: { inputTokens: 5, outputTokens: 0, costUsd: 0.0002 } });
  assert.match(seen.at(-1)!.url, /\/api\/v1\/rerank$/);
});

test("model check: the endpoints API decides, and a missing key is named", async () => {
  await checkOpenRouterModels(["openrouter/ok/model", "p/not-openrouter"], base);
  await assert.rejects(checkOpenRouterModels(["openrouter/ok/model", "openrouter/empty/model", "openrouter/gone/model"], base), (e: Error) => {
    assert.match(e.message, /empty\/model/);
    assert.match(e.message, /gone\/model/);
    assert.doesNotMatch(e.message, /ok\/model/);
    return true;
  });
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(checkOpenRouterModels(["openrouter/ok/model"], base), /OPENROUTER_API_KEY/);
  await checkOpenRouterModels(["p/not-openrouter"], base); // no key needed
  process.env.OPENROUTER_API_KEY = "test-key";
});

test("the proxy routes openrouter models upstream and forwards response_format", async () => {
  const other: MeterBackends = {
    chat: async () => ({ text: "pi", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }),
    embed: async () => ({ vectors: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }),
    decide: async () => ({ answers: {}, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }),
    rerank: async () => ({ results: [{ index: 0, relevance_score: 1 }], usage: { inputTokens: 3, outputTokens: 0, costUsd: 0.001 } }),
  };
  const proxy = new MeterProxy(routedBackends(or, other));
  const port = await proxy.listen();
  const token = proxy.open({ evalId: "e", allowedModels: ["openrouter/a/b", "p/chat"], capUsd: 1 });
  const call = async (model: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "x" }], response_format: { type: "json_object" }, ignored_field: 1 }),
    });
    return (await res.json()) as { choices: { message: { content: string } }[] };
  };
  assert.equal((await call("openrouter/a/b")).choices[0].message.content, "hello");
  assert.deepEqual(seen.at(-1)!.body.response_format, { type: "json_object" });
  assert.equal(seen.at(-1)!.body.ignored_field, undefined);
  assert.equal((await call("p/chat")).choices[0].message.content, "pi");
  assert.equal(proxy.spent(token), 0.003);
  const decide = async (body: object) =>
    fetch(`http://127.0.0.1:${port}/v1/decisions`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ model: "openrouter/a/b", ...body }) });
  assert.equal((await decide({ state: "s" })).status, 400);
  const res = await decide({ state: "s", questions: { same: { type: "noul" } }, trace: "dropped" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { answers: { same: { noul: number } } }).answers.same.noul, 0.9);
  assert.equal(seen.at(-1)!.body.trace, undefined);
  assert.equal(proxy.spent(token), 0.005);
  await proxy.stop();
});
