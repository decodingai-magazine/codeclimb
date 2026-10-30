// The browser's only way to the worker: /api/worker/<path> → <worker>/api/<path>,
// with the worker token added on the server. Basic Auth (proxy.ts) guards it.
import type { NextRequest } from "next/server";

const WORKER = process.env.CODECLIMB_WORKER_URL ?? "http://127.0.0.1:7421";
const SEGMENT = /^[A-Za-z0-9._-]+$/;

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  if (!path.every((s) => SEGMENT.test(s) && s !== "." && s !== "..")) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }
  const url = `${WORKER}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.CODECLIMB_WORKER_TOKEN) headers.Authorization = `Bearer ${process.env.CODECLIMB_WORKER_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
    });
  } catch {
    return Response.json({ error: `worker unreachable at ${WORKER}` }, { status: 502 });
  }
  const out = new Headers({ "Cache-Control": "no-store" });
  for (const h of ["content-type", "content-disposition"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
