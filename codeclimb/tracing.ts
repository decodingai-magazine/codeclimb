// DIY spans from Pi's event stream: one LLM span per assistant message
// (gen_ai.* attributes) and one span per tool call. Created under the active
// context, so with extended traces they nest under the Inngest step. Without an
// OpenTelemetry provider the API is a no-op.
import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { OpLatency } from "./standard-metrics";

const tracer = trace.getTracer("codeclimb");

export function traceSession(session: AgentSession, attrs: Record<string, string>): () => void {
  const ctx = context.active();
  const tools = new Map<string, Span>();
  let llm: Span | undefined;

  const unsubscribe = session.subscribe((e) => {
    if (e.type === "message_start" && e.message.role === "assistant") {
      llm = tracer.startSpan("gen_ai.chat", { attributes: { ...attrs, "gen_ai.operation.name": "chat" } }, ctx);
    } else if (e.type === "message_end" && e.message.role === "assistant") {
      const m = e.message;
      const span = llm ?? tracer.startSpan("gen_ai.chat", { attributes: attrs }, ctx);
      span.setAttributes({
        "gen_ai.system": m.provider,
        "gen_ai.request.model": m.model,
        "gen_ai.response.model": m.responseModel ?? m.model,
        "gen_ai.usage.input_tokens": m.usage.input + m.usage.cacheRead + m.usage.cacheWrite,
        "gen_ai.usage.output_tokens": m.usage.output,
        "gen_ai.usage.cache_read_tokens": m.usage.cacheRead,
        "gen_ai.response.finish_reasons": [m.stopReason],
        "codeclimb.cost_usd": m.usage.cost.total,
      });
      if (m.stopReason === "error") span.setStatus({ code: SpanStatusCode.ERROR, message: m.errorMessage });
      span.end();
      llm = undefined;
    } else if (e.type === "tool_execution_start") {
      tools.set(
        e.toolCallId,
        tracer.startSpan(`tool.${e.toolName}`, { attributes: { ...attrs, "gen_ai.tool.name": e.toolName } }, ctx),
      );
    } else if (e.type === "tool_execution_end") {
      const span = tools.get(e.toolCallId);
      if (span) {
        if (e.isError) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
        tools.delete(e.toolCallId);
      }
    }
  });
  return () => {
    unsubscribe();
    llm?.end();
    for (const s of tools.values()) s.end();
  };
}

/** Wrap a sandbox operation in a span. */
export function sandboxSpan<T>(name: string, attrs: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (span) => {
    try {
      return await fn();
    } catch (e) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw e;
    } finally {
      span.end();
    }
  });
}

/**
 * The program's own time in an eval: one span per operation under the active (eval) step, laid end to
 * end from the run's start, since the runner reports durations, not timestamps.
 */
export function programSpans(attrs: Record<string, string>, runStartMs: number, ops: OpLatency[]): void {
  let t = runStartMs;
  for (const o of ops) {
    const end = t + o.total_s * 1000;
    tracer
      .startSpan(`program.${o.op}`, {
        startTime: t,
        attributes: {
          ...attrs, "codeclimb.op": o.op, "codeclimb.latency.n": o.n, "codeclimb.latency.p50_ms": o.p50_ms,
          "codeclimb.latency.p95_ms": o.p95_ms, "codeclimb.latency.total_s": o.total_s,
        },
      })
      .end(end);
    t = end;
  }
}
