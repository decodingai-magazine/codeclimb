// The model check at night start and the round-start smoke test (spec: Night config, validation; Round loop, Smoke test).
// Finds missing models and keys, not wrong keys: a bad key fails the first call.
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { NightConfig } from "../config.ts";
import { EMBEDDING_PRICES, OPENROUTER_BASE } from "../meter/backends.ts";
import { proxyPort } from "../meter/proxy.ts";
import { ensureMeterPath } from "../meter/relay.ts";
import { modelRuntime } from "./models.ts";

export const MODEL_CHECK_TIMEOUT_MS = 30_000;
/** A failed smoke test is tried again this often, this many more times; then the night stops with `outage`. */
export const SMOKE_WAIT_MS = 5 * 60_000;
export const SMOKE_RETRIES = 6;

/** How to give Pi credentials, per provider. */
const AUTH_HINTS: Record<string, string> = {
	"github-copilot": "run `npx pi`, then `/login github-copilot`",
	anthropic: "set ANTHROPIC_API_KEY; or run `npx pi`, then `/login anthropic`",
	openrouter: "set OPENROUTER_API_KEY",
};

const isOpenRouter = (ref: string) => ref.startsWith("openrouter/");

/** Every problem with Pi models `refs`: not in the runtime, no credentials, or not on the account's list. */
export async function piModelProblems(refs: string[], rt: ModelRuntime): Promise<string[]> {
	const problems: string[] = [];
	for (const ref of new Set(refs)) {
		const slash = ref.indexOf("/");
		const model = slash > 0 ? rt.getModel(ref.slice(0, slash), ref.slice(slash + 1)) : undefined;
		if (!model) {
			problems.push(`${ref}: not in Pi's model runtime (list ids with \`npx pi --list-models\`)`);
			continue;
		}
		if (!(await rt.checkAuth(model.provider))) problems.push(`${ref}: no ${model.provider} credentials; ${AUTH_HINTS[model.provider] ?? `run \`npx pi\`, then \`/login ${model.provider}\``}`);
		else if (!(await rt.getAvailable(model.provider)).some((m) => m.id === model.id)) problems.push(`${ref}: not available to this ${model.provider} account`);
	}
	return problems;
}

/** Every problem with `openrouter/` models: OpenRouter's per-model endpoints API must list at least one endpoint. */
export async function openRouterProblems(refs: string[], baseUrl = OPENROUTER_BASE): Promise<string[]> {
	const models = [...new Set(refs)].filter(isOpenRouter);
	if (!models.length) return [];
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) return [`OPENROUTER_API_KEY is not set (needed for ${models.join(", ")})`];
	const problems = await Promise.all(
		models.map(async (ref) => {
			const res = await fetch(`${baseUrl}/v1/models/${ref.slice("openrouter/".length)}/endpoints`, {
				headers: { authorization: `Bearer ${key}` },
				signal: AbortSignal.timeout(MODEL_CHECK_TIMEOUT_MS),
			}).catch((e: Error) => e);
			if (res instanceof Error) return `${ref}: ${res.message}`;
			const body = (await res.json().catch(() => ({}))) as { data?: { endpoints?: unknown[] } };
			return res.ok && body.data?.endpoints?.length ? null : `${ref}: OpenRouter lists no endpoint for it (${res.status})`;
		}),
	);
	return problems.filter((p) => p !== null);
}

/** Throws, listing every problem, unless each model the night names is callable. Skipped in mock mode. */
export async function checkNightModels(config: Pick<NightConfig, "model" | "reviewer_model" | "allowed_models">, mock: boolean, rt?: ModelRuntime): Promise<void> {
	if (mock) return;
	const viaPi = config.allowed_models.filter((m) => !isOpenRouter(m) && !(m in EMBEDDING_PRICES));
	const problems = [...(await piModelProblems([config.model, config.reviewer_model, ...viaPi], rt ?? (await modelRuntime()))), ...(await openRouterProblems(config.allowed_models))];
	if (problems.length) throw new Error(`models not ready:\n  - ${problems.join("\n  - ")}`);
}

/** Null when a round can start: the models are ready and, on a metered night, the path to the proxy is up. Else why not. */
export async function smokeTest(config: NightConfig, mock: boolean): Promise<string | null> {
	if (mock) return null;
	try {
		await checkNightModels(config, mock);
		if (config.allowed_models.length) await ensureMeterPath(config.scenario_spec.image, await proxyPort());
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}
}

/** The wait between two smoke tests; an abort ends it early with the abort's reason. */
export function smokeWait(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const done = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", done);
			resolve();
		}, SMOKE_WAIT_MS);
		if (signal.aborted) done();
		else signal.addEventListener("abort", done, { once: true });
	});
}

/**
 * The round-start smoke test with its retries: `test` up to 1 + SMOKE_RETRIES times, `wait` between tries.
 * Null when a try passed; else the last failure, and the night stops with `outage`.
 */
export async function smokeWithRetries(test: (n: number) => Promise<string | null>, wait: (n: number) => Promise<void>): Promise<string | null> {
	let down: string | null = null;
	for (let n = 0; n <= SMOKE_RETRIES; n++) {
		if (n) await wait(n);
		down = await test(n);
		if (down === null) return null;
	}
	return down;
}
