// CodeClimb's tracer provider: each OpenTelemetry span becomes a LangSmith trace run through `RunTree`, and the dev
// scores are mirrored as feedback on the experiment's root (spec: Tracing; docs/adr/0003). No OpenTelemetry SDK.
// Registered only with LANGSMITH_API_KEY set and LANGSMITH_TRACING not `false`; otherwise every span stays a no-op.
import { AsyncLocalStorage } from "node:async_hooks";
import {
	type Attributes,
	type Context,
	type ContextManager,
	context,
	INVALID_SPAN_CONTEXT,
	ROOT_CONTEXT,
	type Span,
	type SpanContext,
	type SpanOptions,
	type SpanStatus,
	SpanStatusCode,
	type TimeInput,
	TraceFlags,
	type Tracer,
	type TracerProvider,
	trace,
} from "@opentelemetry/api";
import { Client } from "langsmith";
import { RunTree } from "langsmith/run_trees";
import type { Metrics } from "./eval/metrics.ts";
import { uuidV5 } from "./ids.ts";

export const TRACING_PROJECT = "codeclimb";
/** The UUID v5 namespace of feedback ids. */
const FEEDBACK_NAMESPACE = "3b8f0f5e-1c47-4f0e-8d5a-7a2b9c6e4d10";

export const tracingOn = (env: NodeJS.ProcessEnv = process.env) => !!env.LANGSMITH_API_KEY && env.LANGSMITH_TRACING?.toLowerCase() !== "false";
const projectName = () => process.env.LANGSMITH_PROJECT || TRACING_PROJECT;

class AlsContextManager implements ContextManager {
	private readonly als = new AsyncLocalStorage<Context>();
	active(): Context {
		return this.als.getStore() ?? ROOT_CONTEXT;
	}
	with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(ctx: Context, fn: F, thisArg?: ThisParameterType<F>, ...args: A): ReturnType<F> {
		return this.als.run(ctx, () => fn.apply(thisArg, args));
	}
	bind<T>(ctx: Context, target: T): T {
		if (typeof target !== "function") return target;
		const run = (...args: unknown[]) => this.with(ctx, target as (...a: unknown[]) => unknown, undefined, ...args);
		return run as T;
	}
	enable(): this {
		return this;
	}
	disable(): this {
		this.als.disable();
		return this;
	}
}

const ms = (t: TimeInput | undefined): number | undefined => (t === undefined ? undefined : t instanceof Date ? t.getTime() : Array.isArray(t) ? t[0] * 1000 + t[1] / 1e6 : t);
const hex = (uuid: string) => uuid.replaceAll("-", "");
const runType = (name: string) => (name.startsWith("gen_ai.") ? "llm" : name.startsWith("tool.") ? "tool" : "chain");

/** A span written as one LangSmith run: posted at start, patched at end. */
class RunSpan implements Span {
	private readonly attrs: Attributes = {};
	private error: string | undefined;
	private ended = false;
	private readonly posted: Promise<void>;

	constructor(readonly run: RunTree) {
		this.posted = run.postRun().catch(() => {});
	}

	spanContext(): SpanContext {
		return { traceId: hex(this.run.trace_id), spanId: hex(this.run.id).slice(16), traceFlags: TraceFlags.SAMPLED };
	}
	setAttribute(key: string, value: Attributes[string]): this {
		this.attrs[key] = value;
		return this;
	}
	setAttributes(attributes: Attributes): this {
		Object.assign(this.attrs, attributes);
		return this;
	}
	addEvent(): this {
		return this;
	}
	addLink(): this {
		return this;
	}
	addLinks(): this {
		return this;
	}
	setStatus(status: SpanStatus): this {
		if (status.code === SpanStatusCode.ERROR) this.error = status.message || "error";
		return this;
	}
	updateName(name: string): this {
		this.run.name = name;
		return this;
	}
	isRecording(): boolean {
		return !this.ended;
	}
	recordException(exception: unknown): void {
		this.error = exception instanceof Error ? exception.message : String(exception);
	}

