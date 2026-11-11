// CodeClimb's spans, through the OpenTelemetry API only: a no-op until a tracer provider is registered (spec: Tracing).
// Roots are explicit (`withRoot`): a span with no parent and no `root` is dropped, so stray work never opens a trace.
import { context, isSpanContextValid, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { LedgerCall, Timing } from "./eval/metrics.ts";
import type { Sandbox } from "./sandbox/types.ts";

const tracer = trace.getTracer("codeclimb");

export interface RootMeta {
	night_id: string;
	exp_id?: string;
}

/** The LangSmith run id of a root span (a root's run id is its trace id); undefined while tracing is off. */
export function rootRunId(span: Span): string | undefined {
	const c = span.spanContext();
	if (!isSpanContextValid(c)) return undefined;
	const h = c.traceId;
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Run `fn` under a new trace root named `name`, carrying the night and experiment ids. */
export function withRoot<T>(name: string, meta: RootMeta, fn: (runId: string | undefined) => Promise<T>): Promise<T> {
	return tracer.startActiveSpan(name, { root: true, attributes: { ...meta } }, async (span) => {
		try {
			return await fn(rootRunId(span));
		} catch (error) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally {
			span.end();
		}
	});
}

/** One chat span per assistant message and one span per tool call, from Pi's event stream, under the active span. */
export function traceSession(session: AgentSession): () => void {
	const ctx = context.active();
	const tools = new Map<string, Span>();
	let chat: Span | undefined;
	const unsubscribe = session.subscribe((e) => {
		if (e.type === "message_start" && e.message.role === "assistant") {
			chat = tracer.startSpan("gen_ai.chat", { attributes: { "gen_ai.operation.name": "chat" } }, ctx);
		} else if (e.type === "message_end" && e.message.role === "assistant") {
			const m = e.message;
			const span = chat ?? tracer.startSpan("gen_ai.chat", { attributes: { "gen_ai.operation.name": "chat" } }, ctx);
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
			if (m.stopReason === "error") span.setStatus({ code: SpanStatusCode.ERROR, message: m.errorMessage ?? "error" });
			span.end();
			chat = undefined;
		} else if (e.type === "tool_execution_start") {
			tools.set(e.toolCallId, tracer.startSpan(`tool.${e.toolName}`, { attributes: { "gen_ai.tool.name": e.toolName } }, ctx));
		} else if (e.type === "tool_execution_end") {
			const span = tools.get(e.toolCallId);
			if (!span) return;
			if (e.isError) span.setStatus({ code: SpanStatusCode.ERROR });
			span.end();
			tools.delete(e.toolCallId);
		}
	});
	return () => {
		unsubscribe();
		chat?.end();
		for (const s of tools.values()) s.end();
	};
}

function spanned<T>(name: string, attributes: Record<string, string>, fn: () => Promise<T>): Promise<T> {
	return tracer.startActiveSpan(name, { attributes }, async (span) => {
		try {
			return await fn();
		} catch (error) {
			span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
			throw error;
		} finally {
			span.end();
		}
	});
}

/** The sandbox with one span per exec, read and write. */
export function tracedSandbox(sb: Sandbox): Sandbox {
	return new Proxy(sb, {
		get(target, prop, receiver) {
			if (prop === "exec") {
				return (command: string, opts?: Parameters<Sandbox["exec"]>[1]) =>
					spanned("sandbox.exec", { "codeclimb.command": command.slice(0, 500) }, async () => {
						const r = await target.exec(command, opts);
						trace.getActiveSpan()?.setAttributes({ "codeclimb.exit_code": r.exitCode, "codeclimb.timed_out": r.timedOut, "codeclimb.aborted": r.aborted });
						return r;
					});
			}
			if (prop === "readFile") return (path: string) => spanned("sandbox.read", { "codeclimb.path": path }, () => target.readFile(path));
			if (prop === "writeFile") return (path: string, data: string | Buffer) => spanned("sandbox.write", { "codeclimb.path": path }, () => target.writeFile(path, data));
			const v: unknown = Reflect.get(target, prop, receiver);
			return typeof v === "function" ? v.bind(target) : v;
		},
	});
}

/** One span per program operation of an evaluation, laid end to end from `startMs`: the program reports durations, not times. */
export function programSpans(timings: Timing[], startMs: number): void {
	const byOp = new Map<string, number[]>();
	for (const t of timings) if (!t.warmup) byOp.set(t.op, [...(byOp.get(t.op) ?? []), t.ms]);
	let t = startMs;
	for (const [op, ms] of byOp) {
		const total = ms.reduce((a, b) => a + b, 0);
		tracer.startSpan(`program.${op}`, { startTime: t, attributes: { "codeclimb.op": op, "codeclimb.latency.n": ms.length, "codeclimb.latency.total_ms": total } }).end(t + total);
		t += total;
	}
}

/** One span per metered call of an evaluation, laid end to end from `startMs`. */
export function meterSpans(calls: LedgerCall[], startMs: number): void {
	let t = startMs;
	for (const c of calls) {
		const ms = c.ms ?? 0;
		const span = tracer.startSpan(`meter.${c.kind ?? "call"}`, {
			startTime: t,
			attributes: {
				"codeclimb.op": c.op,
				...(c.model ? { "gen_ai.request.model": c.model } : {}),
				...(c.input_tokens !== undefined ? { "gen_ai.usage.input_tokens": c.input_tokens } : {}),
				...(c.output_tokens !== undefined ? { "gen_ai.usage.output_tokens": c.output_tokens } : {}),
				"codeclimb.cost_usd": c.cost_usd,
				...(c.replayed_usd !== undefined ? { "codeclimb.replayed_usd": c.replayed_usd } : {}),
				...(c.rejected !== undefined ? { "codeclimb.rejected": c.rejected } : {}),
			},
		});
		if (!c.ok) span.setStatus({ code: SpanStatusCode.ERROR, message: c.error ?? "failed" });
		span.end(t + ms);
		t += ms;
	}
}