	/** gen_ai attributes as LangSmith reads an llm run: usage in the outputs, the model in the metadata. */
	private outputs(): Record<string, unknown> | undefined {
		const a = this.attrs;
		if (this.run.run_type !== "llm" || typeof a["gen_ai.usage.input_tokens"] !== "number") return undefined;
		const input = a["gen_ai.usage.input_tokens"];
		const output = Number(a["gen_ai.usage.output_tokens"] ?? 0);
		return {
			usage_metadata: {
				input_tokens: input,
				output_tokens: output,
				total_tokens: input + output,
				input_token_details: { cache_read: Number(a["gen_ai.usage.cache_read_tokens"] ?? 0) },
				...(typeof a["codeclimb.cost_usd"] === "number" ? { total_cost: a["codeclimb.cost_usd"] } : {}),
			},
		};
	}

	end(endTime?: TimeInput): void {
		if (this.ended) return;
		this.ended = true;
		const metadata: Record<string, unknown> = { ...this.attrs };
		if (this.run.run_type === "llm") {
			if (this.attrs["gen_ai.system"] !== undefined) metadata.ls_provider = this.attrs["gen_ai.system"];
			if (this.attrs["gen_ai.response.model"] !== undefined) metadata.ls_model_name = this.attrs["gen_ai.response.model"];
		}
		const at = ms(endTime) ?? Date.now();
		void this.posted
			.then(async () => {
				await this.run.end(this.outputs(), this.error, at, metadata);
				await this.run.patchRun();
			})
			.catch(() => {});
	}
}

const DROPPED = () => trace.wrapSpanContext(INVALID_SPAN_CONTEXT);

class RunTreeTracer implements Tracer {
	constructor(private readonly client: Client) {}

	startSpan(name: string, options: SpanOptions = {}, ctx: Context = context.active()): Span {
		const parent = options.root ? undefined : trace.getSpan(ctx);
		const start = ms(options.startTime) ?? Date.now();
		const base = { name, run_type: runType(name), start_time: start, metadata: { ...options.attributes } };
		if (parent instanceof RunSpan) return new RunSpan(parent.run.createChild(base));
		// A span with no parent is written only as an explicit root: stray work opens no trace.
		if (!options.root) return DROPPED();
		return new RunSpan(new RunTree({ ...base, project_name: projectName(), client: this.client, tracingEnabled: true }));
	}

	startActiveSpan<F extends (span: Span) => unknown>(name: string, ...rest: [F] | [SpanOptions, F] | [SpanOptions, Context, F]): ReturnType<F> {
		const fn = rest.at(-1) as F;
		const options = rest.length > 1 ? (rest[0] as SpanOptions) : {};
		const ctx = rest.length > 2 ? (rest[1] as Context) : context.active();
		const span = this.startSpan(name, options, ctx);
		return context.with(trace.setSpan(ctx, span), () => fn(span) as ReturnType<F>);
	}
}

let client: Client | undefined;

/** Register the provider once, when tracing is on; returns whether it is registered. `c` replaces the client (tests). */
export function registerTracing(c?: Client): boolean {
	if (client) return true;
	if (!c && !tracingOn()) return false;
	client = c ?? new Client();
	const tracer = new RunTreeTracer(client);
	const provider: TracerProvider = { getTracer: () => tracer };
	context.setGlobalContextManager(new AlsContextManager());
	trace.setGlobalTracerProvider(provider);
	return true;
}

/** Wait until every queued run is sent (tests; the server sends in the background). */
export async function flushTracing(): Promise<void> {
	await client?.awaitPendingTraceBatches();
}

let projectId: Promise<string> | undefined;

/** The metric names mirrored: the primary and the headlines, or every metric when the scenario has no headlines; sorted. */
export function mirroredKeys(metrics: Metrics, primary: string, headline: string[]): string[] {
	const keys = headline.length ? [primary, ...headline] : Object.keys(metrics);
	return [...new Set(keys)].filter((k) => typeof metrics[k] === "number").sort();
}

/** A dev evaluation's scores as feedback on the experiment's root; one id per evaluation and metric, so a rerun overwrites. Never throws. */
export async function mirrorScores(runId: string | undefined, evalId: string, metrics: Metrics, keys: string[]): Promise<void> {
	if (!client || !runId) return;
	const c = client;
	try {
		projectId ??= c.readProject({ projectName: projectName() }).then((p) => p.id);
		const sessionId = await projectId;
		for (const key of keys) {
			const score = metrics[key];
			if (typeof score !== "number") continue;
			await c.createFeedback({ runId, sessionId, key, score, feedbackId: uuidV5(`${evalId}/${key}`, FEEDBACK_NAMESPACE) });
		}
	} catch (error) {
		projectId = undefined;
		console.error(`tracing: feedback for ${evalId} failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
